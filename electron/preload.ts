/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';
import type { Meetmind } from './shared';

// Apply the theme class to <html> before the page's own scripts run, so the
// renderer never paints the wrong theme while the async config:get round-trip is
// in flight. Main passes the saved theme via webPreferences.additionalArguments,
// so this reads argv only — no IPC, nothing that can block or deadlock startup.
//
// This runs *after* exposeInMainWorld below and can never throw: preload executes
// before the document is parsed, so documentElement may not exist yet. Losing the
// theme costs a brief flash; losing the bridge takes out sessions, settings, and
// the custom titlebar's window controls with it.
function resolveStartupTheme(): 'light' | 'dark' {
  try {
    const arg = (process.argv || []).find((a) => a.startsWith('--meetmind-theme='));
    const configured = arg ? arg.split('=')[1] : 'light';
    const themeSetting = ['light', 'dark', 'system'].includes(configured) ? configured : 'light';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return (themeSetting === 'system' ? (prefersDark ? 'dark' : 'light') : themeSetting) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyStartupThemeClass() {
  const root = document && document.documentElement;
  if (!root) return false;
  root.classList.add(resolveStartupTheme());
  return true;
}

// Resolved once, before the page's scripts run: an inline <head> script in index.html reads it
// so the startup splash paints in the saved theme (the fallback below only lands at
// DOMContentLoaded, after the splash has already been painted).
let startupTheme: 'light' | 'dark' = 'light';
try { startupTheme = resolveStartupTheme(); } catch { /* theme is cosmetic — never fatal */ }

// Startup splash: main sends window:shown whenever the window goes from hidden to visible (first
// launch, reopening from the tray). Relay it to the page as a DOM event, which crosses the
// context-isolation boundary, and remember it: the first one can arrive before the page's own
// scripts are listening, and a reload happens with the window already visible.
let windowShown = false;
function markWindowShown() {
  windowShown = true;
  try { window.dispatchEvent(new Event('meetmind:window-shown')); } catch { /* cosmetic */ }
}
ipcRenderer.on('window:shown', markWindowShown);
ipcRenderer.invoke('window:isVisible')
  .then((visible) => { if (visible && !windowShown) markWindowShown(); })
  .catch(() => { /* cosmetic — the page falls back to a timer */ });

// Health check (electron/window/main-window.js): main pings whenever the window is shown, to tell
// a working window from one that is up but blank. Answered here, not in the app's code, so it
// still answers when React has failed. Reports whether React has rendered into #root, whether the
// startup splash still covers the page, and whether the page produced a frame.
const FRAME_WAIT_MS = 2000;
ipcRenderer.on('window:health-ping', (_event, id) => {
  let answered = false;
  const answer = (frame: any) => {
    if (answered) return;
    answered = true;
    let mounted = false;
    let splash = false;
    try {
      mounted = (document.getElementById('root')?.childElementCount || 0) > 0;
      splash = !!document.getElementById('splash');
    } catch { /* reported as not mounted */ }
    ipcRenderer.send('window:health-pong', id, { mounted, splash, frame });
  };
  try {
    window.requestAnimationFrame(() => answer(true));
    // A busy page runs this timer late, together with the frame it was waiting for: give the
    // frame one more turn before reporting that none came.
    setTimeout(() => setTimeout(() => answer(false), 250), FRAME_WAIT_MS);
  } catch {
    answer(false);
  }
});

// Live log lines are only sent while something listens for them (the Logs page).
let logListeners = 0;

// Typed against the contract in electron/shared/ipc.ts, which the renderer's window.meetmind also uses.
const meetmind: Meetmind = {
  // Effective theme ('light' | 'dark') at launch, for index.html's pre-paint script.
  startupTheme,

  // Host OS ('win32' | 'darwin' | ...), for OS-specific copy and window chrome. See renderer/lib/os.js.
  platform: process.platform,

  // Window controls (frameless window)
  window: {
    minimize:    () => ipcRenderer.invoke('window:minimize'),
    maximize:    () => ipcRenderer.invoke('window:maximize'),
    close:       () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    // True once the window has been on screen (see markWindowShown); used by the startup splash.
    wasShown:    () => windowShown,
    // The app has mounted. Main waits for this after creating or reloading the window, and
    // repairs a window that never sends it.
    ready:       () => ipcRenderer.send('window:ready'),
    // Unsaved edits on screen: a window hidden to the tray is then kept instead of closed.
    setDirty:    (dirty: any) => ipcRenderer.send('window:dirty', !!dirty),
    // The page being shown ({ view, sessionId }), so a new window reopens on it.
    setViewState: (state: any) => ipcRenderer.send('window:view-state', state),
  },

  // Sends a renderer error to the log file. See renderer/lib/errorReport.js.
  reportError: (report: any) => ipcRenderer.send('renderer:error', report),

  // Shell — open URLs in the system default browser
  shell: {
    openExternal: (url: any) => ipcRenderer.invoke('shell:open-external', url),
  },

  // Logs
  logs: {
    get: (options: any) => ipcRenderer.invoke('logs:get', options),
    getHistory: (options: any) => ipcRenderer.invoke('logs:get', options),
    clear: () => ipcRenderer.invoke('logs:clear'),
    openFolder: () => ipcRenderer.invoke('logs:openFolder'),
  },

  // Config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key: any, value: any) => ipcRenderer.invoke('config:set', key, value),
    setMultiple: (updates: any) => ipcRenderer.invoke('config:set-multiple', updates),
    autoLaunchStatus: () => ipcRenderer.invoke('config:autoLaunchStatus'),
  },

  // Recording
  recording: {
    // meetingUrl/meetingTitle come from a calendar event when recording one from the Dashboard.
    start: (sessionId: any, meetingUrl: any, meetingTitle: any) => ipcRenderer.invoke('recording:start', sessionId, meetingUrl, meetingTitle),
    stop: () => ipcRenderer.invoke('recording:stop'),
    listDevices: () => ipcRenderer.invoke('audio:list-devices'),
    probeDevice: (device: any) => ipcRenderer.invoke('audio:probe-device', device),
    // Linux: the audio server (PulseAudio / PipeWire) and whether FFmpeg can record from it.
    linuxStatus: () => ipcRenderer.invoke('audio:linux-status'),
    uploadFile: () => ipcRenderer.invoke('audio:import-file'),
  },

  // Sessions
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    revision: () => ipcRenderer.invoke('sessions:revision'),
    get: (id: any) => ipcRenderer.invoke('session:get', id),
    delete: (id: any) => ipcRenderer.invoke('session:delete', id),
    updateNotes: (id: any, notes: any) => ipcRenderer.invoke('session:update-notes', id, notes),
    rename: (id: any, title: any) => ipcRenderer.invoke('session:rename', id, title),
    openRecording: (id: any) => ipcRenderer.invoke('session:open-recording', id),
    waveform: (id: any) => ipcRenderer.invoke('session:waveform', id),
    // { available, deletedAt, source, bytes, format, busy }: whether the Audio tab has a recording
    // to play (and its size), and if not, why.
    audioStatus: (id: any) => ipcRenderer.invoke('session:audio-status', id),
    // Deletes the meeting's audio only; { success, bytes } or { success: false, error }.
    deleteRecording: (id: any) => ipcRenderer.invoke('session:delete-recording', id),
    createFromTranscript: (opts: any) => ipcRenderer.invoke('session:create-from-transcript', opts),
  },

  // Recording storage (Settings › Storage). Deleting keeps each meeting's notes and transcript.
  storage: {
    // retentionDays previews an unsaved "Keep recordings" choice; omit it for the saved one.
    summary: (retentionDays: any) => ipcRenderer.invoke('storage:summary', retentionDays),
    cleanup: () => ipcRenderer.invoke('storage:cleanup'),
    deleteAll: () => ipcRenderer.invoke('storage:delete-all'),
    openFolder: () => ipcRenderer.invoke('storage:open-folder'),
  },

  // Native dialogs
  dialog: {
    chooseFolder: (opts: any) => ipcRenderer.invoke('dialog:choose-folder', opts),
  },

  // PDF export
  pdf: {
    export: (sessionId: any, html: any) => ipcRenderer.invoke('pdf:export', sessionId, html),
    reveal: (filePath: any) => ipcRenderer.invoke('pdf:reveal', filePath),
    defaultDir: () => ipcRenderer.invoke('pdf:default-dir'),
  },

  // Notion
  notion: {
    upload: (sessionId: any) => ipcRenderer.invoke('notion:upload', sessionId),
    testConnection: (token: any, dbId: any) => ipcRenderer.invoke('notion:test', token, dbId),
  },

  // STT / LLM providers (descriptors + generic connection test)
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    test: (opts: any) => ipcRenderer.invoke('providers:test', opts),
  },

  // Gemini
  gemini: {
    getDefaultSystemPrompt: () => ipcRenderer.invoke('gemini:default-system-prompt'),
    getMdDefaultSystemPrompt: () => ipcRenderer.invoke('gemini:default-md-system-prompt'),
  },

  // Processing
  processing: {
    run: (sessionId: any) => ipcRenderer.invoke('processing:run', sessionId),
    retry: (sessionId: any, stage: any) => ipcRenderer.invoke('processing:retry', sessionId, stage),
  },

  // Recordings are captured in their own hidden window (electron/audio/capture-window.js), not
  // here. This is only Settings' "Test system audio", which runs a short capture in this window.
  capture: {
    // Switch the macOS capture strategy for one test capture.
    testBegin: (strategy: any) => ipcRenderer.invoke('capture:test-begin', strategy),
    testEnd: () => ipcRenderer.invoke('capture:test-end'),
  },

  // macOS privacy permissions (microphone, Screen & System Audio Recording)
  permissions: {
    status: () => ipcRenderer.invoke('permissions:status'),
    request: (kind: any) => ipcRenderer.invoke('permissions:request', kind),
    openSettings: (kind: any) => ipcRenderer.invoke('permissions:open-settings', kind),
  },

  // Calendars: Google accounts and ICS links (up to 5). Sources come back redacted.
  calendar: {
    list: () => ipcRenderer.invoke('calendar:list'),
    add: (input: any) => ipcRenderer.invoke('calendar:add', input),
    update: (id: any, patch: any) => ipcRenderer.invoke('calendar:update', id, patch),
    remove: (id: any) => ipcRenderer.invoke('calendar:remove', id),
    reconnect: (id: any) => ipcRenderer.invoke('calendar:reconnect', id),
    cancelAuth: () => ipcRenderer.invoke('calendar:cancel-auth'),
    getEvents: (options: any) => ipcRenderer.invoke('calendar:events', options),
  },

  // Auto updater
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    // { recording, processing, notesPreview, view }: what is going on in main right now, for a
    // window that was just created or reloaded.
    getState: () => ipcRenderer.invoke('app:state'),
  },

  // FFmpeg
  ffmpeg: {
    check: () => ipcRenderer.invoke('ffmpeg:check'),
    install: () => ipcRenderer.invoke('ffmpeg:install'),
    onProgress: (callback: any) => {
      const sub = (_e: any, data: any) => callback(data);
      ipcRenderer.on('ffmpeg:install-progress', sub);
      return () => ipcRenderer.removeListener('ffmpeg:install-progress', sub);
    },
  },

  // Event listeners
  on: (channel: any, callback: any) => {
    const validChannels = [
      'recording:started',
      'recording:stopped',
      'recording:error',
      'recording:warning',
      'recording:levels',
      'transcription:progress',
      'processing:progress',
      'processing:complete',
      'processing:error',
      'processing:cancelled',
      'notes:preview',
      'ws:extension-connected',
      'ws:recording-requested',
      'sessions:changed',
      'updater:status',
      'calendar:meeting-starting',
      'calendar:changed',
      'llm:fallback-used',
      'log:entry',
      'app:open-session',
      'app:navigate',
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event: any, ...args: unknown[]) => (callback as (...a: unknown[]) => void)(...args);
      ipcRenderer.on(channel, subscription);
      if (channel === 'log:entry' && ++logListeners === 1) ipcRenderer.send('logs:subscribe');
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        ipcRenderer.removeListener(channel, subscription);
        if (channel === 'log:entry' && --logListeners === 0) ipcRenderer.send('logs:unsubscribe');
      };
    }
  },
};
contextBridge.exposeInMainWorld('meetmind', meetmind);

// Bridge is up — now the cosmetic part, isolated so a failure here can't affect it.
try {
  if (!applyStartupThemeClass()) {
    // <html> didn't exist yet; retry at the earliest point it must.
    document.addEventListener('DOMContentLoaded', () => {
      try { applyStartupThemeClass(); } catch { /* theme is cosmetic — never fatal */ }
    }, { once: true });
  }
} catch { /* theme is cosmetic — never fatal */ }
