const { contextBridge, ipcRenderer } = require('electron');

// Preload for the meeting overlay window. It exposes only what the overlay needs, not the full
// window.meetmind surface. Main passes the effective theme ('light' | 'dark') in argv so
// overlay.html can apply it before first paint, and pushes overlay:theme when it changes.
let startupTheme = 'light';
try {
  const arg = (process.argv || []).find((a) => a.startsWith('--meetmind-theme='));
  if (arg && arg.split('=')[1] === 'dark') startupTheme = 'dark';
} catch { /* theme is cosmetic */ }

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meetmindOverlay', {
  startupTheme,
  // Called once on mount: main shows the window, then answers with the state to render.
  ready:         () => ipcRenderer.invoke('overlay:ready'),
  // Tells main a visible state is rendered; without it main replaces the window.
  shown:         (mode) => ipcRenderer.send('overlay:shown', mode),
  start:         () => ipcRenderer.invoke('overlay:start'),
  stop:          () => ipcRenderer.invoke('overlay:stop'),
  dismiss:       () => ipcRenderer.invoke('overlay:dismiss'),
  keepRecording: () => ipcRenderer.invoke('overlay:keep-recording'),
  openSession:   (sessionId) => ipcRenderer.invoke('overlay:open-session', sessionId),
  resize:        (height) => ipcRenderer.send('overlay:resize', height),
  move:          (deltaX) => ipcRenderer.send('overlay:move', deltaX),
  closed:        () => ipcRenderer.send('overlay:closed'),
  onState:       (callback) => subscribe('overlay:state', callback),
  onTheme:       (callback) => subscribe('overlay:theme', callback),
});
