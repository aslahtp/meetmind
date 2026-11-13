// Types for meetings (sessions) and their notes. Types only: no runtime code lives in electron/shared/.
// Sources: electron/db/sessions.ts (columns), renderer/lib/status.ts (statuses), electron/services/prompts.ts
// (the JSON notes schema) and electron/services/notes-normalize.ts.

/** Where a meeting is in its life. See `SESSION_STATUS` in renderer/lib/status.ts. */
export type SessionStatus =
  | 'recording'
  | 'recorded'
  | 'transcribing'
  | 'generating'
  | 'uploading'
  | 'complete'
  | 'error';

/** The platform meeting detection saw, saved as `meeting_platform`. */
export type MeetingPlatform = 'meet' | 'zoom' | 'teams';

/** Pipeline stage as sent by `processing:progress` (`complete` ends the run). */
export type ProcessingProgressStage = 'transcribing' | 'generating' | 'uploading' | 'complete';

/** What `processing:retry` can re-run. */
export type ProcessingRetryStage = 'notes' | 'all' | 'transcription' | 'notion';

/** One transcript segment. Pasted transcripts use `speaker`, `text`, `start_time`, `offset_seconds`; STT providers may add more. */
export interface TranscriptSegment {
  speaker?: string;
  text: string;
  start_time?: number;
  offset_seconds?: number;
  [key: string]: unknown;
}

/**
 * A person in the meeting. `normalizeNotes()` always fills `label`, `name`, `role` and
 * `identity_confidence`; a participant parsed back from edited Markdown (or an older row) has only some.
 * `sanitizeNotes()` turns a value that is not text into null.
 */
export interface NotesParticipant {
  label?: string | null;
  name?: string | null;
  role?: string | null;
  identity_confidence?: string | null;
}

/**
 * One topic of the meeting. The prompt asks for `heading` and `content`; `normalizeNotes()` copies
 * `content` into `summary` and adds the other fields.
 */
export interface NotesTopic {
  heading?: string | null;
  content?: string | null;
  summary?: string | null;
  options_discussed?: string[];
  decision?: string | null;
  open_questions?: string[];
}

/**
 * One thing to do. `normalizeNotes()` flattens the prompt's `{ owner, tasks }` into one item per task, so
 * `tasks` only remains in rows saved before that.
 */
export interface NotesActionItem {
  task?: string | null;
  description?: string | null;
  action?: string | null;
  owner?: string | null;
  due?: string | null;
  priority?: string | null;
  /** Set when ticked (`- [x]`) in the Markdown. */
  done?: boolean;
  tasks?: string[];
}

export interface NotesStatusUpdate {
  completion_estimate?: string | null;
  remaining_scope?: string[];
}

/**
 * Meeting notes as stored in `sessions.notes`: what the LLM returned after `normalizeNotes()` and
 * `sanitizeNotes()` (electron/services/notes-normalize.ts, notes-sanitize.ts), the Markdown text, or the
 * result of editing the Markdown in the app. Every field is optional because Markdown-mode notes
 * (`_rawMarkdown` and the titles), older rows and a live preview that is still streaming have only some.
 * There is no index signature: any other key the LLM returns is stored as it came and read by nothing.
 */
export interface Notes {
  title?: string | null;
  meeting_title?: string | null;
  duration?: string | null;
  sentiment?: string | null;
  participants?: NotesParticipant[];
  /** Names (or labels) of the participants. */
  attendees?: string[];
  status_update?: string | NotesStatusUpdate | null;
  action_items?: NotesActionItem[];
  /** The same topics under three names (older versions used `topics` and `key_points`). */
  sections?: NotesTopic[];
  topics?: NotesTopic[];
  key_points?: NotesTopic[];
  notable_mentions?: string[];
  /** Left by older or custom prompts; stored as the LLM returned them, so only searched or type-checked where read. */
  summary?: unknown;
  decisions?: unknown;
  questions_unresolved?: unknown;
  duration_seconds?: unknown;
  next_meeting?: string | null;
  /** Only the notes `parseNotesResponse()` falls back to when the LLM's JSON can't be parsed. */
  date?: string;
  _rawResponse?: string;
  /** Markdown mode: the notes are this text. */
  _rawMarkdown?: string;
  _llmProvider?: string;
  _llmModel?: string;
  /** Kept so older readers still show the model. */
  _geminiModel?: string;
  _sttService?: string;
  _sttModel?: string;
  /** ISO time of the last edit in the app. */
  _editedAt?: string;
}

/** A meeting row as returned by `sessions:list` / `session:get` (transcript and notes already JSON-parsed). */
export interface Session {
  id: string;
  title: string;
  /** The meeting's own title (detected tab, calendar, pasted title), kept over the LLM's. */
  meeting_title: string | null;
  meeting_url: string | null;
  meeting_platform: MeetingPlatform | null;
  /** ISO timestamps. */
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  audio_path: string | null;
  transcript: TranscriptSegment[];
  notes: Notes | null;
  notion_page_url: string | null;
  status: SessionStatus;
  last_error: string | null;
  /** Set when Settings › Storage deleted the recording; the notes and transcript stay. */
  audio_deleted_at: string | null;
  /** `'transcript'` for a pasted transcript, otherwise null. */
  source: string | null;
}

/** Fields `createSession()` accepts. */
export type NewSession = Pick<Session, 'id'> &
  Partial<
    Pick<
      Session,
      | 'title'
      | 'meeting_title'
      | 'meeting_url'
      | 'meeting_platform'
      | 'started_at'
      | 'audio_path'
      | 'status'
      | 'source'
      | 'duration_seconds'
    >
  >;

/** Fields `updateSession()` may change (anything else is ignored). */
export type SessionUpdate = Partial<
  Pick<
    Session,
    | 'title'
    | 'meeting_title'
    | 'meeting_url'
    | 'started_at'
    | 'ended_at'
    | 'duration_seconds'
    | 'audio_path'
    | 'notion_page_url'
    | 'status'
    | 'last_error'
    | 'audio_deleted_at'
  >
> & {
  /** Stored as JSON text. */
  transcript?: string;
  notes?: string;
};

/** `session:audio-status`: whether the Audio tab has a recording to play, and if not, why. */
export interface SessionAudioStatus {
  available: boolean;
  deletedAt: string | null;
  source: string | null;
  /** Size of the recording file in bytes; null when there is no file. */
  bytes: number | null;
  /** File format of the recording, e.g. 'wav'; null when there is no file. */
  format: string | null;
  /** The meeting is being recorded or processed, so its audio can't be deleted now. */
  busy: boolean;
}
