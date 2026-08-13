const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

const AVAILABLE_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
];

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

function resolveModelId(modelId) {
  if (modelId && AVAILABLE_MODELS.includes(modelId)) return modelId;
  return DEFAULT_GEMINI_MODEL;
}

const DEFAULT_SYSTEM_PROMPT = `Write for someone who was not in the meeting. Each section's \`content\` must fully explain the topic (what was raised, what was discussed, what was decided, what's still open) so a reader understands it completely without needing the audio. Use markdown inside string values (bold, bullet lines, inline code) for readability. Skip small talk unless it affects timelines, staffing, or decisions. Identify speakers by name/role from context where possible; mark uncertain ones as such. Write in plain, neutral English regardless of the transcript's original language(s). Do not preserve filler words, false starts, or verbatim phrasing. No em dashes.

\`\`\`json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MeetingNotes",
  "type": "object",
  "required": ["title", "duration", "attendees", "sections", "action_items"],
  "properties": {
    "title": {
      "type": "string",
      "description": "Short title for the meeting's overall focus"
    },
    "duration": {
      "type": ["string", "null"],
      "description": "Meeting length if known, e.g. '1h 35m'"
    },
    "attendees": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["label"],
        "properties": {
          "label": { "type": "string", "description": "Speaker label as it appears in the transcript" },
          "name": { "type": ["string", "null"], "description": "Inferred real name, if identifiable" },
          "role": { "type": ["string", "null"], "description": "Inferred role, e.g. 'business development'" }
        }
      }
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["heading", "content"],
        "properties": {
          "heading": { "type": "string", "description": "Topic heading" },
          "content": {
            "type": "string",
            "description": "Full standalone account of the topic in markdown (bullet points work well). Must cover what was raised, what was discussed, any decision made, and any open questions, in enough detail that no meeting attendance is needed to understand it."
          }
        }
      }
    },
    "action_items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["owner", "tasks"],
        "properties": {
          "owner": { "type": "string", "description": "Person responsible, or 'All' if shared" },
          "tasks": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
\`\`\``;

// Default system prompt for Markdown output mode.
// When this (or any custom prompt that doesn't instruct JSON) is used, Gemini
// returns plain Markdown and the renderer switches to a prose markdown view.
const DEFAULT_MD_SYSTEM_PROMPT = `You are a meeting notes assistant. Write clear, well-structured meeting notes in Markdown format for someone who was NOT in the meeting.

Use these sections as appropriate (omit empty ones):
- **# [Meeting Title]** — top-level heading summarising the meeting focus
- **## Overview** — 2-3 sentence summary of the meeting's purpose and outcome
- **## Participants** — bullet list of speakers/attendees with inferred roles if identifiable
- **## Key Discussion Points** — H3 subheadings for each major topic with concise bullet notes under each
- **## Decisions Made** — bullet list of any decisions reached
- **## Action Items** — bullet list in the format: \`- [ ] Task description — @Owner (due: date if known)\`
- **## Open Questions** — bullet list of unresolved items

Rules:
- Write in plain, neutral English regardless of the transcript's original language(s)
- Do not include filler words, false starts, or verbatim quotes unless critical
- Be concise but complete — a reader should understand the outcome without attending the meeting
- No em dashes; use plain punctuation
- Output ONLY valid Markdown — no JSON, no code fences around the whole document`;

// Alias kept for internal use
const SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

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

async function generateMeetingNotes(transcript, modelId, apiKey, customSystemPrompt) {
  if (!apiKey) throw new Error('Gemini API key is required');

  const selectedModel = resolveModelId(modelId);
  const transcriptText = transcriptToText(transcript);

  logger.info('Generating meeting notes', { modelId: selectedModel, transcriptLength: transcriptText.length });

  const effectivePrompt = (customSystemPrompt && customSystemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;

  // Detect markdown output mode: if the prompt doesn't reference JSON schema we
  // expect a plain markdown response instead of structured JSON.
  const isMarkdownMode = !effectivePrompt.includes('"$schema"') && !effectivePrompt.includes('json\n{');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: selectedModel,
    systemInstruction: effectivePrompt,
  });

  const prompt = isMarkdownMode
    ? `Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate the meeting notes as instructed.`
    : `Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate structured meeting notes in JSON format as specified.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // If this is a markdown-mode prompt, return immediately as raw markdown.
  if (isMarkdownMode) {
    // Strip surrounding markdown code fence if the model wrapped it anyway
    let mdText = text;
    if (mdText.startsWith('```') && mdText.endsWith('```')) {
      mdText = mdText.replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    // Derive a title from the first # heading if present
    const titleMatch = mdText.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Meeting Notes';
    logger.info('Meeting notes generated (markdown mode)', { title });
    return { _rawMarkdown: mdText, title, meeting_title: title };
  }

  // JSON mode — strip markdown code fences if present
  let jsonText = text;
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsedNotes = JSON.parse(jsonText);
    const notes = normalizeNotes(parsedNotes);

    logger.info('Meeting notes generated', {
      title: notes.title,
      actionItems: notes.action_items?.length || 0,
      topics: notes.topics?.length || 0,
      participants: notes.participants?.length || 0,
    });
    return notes;
  } catch (err) {
    logger.error('Failed to parse Gemini JSON response', { error: err.message, text: jsonText.slice(0, 200) });
    // Return a safe fallback structure conforming to the schema
    const fallback = {
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
    return fallback;
  }
}

async function testGeminiConnection(apiKey, modelId) {
  if (!apiKey) throw new Error('Gemini API key is required');
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = resolveModelId(modelId);
  const model = genAI.getGenerativeModel({ model: modelToUse });
  const result = await model.generateContent('Reply with "OK" only.');
  const text = result.response.text();
  if (!text) throw new Error('No response from Gemini API');
}

function getAvailableModels() {
  return AVAILABLE_MODELS;
}

module.exports = {
  generateMeetingNotes,
  getAvailableModels,
  testGeminiConnection,
  AVAILABLE_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MD_SYSTEM_PROMPT,
};
