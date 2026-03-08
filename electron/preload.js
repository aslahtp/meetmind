const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetmind', {
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
  },

  // Sessions
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    get: (id) => ipcRenderer.invoke('session:get', id),
    delete: (id) => ipcRenderer.invoke('session:delete', id),
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

  // API Tests
  api: {
    testGoogle: (apiKey) => ipcRenderer.invoke('api:test-google', apiKey),
    testGemini: (apiKey) => ipcRenderer.invoke('api:test-gemini', apiKey),
  },

  // Processing
  processing: {
    run: (sessionId) => ipcRenderer.invoke('processing:run', sessionId),
    retry: (sessionId, stage) => ipcRenderer.invoke('processing:retry', sessionId, stage),
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
