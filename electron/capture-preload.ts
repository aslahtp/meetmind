import { contextBridge, ipcRenderer } from 'electron';

// Preload for the hidden capture window (electron/audio/capture-window.js). It exposes only the
// capture channels, not the app's window.meetmind surface.
function subscribe(channel: any, callback: any) {
  const listener = (_event: any, payload: any) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meetmindCapture', {
  platform: process.platform,
  // The page loaded and is listening for onStart.
  ready:   () => ipcRenderer.send('capture:ready'),
  // options: { requireSystemAudio }: fail rather than record the mic alone (main can fall back).
  onStart: (callback: any) => subscribe('capture:start', (options: any) => callback(options || {})),
  onStop:  (callback: any) => subscribe('capture:stop', () => callback()),
  started: (sources: any) => ipcRenderer.send('capture:started', sources),
  failed:  (error: any) => ipcRenderer.send('capture:failed', error),
  chunk:   (buffer: any) => ipcRenderer.send('capture:chunk', buffer),
  levels:  (levels: any) => ipcRenderer.send('capture:levels', levels),
  // Zero-length sentinel: every chunk has been sent.
  done:    () => ipcRenderer.send('capture:audio-data', new ArrayBuffer(0)),
});
