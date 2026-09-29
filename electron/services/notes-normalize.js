// Pure note-shaping helpers shared by every LLM provider (no Electron/SDK imports).

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

function buildUserPrompt(transcriptText, markdown) {
  return markdown
    ? `Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate the meeting notes as instructed.`
    : `Here is the meeting transcript:\n\n${transcriptText}\n\nGenerate structured meeting notes in JSON format as specified.`;
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

module.exports = {
  transcriptToText,
  normalizeNotes,
  stripCodeFence,
  isMarkdownPrompt,
  buildUserPrompt,
  parseNotesResponse,
};
