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
    probeDevice: (device) => ipcRenderer.invoke('audio:probe-device', device),
    uploadFile: () => ipcRenderer.invoke('audio:import-file'),
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
    testGoogle: (apiKey, projectId) => ipcRenderer.invoke('api:test-google', apiKey, projectId),
    testGemini: (apiKey, modelId) => ipcRenderer.invoke('api:test-gemini', apiKey, modelId),
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
    sendAudioData: (buffer) => ipcRenderer.send('capture:audio-data', buffer),
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
