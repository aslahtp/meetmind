// Type guards for notes and transcripts (pure, no Electron imports).
//
// Notes come from an LLM and old rows were saved by older versions, so a field the UI renders as
// text can turn out to be an object, a number or a list. React throws on an object child, and
// with the whole window being one React tree that used to blank it. These coerce every field the
// UI displays to the type it expects. They only touch fields that are present: nothing is added,
// so Markdown-mode notes stay as they are.

import type { TranscriptSegment } from '../shared';

/** Parsed JSON of unknown shape: the notes an LLM returned, or a row saved by an older version. */
type JsonObject = Record<string, unknown>;

/** A displayable string, or null. Numbers and booleans are printed; lists of them are joined. */
function toText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(toText).filter((part): part is string => !!part);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

/** A list of non-empty strings. A lone string becomes a one-item list. */
function toTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toText).filter((part): part is string => !!part);
  const text = toText(value);
  return text ? [text] : [];
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textFields(obj: JsonObject, keys: string[]) {
  for (const key of keys) {
    if (key in obj) obj[key] = toText(obj[key]);
  }
}

function listFields(obj: JsonObject, keys: string[]) {
  for (const key of keys) {
    if (key in obj) obj[key] = toTextList(obj[key]);
  }
}

function sanitizeParticipant(p: unknown) {
  const text = toText(p);
  if (text) return { label: text, name: text };
  if (!isObject(p)) return null;
  textFields(p, ['label', 'name', 'role', 'identity_confidence']);
  return p;
}

function sanitizeTopic(t: unknown) {
  const text = toText(t);
  if (text) return { heading: '', content: text, summary: text };
  if (!isObject(t)) return null;
  textFields(t, ['heading', 'content', 'summary', 'decision']);
  listFields(t, ['options_discussed', 'open_questions']);
  return t;
}

function sanitizeActionItem(item: unknown) {
  const text = toText(item);
  if (text) return { task: text };
  if (!isObject(item)) return null;
  textFields(item, ['task', 'description', 'action', 'owner', 'due', 'priority']);
  // { owner, tasks: [...] } is flattened by normalizeNotes; keep it a list of strings for that.
  if ('tasks' in item) item.tasks = toTextList(item.tasks);
  return item;
}

function sanitizeList(notes: JsonObject, key: string, sanitizeEntry: (entry: unknown) => unknown) {
  if (!(key in notes)) return;
  const list = notes[key];
  notes[key] = Array.isArray(list) ? list.map(sanitizeEntry).filter(Boolean) : [];
}

/** Coerces the displayed fields of a notes object in place and returns it. Idempotent. */
function sanitizeNotes<T>(input: T): T {
  if (!isObject(input)) return input;
  const notes: JsonObject = input;

  textFields(notes, ['title', 'meeting_title', 'duration', 'sentiment', 'next_meeting']);
  if ('_rawMarkdown' in notes && typeof notes._rawMarkdown !== 'string') delete notes._rawMarkdown;

  sanitizeList(notes, 'participants', sanitizeParticipant);
  for (const key of ['sections', 'topics', 'key_points']) sanitizeList(notes, key, sanitizeTopic);
  sanitizeList(notes, 'action_items', sanitizeActionItem);
  listFields(notes, ['attendees', 'notable_mentions']);

  if ('status_update' in notes) {
    const status = notes.status_update;
    if (isObject(status)) {
      textFields(status, ['completion_estimate']);
      listFields(status, ['remaining_scope']);
    } else {
      notes.status_update = toText(status);
    }
  }

  return input;
}

/** A transcript as a list of segments with string text and speaker; anything else is dropped. */
function sanitizeTranscript(transcript: unknown): TranscriptSegment[] {
  if (!Array.isArray(transcript)) return [];
  const segments = transcript.filter(isObject).map((seg) => {
    if ('text' in seg) seg.text = toText(seg.text) || '';
    if ('speaker' in seg) seg.speaker = toText(seg.speaker);
    return seg;
  });
  // `text` is a string wherever a segment has one.
  return segments as TranscriptSegment[];
}

export { toText, toTextList, sanitizeNotes, sanitizeTranscript };
