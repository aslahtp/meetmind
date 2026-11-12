const { contextBridge, ipcRenderer } = require('electron');

// Preload for the hidden capture window (electron/audio/capture-window.js). It exposes only the
// capture channels, not the app's window.meetmind surface.
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meetmindCapture', {
  platform: process.platform,
  // The page loaded and is listening for onStart.
  ready:   () => ipcRenderer.send('capture:ready'),
  // options: { requireSystemAudio }: fail rather than record the mic alone (main can fall back).
  onStart: (callback) => subscribe('capture:start', (options) => callback(options || {})),
  onStop:  (callback) => subscribe('capture:stop', () => callback()),
  started: (sources) => ipcRenderer.send('capture:started', sources),
  failed:  (error) => ipcRenderer.send('capture:failed', error),
  chunk:   (buffer) => ipcRenderer.send('capture:chunk', buffer),
  levels:  (levels) => ipcRenderer.send('capture:levels', levels),
  // Zero-length sentinel: every chunk has been sent.
  done:    () => ipcRenderer.send('capture:audio-data', new ArrayBuffer(0)),
});
