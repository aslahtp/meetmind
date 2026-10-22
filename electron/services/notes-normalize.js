// Pure note-shaping helpers shared by every LLM provider (no Electron/SDK imports).
const { parse: parsePartialJson } = require('partial-json');

function transcriptToText(transcript) {
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

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function normalizeNotes(notes) {
  if (!notes || typeof notes !== 'object') return notes;

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
  let rawParticipants = Array.isArray(notes.participants)
    ? notes.participants
    : Array.isArray(notes.attendees)
      ? notes.attendees
      : [];

  const normalizedParticipants = rawParticipants.map((p) => {
    if (typeof p === 'string') {
      return {
        label: p,
        name: p,
        role: null,
        identity_confidence: 'inferred',
      };
    }
    if (p && typeof p === 'object') {
      return {
        label: p.label || p.name || 'Speaker',
        name: p.name || null,
        role: p.role || null,
        identity_confidence: p.identity_confidence || (p.name ? 'inferred' : 'unknown'),
      };
    }
    return { label: 'Speaker', name: null, role: null, identity_confidence: 'unknown' };
  });

  notes.participants = normalizedParticipants;
  notes.attendees = normalizedParticipants.map((p) => p.name || p.label).filter(Boolean);

  // Sections, Topics, Key Points compatibility
  let rawSections = Array.isArray(notes.sections)
    ? notes.sections
    : Array.isArray(notes.topics)
      ? notes.topics
      : Array.isArray(notes.key_points)
        ? notes.key_points
        : [];

  const normalizedSections = rawSections.map((s) => {
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
  let rawActionItems = Array.isArray(notes.action_items) ? notes.action_items : [];
  const normalizedActionItems = [];

  for (const item of rawActionItems) {
    if (typeof item === 'string') {
      if (item.trim()) {
        normalizedActionItems.push({ task: item.trim(), owner: null });
      }
    } else if (item && typeof item === 'object') {
      if (Array.isArray(item.tasks) && item.tasks.length > 0) {
        for (const t of item.tasks) {
          if (typeof t === 'string' && t.trim()) {
            normalizedActionItems.push({
              task: t.trim(),
              owner: item.owner || null,
              priority: item.priority || null,
              due: item.due || null,
            });
          }
        }
      } else if (item.task && typeof item.task === 'string' && item.task.trim()) {
        normalizedActionItems.push({
          task: item.task.trim(),
          owner: item.owner || null,
          priority: item.priority || null,
          due: item.due || null,
        });
      }
    }
  }

  notes.action_items = normalizedActionItems;

  if (!Array.isArray(notes.notable_mentions)) {
    notes.notable_mentions = [];
  }

  return notes;
}

function stripCodeFence(text) {
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
function isMarkdownPrompt(prompt) {
  return !prompt.includes('"$schema"') && !prompt.includes('json\n{');
}

function buildUserPrompt(transcriptText, markdown, meetingTitle = '') {
  const context = meetingTitle
    ? `The meeting is titled ${JSON.stringify(meetingTitle)} in the calendar or meeting app. Use exactly that as the notes title, and use it as context for the discussion.\n\n`
    : '';
  return markdown
    ? `${context}Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate the meeting notes as instructed.`
    : `${context}Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate structured meeting notes in JSON format as specified.`;
}

/** Turn raw model text into the notes object the app stores. */
function parseNotesResponse(text, markdown) {
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
function withoutEmptyEntries(list) {
  return Array.isArray(list)
    ? list.filter((x) => x != null && !(typeof x === 'object' && Object.keys(x).length === 0))
    : list;
}

/**
 * Estimated share (0 to <1) of the notes written once the LLM has streamed
 * `outputChars`. Notes run to roughly 12% of the transcript plus a fixed
 * header, within 1,500 to 12,000 characters. Progress is linear up to 90% at
 * that estimate, then creeps towards 100% without reaching it, so a longer
 * answer than expected never stalls or overshoots.
 */
function estimateNotesProgress(outputChars, transcriptChars) {
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
function buildNotesPreview(text, markdown) {
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
    const partial = parsePartialJson(body);
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return null;
    for (const key of ['participants', 'attendees', 'sections', 'topics', 'key_points', 'action_items', 'notable_mentions']) {
      partial[key] = withoutEmptyEntries(partial[key]);
    }
    return normalizeNotes(partial);
  } catch {
    return null;
  }
}

module.exports = {
  transcriptToText,
  normalizeNotes,
  stripCodeFence,
  isMarkdownPrompt,
  buildUserPrompt,
  parseNotesResponse,
  buildNotesPreview,
  estimateNotesProgress,
};
