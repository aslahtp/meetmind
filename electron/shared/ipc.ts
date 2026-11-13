// The contract between the main process and the renderer, as types only.
//
//   IpcInvokeMap  every `ipcMain.handle` channel: its arguments and what it resolves with
//   IpcSendMap    fire-and-forget renderer → main messages (`ipcRenderer.send`)
//   IpcEventMap   main → renderer events the renderer may subscribe to (`window.meetmind.on`)
//   Meetmind / MeetmindOverlay   the objects electron/preload.js and electron/overlay-preload.js expose
//
// Every result type was read off the handler in electron/main.js (or overlay-window.js). Where the handler's
// result is built by a service that hasn't been typed yet, the type is deliberately loose and listed in
// the TODO(strict) checklist below; tighten it when that service is ported (Phases 5-7).
//
// TODO(strict):
//   - `audio:list-devices` / `audio:probe-device` (electron/audio/recorder.js)
//   - `storage:summary` (electron/services/storage-rules.js `summarize`)
//   - `pdf:export` extra fields, `notion:test` extra fields, `ffmpeg:install` (ffmpeg-installer.js)
//   - `transcription:progress` is whitelisted in preload.js but nothing sends it today

import type { ConfigKey, ConfigUpdate, AutoLaunchStatus, MacCaptureStrategy, RendererConfig } from './config';
import type {
  CalendarAddInput,
  CalendarEvent,
  CalendarEventsResult,
  CalendarList,
  CalendarOutcome,
  CalendarSource,
  CalendarUpdatePatch,
} from './calendar';
import type { OverlayMode, OverlayState } from './overlay';
import type { ProviderDescriptors, ProviderTestInput } from './providers';
import type {
  Notes,
  ProcessingProgressStage,
  ProcessingRetryStage,
  Session,
  SessionAudioStatus,
} from './session';
import type { UpdaterActionResult, UpdaterState } from './updater';

// ── Result shapes ─────────────────────────────────────────────────────────────

/**
 * Most handlers resolve `{ success: true, ... }` or `{ success: false, error }` instead of throwing.
 * Narrow with `if (!r.success)` / `if (r.success)` (needs `strictNullChecks`, which is on).
 */
export type Outcome<T = unknown> = ({ success: true } & T) | { success: false; error: string };

export interface LogEntry {
  timestamp: string;
  /** 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' (upper-cased from the log file). */
  level: string;
  message: string;
  context?: string;
  meta: unknown;
}

export type PermissionState =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'
  | 'not-applicable';

/** `permissions:status` (macOS; everything is 'not-applicable' elsewhere). */
export interface PermissionStatus {
  microphone: PermissionState;
  screen: PermissionState;
}

export type PermissionKind = 'microphone' | 'screen';

/** `recording:start` / `recording:stop` */
export type RecordingResult = Outcome<{ sessionId: string }>;

/** `audio:linux-status` */
export type LinuxAudioStatus =
  | { error: 'Linux only' }
  | {
      server: string | null;
      defaultSink: string | null;
      defaultSource: string | null;
      ffmpegPulse: boolean;
      error: string | null;
    };

/** `audio:list-devices` (TODO(strict)) */
export interface AudioDeviceList {
  all?: unknown[];
  error?: string;
  [key: string]: unknown;
}

export interface FfmpegBinaryInfo {
  found: boolean;
  /** 'bundled' | 'installed' | 'homebrew' | 'path' */
  source: string | null;
  path: string | null;
  version: string | null;
}

export interface FfmpegInstallProgress {
  stage: string;
  percent: number;
  message?: string;
}

/** `storage:summary` (TODO(strict)): `dir` plus what `summarize()` returns. */
export interface StorageSummary {
  dir: string;
  [key: string]: unknown;
}

export interface StorageCleanupCounts {
  count: number;
  bytes: number;
  failed: number;
}

// ── Invoke channels (renderer → main, with a reply) ──────────────────────────

type Handler<Args extends unknown[], Result> = { args: Args; result: Result };

export interface IpcInvokeMap {
  // Window
  'window:minimize': Handler<[], void>;
  'window:maximize': Handler<[], void>;
  'window:close': Handler<[], void>;
  'window:isVisible': Handler<[], boolean>;
  'window:isMaximized': Handler<[], boolean>;
  /** Only http(s) URLs open; anything else is ignored. */
  'shell:open-external': Handler<[url: string], void>;

  // Logs
  'logs:get': Handler<[options?: { limit?: number }], LogEntry[]>;
  'logs:clear': Handler<[], boolean>;
  /** Resolves '' on success, else an error message (Electron's `shell.openPath`). */
  'logs:openFolder': Handler<[], string>;

  // Config
  'config:get': Handler<[], RendererConfig>;
  'config:autoLaunchStatus': Handler<[], AutoLaunchStatus>;
  /** `false` for the `calendars` key (use `calendar:*`), otherwise `true`. */
  'config:set': Handler<[key: ConfigKey, value: unknown], boolean>;
  'config:set-multiple': Handler<[updates: ConfigUpdate], true>;

  // macOS permissions and the system-audio test
  'permissions:status': Handler<[], PermissionStatus>;
  'permissions:request': Handler<[kind: PermissionKind], { granted: boolean }>;
  'permissions:open-settings': Handler<[kind: string], boolean>;
  'capture:test-begin': Handler<
    [strategy: MacCaptureStrategy],
    { success: true; strategy: MacCaptureStrategy } | { success: false; error: string }
  >;
  'capture:test-end': Handler<[], true>;

  // Recording
  'recording:start': Handler<[sessionId?: string | null, meetingUrl?: string, meetingTitle?: string], RecordingResult>;
  'recording:stop': Handler<[], RecordingResult>;
  'audio:list-devices': Handler<[], AudioDeviceList>;
  'audio:probe-device': Handler<[device: string], { error?: string; [key: string]: unknown }>;
  'audio:linux-status': Handler<[], LinuxAudioStatus>;
  'audio:import-file': Handler<
    [],
    { success: true; sessionId: string } | { success: false; cancelled: true } | { success: false; error: string }
  >;

  // Meeting overlay (its own window, see MeetmindOverlay)
  'overlay:ready': Handler<[], OverlayState>;
  'overlay:start': Handler<[], RecordingResult>;
  'overlay:stop': Handler<[], RecordingResult>;
  'overlay:dismiss': Handler<[], true>;
  'overlay:keep-recording': Handler<[], true>;
  'overlay:open-session': Handler<[sessionId: string], true>;

  // Sessions
  'sessions:list': Handler<[], Session[]>;
  /** Bumped on every database write; cheaper than `sessions:list`. */
  'sessions:revision': Handler<[], number>;
  'session:get': Handler<[id: string], Session | null>;
  'session:delete': Handler<[id: string], true>;
  'session:update-notes': Handler<[id: string, notes: Notes], Outcome<{ session: Session }>>;
  'session:rename': Handler<[id: string, title: string], Outcome<{ session: Session }>>;
  'session:open-recording': Handler<[sessionId: string], Outcome<{ path: string }>>;
  'session:waveform': Handler<[sessionId: string], Outcome<{ peaks: number[]; duration: number }>>;
  'session:audio-status': Handler<[sessionId: string], SessionAudioStatus>;
  'session:create-from-transcript': Handler<
    [options: { title?: string; transcriptText: string }],
    Outcome<{ sessionId: string }>
  >;

  // Recording storage (Settings › Storage)
  'storage:summary': Handler<[retentionDays?: number], StorageSummary>;
  'storage:cleanup': Handler<[], Outcome<StorageCleanupCounts>>;
  'storage:delete-all': Handler<[], Outcome<StorageCleanupCounts & { skipped: number }>>;
  'storage:open-folder': Handler<[], Outcome>;

  // Dialogs and PDF
  'dialog:choose-folder': Handler<
    [options?: { title?: string; defaultPath?: string }],
    { cancelled: true } | { path: string }
  >;
  'pdf:default-dir': Handler<[], string>;
  'pdf:export': Handler<[sessionId: string, html: string], Outcome<{ path: string }>>;
  'pdf:reveal': Handler<[filePath: string], Outcome>;

  // Notion
  'notion:upload': Handler<[sessionId: string], Outcome<{ url: string }>>;
  'notion:test': Handler<[token: string, pageId: string], Outcome<Record<string, unknown>>>;

  // Providers and prompts
  'providers:list': Handler<[], ProviderDescriptors>;
  'providers:test': Handler<[options: ProviderTestInput], Outcome>;
  'gemini:default-system-prompt': Handler<[], string>;
  'gemini:default-md-system-prompt': Handler<[], string>;

  // Processing
  'processing:run': Handler<[sessionId: string], Outcome>;
  'processing:retry': Handler<[sessionId: string, stage: ProcessingRetryStage], Outcome<{ url?: string }>>;

  // Updater and app
  'updater:check': Handler<[], UpdaterActionResult>;
  'updater:download': Handler<[], UpdaterActionResult>;
  'updater:install': Handler<[], UpdaterActionResult>;
  'updater:get-status': Handler<[], UpdaterState>;
  'app:version': Handler<[], string>;

  // FFmpeg
  'ffmpeg:check': Handler<[], { ffmpeg: FfmpegBinaryInfo; ffprobe: FfmpegBinaryInfo }>;
  'ffmpeg:install': Handler<[], Outcome>;

  // Calendars
  'calendar:list': Handler<[], CalendarList>;
  'calendar:add': Handler<
    [input: CalendarAddInput],
    CalendarOutcome<{ source: CalendarSource; eventCount?: number; existing?: boolean }>
  >;
  'calendar:update': Handler<[id: string, patch: CalendarUpdatePatch], CalendarOutcome<{ source: CalendarSource }>>;
  'calendar:remove': Handler<[id: string], CalendarOutcome<{ removed: true }>>;
  'calendar:reconnect': Handler<[id: string], CalendarOutcome<{ source: CalendarSource }>>;
  'calendar:cancel-auth': Handler<[], void>;
  'calendar:events': Handler<[options?: { force?: boolean }], CalendarOutcome<CalendarEventsResult>>;
}

// ── Send channels (renderer → main, no reply) ────────────────────────────────

export interface IpcSendMap {
  /** Renderer capture is running; `systemAudio` is false when only the microphone is being recorded. */
  'capture:started': [sources: { systemAudio?: boolean; [key: string]: unknown } | undefined];
  'capture:failed': [error: unknown];
  /** A chunk of the in-progress .webm. */
  'capture:chunk': [buffer: ArrayBuffer | Uint8Array];
  /** A zero-length buffer is the "all chunks flushed" sentinel after `capture:stop`. */
  'capture:audio-data': [buffer: ArrayBuffer | Uint8Array];
  'overlay:shown': [mode: OverlayMode];
  'overlay:resize': [height: number];
  'overlay:move': [deltaX: number];
  'overlay:closed': [];
}

// ── Events (main → renderer) ─────────────────────────────────────────────────

export interface LlmFallbackNotice {
  sessionId: string;
  primaryProvider: string;
  primaryModel: string;
  fallbackProvider: string;
  fallbackModel: string;
}

export interface NotesPreview {
  sessionId: string;
  /** 0 for the primary model, 1 for the fallback. */
  attempt: number;
  provider: string;
  model: string;
  /** The notes written so far; null starts each attempt with a clean preview. */
  notes: Notes | null;
  /** Estimated share written, 0 to <1. */
  progress?: number;
}

/**
 * Events `window.meetmind.on()` accepts: exactly the channels whitelisted in electron/preload.js.
 * `void` means the event carries no payload.
 */
export interface IpcEventMap {
  'recording:started': { sessionId: string };
  'recording:stopped': { sessionId: string; audioPath?: string };
  'recording:error': { error: string };
  /** Whitelisted but never sent today (TODO(strict)). */
  'transcription:progress': unknown;
  'processing:progress': { stage: ProcessingProgressStage; percent: number };
  'processing:complete': { sessionId: string; notionUrl?: string | null };
  'processing:error': { sessionId: string; error: string };
  'processing:cancelled': { sessionId: string };
  'notes:preview': NotesPreview;
  'ws:extension-connected': { origin: string };
  'ws:recording-requested': { meetingUrl?: string; meetingTitle?: string };
  'sessions:changed': { revision: number };
  'updater:status': UpdaterState;
  'calendar:meeting-starting': CalendarEvent;
  'calendar:changed': void;
  'llm:fallback-used': LlmFallbackNotice;
  'log:entry': LogEntry;
  'app:open-session': { sessionId: string };
  /** The view to switch to, e.g. 'settings'. */
  'app:navigate': string;
}

export type IpcEventChannel = keyof IpcEventMap;

/** Pushed to the overlay window only (see MeetmindOverlay). */
export interface OverlayEventMap {
  'overlay:state': OverlayState;
  'overlay:theme': 'light' | 'dark';
}

// ── window.meetmind ──────────────────────────────────────────────────────────

type Invoke<C extends keyof IpcInvokeMap> = (...args: IpcInvokeMap[C]['args']) => Promise<IpcInvokeMap[C]['result']>;

/** Options main sends with `capture:start`. */
export interface CaptureStartOptions {
  /** Fail rather than record the microphone alone (main can fall back to FFmpeg). */
  requireSystemAudio?: boolean;
}

/**
 * `window.meetmind`, as exposed by electron/preload.js. Method names differ from channel names, so this is
 * written out rather than derived; each member uses `Invoke<channel>` so its types come from the maps above.
 */
export interface Meetmind {
  /** Effective theme at launch, for index.html's pre-paint script. */
  startupTheme: 'light' | 'dark';
  /** `process.platform` ('win32' | 'darwin' | 'linux' | ...). */
  platform: string;

  window: {
    minimize: Invoke<'window:minimize'>;
    maximize: Invoke<'window:maximize'>;
    close: Invoke<'window:close'>;
    isMaximized: Invoke<'window:isMaximized'>;
    /** True once the window has been on screen (synchronous). */
    wasShown: () => boolean;
  };
  shell: { openExternal: Invoke<'shell:open-external'> };
  logs: {
    get: Invoke<'logs:get'>;
    getHistory: Invoke<'logs:get'>;
    clear: Invoke<'logs:clear'>;
    openFolder: Invoke<'logs:openFolder'>;
  };
  config: {
    get: Invoke<'config:get'>;
    set: Invoke<'config:set'>;
    setMultiple: Invoke<'config:set-multiple'>;
    autoLaunchStatus: Invoke<'config:autoLaunchStatus'>;
  };
  recording: {
    start: Invoke<'recording:start'>;
    stop: Invoke<'recording:stop'>;
    listDevices: Invoke<'audio:list-devices'>;
    probeDevice: Invoke<'audio:probe-device'>;
    linuxStatus: Invoke<'audio:linux-status'>;
    uploadFile: Invoke<'audio:import-file'>;
  };
  sessions: {
    list: Invoke<'sessions:list'>;
    revision: Invoke<'sessions:revision'>;
    get: Invoke<'session:get'>;
    delete: Invoke<'session:delete'>;
    updateNotes: Invoke<'session:update-notes'>;
    rename: Invoke<'session:rename'>;
    openRecording: Invoke<'session:open-recording'>;
    waveform: Invoke<'session:waveform'>;
    audioStatus: Invoke<'session:audio-status'>;
    createFromTranscript: Invoke<'session:create-from-transcript'>;
  };
  storage: {
    summary: Invoke<'storage:summary'>;
    cleanup: Invoke<'storage:cleanup'>;
    deleteAll: Invoke<'storage:delete-all'>;
    openFolder: Invoke<'storage:open-folder'>;
  };
  dialog: { chooseFolder: Invoke<'dialog:choose-folder'> };
  pdf: {
    export: Invoke<'pdf:export'>;
    reveal: Invoke<'pdf:reveal'>;
    defaultDir: Invoke<'pdf:default-dir'>;
  };
  notion: {
    upload: Invoke<'notion:upload'>;
    testConnection: Invoke<'notion:test'>;
  };
  providers: {
    list: Invoke<'providers:list'>;
    test: Invoke<'providers:test'>;
  };
  gemini: {
    getDefaultSystemPrompt: Invoke<'gemini:default-system-prompt'>;
    getMdDefaultSystemPrompt: Invoke<'gemini:default-md-system-prompt'>;
  };
  processing: {
    run: Invoke<'processing:run'>;
    retry: Invoke<'processing:retry'>;
  };
  capture: {
    /** No unsubscribe: register once. */
    onStart: (callback: (options: CaptureStartOptions) => void) => void;
    onStop: (callback: () => void) => void;
    sendStarted: (...args: IpcSendMap['capture:started']) => void;
    sendFailed: (...args: IpcSendMap['capture:failed']) => void;
    sendChunk: (...args: IpcSendMap['capture:chunk']) => void;
    sendAudioData: (...args: IpcSendMap['capture:audio-data']) => void;
    testBegin: Invoke<'capture:test-begin'>;
    testEnd: Invoke<'capture:test-end'>;
  };
  permissions: {
    status: Invoke<'permissions:status'>;
    request: Invoke<'permissions:request'>;
    openSettings: Invoke<'permissions:open-settings'>;
  };
  calendar: {
    list: Invoke<'calendar:list'>;
    add: Invoke<'calendar:add'>;
    update: Invoke<'calendar:update'>;
    remove: Invoke<'calendar:remove'>;
    reconnect: Invoke<'calendar:reconnect'>;
    cancelAuth: Invoke<'calendar:cancel-auth'>;
    getEvents: Invoke<'calendar:events'>;
  };
  updater: {
    check: Invoke<'updater:check'>;
    download: Invoke<'updater:download'>;
    install: Invoke<'updater:install'>;
    getStatus: Invoke<'updater:get-status'>;
  };
  app: { getVersion: Invoke<'app:version'> };
  ffmpeg: {
    check: Invoke<'ffmpeg:check'>;
    install: Invoke<'ffmpeg:install'>;
    /** Returns an unsubscribe function. */
    onProgress: (callback: (progress: FfmpegInstallProgress) => void) => () => void;
  };

  /** Subscribes to a whitelisted event; returns an unsubscribe function (undefined for an unknown channel). */
  on: <C extends IpcEventChannel>(
    channel: C,
    callback: (payload: IpcEventMap[C]) => void,
  ) => (() => void) | undefined;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

// ── window.meetmindOverlay ───────────────────────────────────────────────────

/** `window.meetmindOverlay`, as exposed by electron/overlay-preload.js (the overlay window's own, smaller surface). */
export interface MeetmindOverlay {
  startupTheme: 'light' | 'dark';
  /** Called once on mount: main shows the window, then answers with the state to render. */
  ready: Invoke<'overlay:ready'>;
  /** Tells main a visible state is rendered; without it main replaces the window. */
  shown: (...args: IpcSendMap['overlay:shown']) => void;
  start: Invoke<'overlay:start'>;
  stop: Invoke<'overlay:stop'>;
  dismiss: Invoke<'overlay:dismiss'>;
  keepRecording: Invoke<'overlay:keep-recording'>;
  openSession: Invoke<'overlay:open-session'>;
  resize: (...args: IpcSendMap['overlay:resize']) => void;
  move: (...args: IpcSendMap['overlay:move']) => void;
  closed: (...args: IpcSendMap['overlay:closed']) => void;
  onState: (callback: (state: OverlayState) => void) => () => void;
  onTheme: (callback: (theme: 'light' | 'dark') => void) => () => void;
}
