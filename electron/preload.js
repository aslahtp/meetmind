const { contextBridge, ipcRenderer } = require('electron');

// Apply the theme class to <html> before the page's own scripts run, so the
// renderer never paints the wrong theme while the async config:get round-trip is
// in flight. Main passes the saved theme via webPreferences.additionalArguments,
// so this reads argv only — no IPC, nothing that can block or deadlock startup.
//
// This runs *after* exposeInMainWorld below and can never throw: preload executes
// before the document is parsed, so documentElement may not exist yet. Losing the
// theme costs a brief flash; losing the bridge takes out sessions, settings, and
// the custom titlebar's window controls with it.
function applyStartupThemeClass() {
  const root = document && document.documentElement;
  if (!root) return false;

  let effective = 'dark';
  try {
    const arg = (process.argv || []).find((a) => a.startsWith('--meetmind-theme='));
    const configured = arg ? arg.split('=')[1] : 'dark';
    const themeSetting = ['light', 'dark', 'system'].includes(configured) ? configured : 'dark';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    effective = themeSetting === 'system' ? (prefersDark ? 'dark' : 'light') : themeSetting;
  } catch {
    effective = 'dark';
  }

  root.classList.add(effective === 'light' ? 'light' : 'dark');
  return true;
}

contextBridge.exposeInMainWorld('meetmind', {
  // Window controls (frameless window)
  window: {
    minimize:    () => ipcRenderer.invoke('window:minimize'),
    maximize:    () => ipcRenderer.invoke('window:maximize'),
    close:       () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // Shell — open URLs in the system default browser
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },

  // Logs
  logs: {
    get: (options) => ipcRenderer.invoke('logs:get', options),
    getHistory: (options) => ipcRenderer.invoke('logs:get', options),
    clear: () => ipcRenderer.invoke('logs:clear'),
    openFolder: () => ipcRenderer.invoke('logs:openFolder'),
  },

  // Config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    setMultiple: (updates) => ipcRenderer.invoke('config:set-multiple', updates),
  },

  // Recording
  recording: {
    start: (sessionId) => ipcRenderer.invoke('recording:start', sessionId),
    stop: () => ipcRenderer.invoke('recording:stop'),
    listDevices: () => ipcRenderer.invoke('audio:list-devices'),
    probeDevice: (device) => ipcRenderer.invoke('audio:probe-device', device),
    uploadFile: () => ipcRenderer.invoke('audio:import-file'),
  },

  // Sessions
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    get: (id) => ipcRenderer.invoke('session:get', id),
    delete: (id) => ipcRenderer.invoke('session:delete', id),
    openRecording: (id) => ipcRenderer.invoke('session:open-recording', id),
  },

  // Notion
  notion: {
    upload: (sessionId) => ipcRenderer.invoke('notion:upload', sessionId),
    testConnection: (token, dbId) => ipcRenderer.invoke('notion:test', token, dbId),
  },

  // Models
  models: {
    list: () => ipcRenderer.invoke('models:list'),
  },

  // Gemini
  gemini: {
    getDefaultSystemPrompt: () => ipcRenderer.invoke('gemini:default-system-prompt'),
    getMdDefaultSystemPrompt: () => ipcRenderer.invoke('gemini:default-md-system-prompt'),
  },

  // API Tests
  api: {
    testGoogle: (apiKey, projectId) => ipcRenderer.invoke('api:test-google', apiKey, projectId),
    testGemini: (apiKey, modelId) => ipcRenderer.invoke('api:test-gemini', apiKey, modelId),
    testAssemblyAi: (apiKey) => ipcRenderer.invoke('api:test-assemblyai', apiKey),
    testSarvam: (apiKey) => ipcRenderer.invoke('api:test-sarvam', apiKey),
  },

  // Processing
  processing: {
    run: (sessionId) => ipcRenderer.invoke('processing:run', sessionId),
    retry: (sessionId, stage) => ipcRenderer.invoke('processing:retry', sessionId, stage),
  },

  // System audio capture (main ↔ renderer)
  capture: {
    onStart: (callback) => { ipcRenderer.on('capture:start', () => callback()); },
    onStop: (callback) => { ipcRenderer.on('capture:stop', () => callback()); },
    sendStarted: () => ipcRenderer.send('capture:started'),
    sendFailed: (error) => ipcRenderer.send('capture:failed', error),
    sendChunk: (buffer) => ipcRenderer.send('capture:chunk', buffer),
    sendAudioData: (buffer) => ipcRenderer.send('capture:audio-data', buffer),
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
  },

  // FFmpeg
  ffmpeg: {
    check: () => ipcRenderer.invoke('ffmpeg:check'),
    install: () => ipcRenderer.invoke('ffmpeg:install'),
    onProgress: (callback) => {
      const sub = (_e, data) => callback(data);
      ipcRenderer.on('ffmpeg:install-progress', sub);
      return () => ipcRenderer.removeListener('ffmpeg:install-progress', sub);
    },
  },

  // Event listeners
  on: (channel, callback) => {
    const validChannels = [
      'recording:started',
      'recording:stopped',
      'recording:error',
      'transcription:progress',
      'processing:progress',
      'processing:complete',
      'processing:error',
      'ws:extension-connected',
      'ws:recording-requested',
      'sessions:durations-updated',
      'updater:status',
      'log:entry',
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});

// Bridge is up — now the cosmetic part, isolated so a failure here can't affect it.
try {
  if (!applyStartupThemeClass()) {
    // <html> didn't exist yet; retry at the earliest point it must.
    document.addEventListener('DOMContentLoaded', () => {
      try { applyStartupThemeClass(); } catch { /* theme is cosmetic — never fatal */ }
    }, { once: true });
  }
} catch { /* theme is cosmetic — never fatal */ }
