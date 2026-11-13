// Types for meetings (sessions) and their notes. Types only: no runtime code lives in electron/shared/.
// Sources: electron/db/sessions.js (columns), renderer/lib/status.js (statuses), electron/services/prompts.js
// (the JSON notes schema) and electron/services/notes-normalize.js.

/** Where a meeting is in its life. See `SESSION_STATUS` in renderer/lib/status.js. */
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

export interface NotesAttendee {
  label: string;
  name?: string | null;
  role?: string | null;
}

export interface NotesSection {
  heading: string;
  content: string;
}

export interface NotesActionItem {
  owner: string;
  tasks: string[];
}

/**
 * Meeting notes as stored in `sessions.notes`. JSON mode fills `title`…`action_items`; Markdown mode
 * stores the text in `_rawMarkdown`. `_llm*` / `_stt*` record which engines wrote them.
 */
export interface Notes {
  title?: string;
  meeting_title?: string;
  duration?: string | null;
  attendees?: NotesAttendee[];
  sections?: NotesSection[];
  action_items?: NotesActionItem[];
  _rawMarkdown?: string;
  _llmProvider?: string;
  _llmModel?: string;
  /** Kept so older readers still show the model. */
  _geminiModel?: string;
  _sttService?: string;
  _sttModel?: string;
  [key: string]: unknown;
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
  /** Size of the recording file in bytes, when there is one. */
  bytes?: number;
  /** File format of the recording, e.g. 'wav'. */
  format?: string | null;
  /** The meeting is being recorded or processed, so its audio can't be deleted now. */
  busy?: boolean;
}
