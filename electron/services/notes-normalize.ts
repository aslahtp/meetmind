// Pure note-shaping helpers shared by every LLM provider (no Electron/SDK imports).
import { parse as parsePartialJson } from 'partial-json';
import type { Notes } from '../shared';
import { sanitizeNotes } from './notes-sanitize';

/** Parsed JSON of unknown shape: what an LLM returned. */
type JsonObject = Record<string, unknown>;

/** The fields of a transcript segment the prompt uses (STT providers write `startTime`). */
interface PromptSegment {
  startTime?: number;
  speaker?: string;
  text?: string;
}

function transcriptToText(transcript: PromptSegment[] | null | undefined) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 'No transcript available.';
  }

  return transcript
    .map((seg) => {
      const time = formatTime(seg.startTime || 0);
      return `[${time}] ${seg.speaker || 'Speaker'}: ${seg.text}`;
    })
    .join('\n');
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Fills in the fields the UI reads, from the current schema or an older one. Anything that isn't an
 * object (JSON.parse can return one) is returned as it is.
 */
function normalizeNotes(input: unknown): Notes {
  if (!input || typeof input !== 'object') return input as Notes;
  // The LLM's JSON: the code below makes it a `Notes`.
  const notes = input as JsonObject;

  // An LLM can return any JSON type for any field; make each displayed one the type the UI expects.
  sanitizeNotes(notes);

  // Title backward/forward compatibility
  const resolvedTitle = notes.title || notes.meeting_title || 'Meeting Notes';
  notes.title = resolvedTitle;
  notes.meeting_title = resolvedTitle;

  // Duration normalization
  if (notes.duration && typeof notes.duration === 'string') {
    notes.duration = notes.duration.trim();
  } else if (!notes.duration) {
    notes.duration = null;
  }

  // Participants & Attendees compatibility
  const rawParticipants: unknown[] = Array.isArray(notes.participants)
    ? notes.participants
    : Array.isArray(notes.attendees)
      ? notes.attendees
      : [];

  const normalizedParticipants: JsonObject[] = rawParticipants.map((p) => {
    if (typeof p === 'string') {
      return {
        label: p,
        name: p,
        role: null,
        identity_confidence: 'inferred',
      };
    }
    if (p && typeof p === 'object') {
      const o = p as JsonObject;
      return {
        label: o.label || o.name || 'Speaker',
        name: o.name || null,
        role: o.role || null,
        identity_confidence: o.identity_confidence || (o.name ? 'inferred' : 'unknown'),
      };
    }
    return { label: 'Speaker', name: null, role: null, identity_confidence: 'unknown' };
  });

  notes.participants = normalizedParticipants;
  notes.attendees = normalizedParticipants.map((p) => p.name || p.label).filter(Boolean);

  // Sections, Topics, Key Points compatibility
  const rawSections: unknown[] = Array.isArray(notes.sections)
    ? notes.sections
    : Array.isArray(notes.topics)
      ? notes.topics
      : Array.isArray(notes.key_points)
        ? notes.key_points
        : [];

  const normalizedSections = rawSections.filter((s): s is JsonObject => !!s && typeof s === 'object').map((s) => {
    const heading = s.heading || 'Topic';
    const content = s.content || s.summary || '';
    const options = Array.isArray(s.options_discussed) ? s.options_discussed : [];
    const decision = s.decision || null;
    const openQuestions = Array.isArray(s.open_questions) ? s.open_questions : [];

    return {
      heading,
      content,
      summary: content,
      options_discussed: options,
      decision,
      open_questions: openQuestions,
    };
  });

  notes.sections = normalizedSections;
  notes.topics = normalizedSections;
  notes.key_points = normalizedSections;

  // Action Items compatibility (support { owner, tasks } and flat { task, owner })
  const rawActionItems: unknown[] = Array.isArray(notes.action_items) ? notes.action_items : [];
  const normalizedActionItems: JsonObject[] = [];

  for (const item of rawActionItems) {
    if (typeof item === 'string') {
      if (item.trim()) {
        normalizedActionItems.push({ task: item.trim(), owner: null });
      }
    } else if (item && typeof item === 'object') {
      const o = item as JsonObject;
      if (Array.isArray(o.tasks) && o.tasks.length > 0) {
        for (const t of o.tasks) {
          if (typeof t === 'string' && t.trim()) {
            normalizedActionItems.push({
              task: t.trim(),
              owner: o.owner || null,
              priority: o.priority || null,
              due: o.due || null,
            });
          }
        }
      } else if (o.task && typeof o.task === 'string' && o.task.trim()) {
        normalizedActionItems.push({
          task: o.task.trim(),
          owner: o.owner || null,
          priority: o.priority || null,
          due: o.due || null,
        });
      }
    }
  }

  notes.action_items = normalizedActionItems;

  if (!Array.isArray(notes.notable_mentions)) {
    notes.notable_mentions = [];
  }

  // Every field the code above fills in has its `Notes` type; other keys the LLM returned are kept as they are.
  return notes as Notes;
}

function stripCodeFence(text: unknown) {
  let out = String(text || '').trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|markdown|md)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  return out;
}

/**
 * Markdown mode is used when the system prompt does not ask for the JSON schema.
 * An explicit output mode wins; prompt sniffing only guards custom prompts.
 */
function isMarkdownPrompt(prompt: string) {
  return !prompt.includes('"$schema"') && !prompt.includes('json\n{');
}

function buildUserPrompt(transcriptText: string, markdown: boolean, meetingTitle = '') {
  const context = meetingTitle
    ? `The meeting is titled ${JSON.stringify(meetingTitle)} in the calendar or meeting app. Use exactly that as the notes title, and use it as context for the discussion.\n\n`
    : '';
  return markdown
    ? `${context}Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate the meeting notes as instructed.`
    : `${context}Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate structured meeting notes in JSON format as specified.`;
}

/** Turn raw model text into the notes object the app stores. */
function parseNotesResponse(text: unknown, markdown: boolean): Notes {
  if (markdown) {
    const mdText = stripCodeFence(text);
    const titleMatch = mdText.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Meeting Notes';
    return { _rawMarkdown: mdText, title, meeting_title: title };
  }

  const jsonText = stripCodeFence(text);
  try {
    return normalizeNotes(JSON.parse(jsonText));
  } catch {
    return {
      meeting_title: 'Meeting Notes',
      title: 'Meeting Notes',
      date: new Date().toISOString(),
      duration: 'Unknown',
      participants: [],
      attendees: [],
      action_items: [],
      topics: [{ heading: 'Summary', summary: jsonText.slice(0, 500), options_discussed: [], decision: null, open_questions: [] }],
      key_points: [{ heading: 'Summary', summary: jsonText.slice(0, 500) }],
      status_update: null,
      notable_mentions: [],
      decisions: [],
      questions_unresolved: [],
      next_meeting: null,
      sentiment: 'neutral',
      _rawResponse: jsonText,
    };
  }
}

/** Drop the `{}` placeholders a cut-off JSON array ends with, so no empty card flashes. */
function withoutEmptyEntries(list: unknown) {
  return Array.isArray(list)
    ? list.filter((x: unknown) => x != null && !(typeof x === 'object' && Object.keys(x).length === 0))
    : list;
}

/**
 * Estimated share (0 to <1) of the notes written once the LLM has streamed
 * `outputChars`. Notes run to roughly 12% of the transcript plus a fixed
 * header, within 1,500 to 12,000 characters. Progress is linear up to 90% at
 * that estimate, then creeps towards 100% without reaching it, so a longer
 * answer than expected never stalls or overshoots.
 */
function estimateNotesProgress(outputChars: number, transcriptChars: number) {
  const expected = Math.min(12000, Math.max(1500, 1200 + transcriptChars * 0.12));
  if (outputChars <= 0) return 0;
  if (outputChars <= expected) return 0.9 * (outputChars / expected);
  return 0.9 + 0.1 * (1 - Math.exp(-(outputChars - expected) / expected));
}

/**
 * Turn the text an LLM has streamed so far into a notes object for the live
 * preview, or null when there's nothing to show yet. Partial JSON is completed
 * by partial-json and normalized like the final notes.
 */
function buildNotesPreview(text: unknown, markdown: boolean): Notes | null {
  const raw = String(text || '').trim();
  const fenced = raw.startsWith('```');
  if (fenced && !raw.includes('\n')) return null; // only the opening fence so far
  // Also drop a closing fence that is still arriving.
  const body = (fenced ? stripCodeFence(raw).replace(/\n`{1,3}$/, '') : raw).trim();
  if (!body) return null;

  if (markdown) {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Meeting Notes';
    return { _rawMarkdown: body, title, meeting_title: title };
  }

  try {
    const partial: unknown = parsePartialJson(body);
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return null;
    const obj = partial as JsonObject;
    for (const key of ['participants', 'attendees', 'sections', 'topics', 'key_points', 'action_items', 'notable_mentions']) {
      obj[key] = withoutEmptyEntries(obj[key]);
    }
    return normalizeNotes(obj);
  } catch {
    return null;
  }
}

export {
  transcriptToText,
  normalizeNotes,
  stripCodeFence,
  isMarkdownPrompt,
  buildUserPrompt,
  parseNotesResponse,
  buildNotesPreview,
  estimateNotesProgress,
};
