// The capture window: a hidden window that exists only while a recording runs. It opens the
// system-audio loopback and the microphone, mixes them and streams WebM chunks to main
// (renderer/capture.js). Capture used to live in the main window's renderer, which tied every
// recording to that window: it could never be closed, reloaded or replaced while recording.
//
// One window per recording: created at start, destroyed once the recording has stopped, failed
// to start or timed out, so no stream or AudioContext outlives it.

import path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import logger from '../utils/logger';
import { appRoot } from '../utils/paths';

const isDev = process.env.NODE_ENV === 'development';
const READY_TIMEOUT_MS = 10000;   // from creation to the page reporting it has loaded
const STOP_TIMEOUT_MS = 15000;    // from capture:stop to the "all chunks sent" sentinel

let win: any = null;
let capturing = false;     // between a successful start and the stop
let onReady: any = null;        // (error?) while the page loads
let onStartResult: any = null;  // ({ ok, sources, error }) while waiting for capture:started / failed
let onStopDone: any = null;     // () while waiting for the sentinel
let hooks: any = {};            // { onChunk(buffer), onLevels(levels), onLost(reason) }
let ipcRegistered = false;

function isAlive() {
  return !!win && !win.isDestroyed() && !win.webContents.isDestroyed();
}

function destroyWindow() {
  const w: any = win;
  win = null;   // first, so the window's own handlers ignore this
  capturing = false;
  if (w && !w.isDestroyed()) w.destroy();
}

// The window went away on its own: renderer crash, failed load.
function lost(reason: any, detail?: any) {
  logger.error('Capture window lost', { reason, ...detail });
  const wasCapturing = capturing;
  destroyWindow();
  onReady?.(new Error(reason));
  onStartResult?.({ ok: false, error: reason });
  if (onStopDone) onStopDone();
  else if (wasCapturing) hooks.onLost?.(reason);
}

function createWindow() {
  const w = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    skipTaskbar: true,
    focusable: false,
    title: 'MeetMind capture',
    webPreferences: {
      preload: path.join(__dirname, '..', 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Never shown, so Chromium would throttle its timers and audio processing otherwise.
      backgroundThrottling: false,
    },
  });
  win = w;

  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('render-process-gone', (_e, details) => {
    if (w === win) lost('render-process-gone', { cause: details.reason, exitCode: details.exitCode });
  });
  w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url, isMainFrame) => {
    if (w === win && isMainFrame && errorCode !== -3) lost('load-failed', { errorCode, errorDescription, url });
  });
  w.on('closed', () => {
    if (w === win) lost('window-closed');
  });

  const url = isDev
    ? 'http://localhost:5173/capture.html'
    : `file://${path.join(appRoot, 'dist/renderer/capture.html')}`;
  w.loadURL(url).catch(() => { /* reported by did-fail-load */ });
}

function waitUntilReady() {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { onReady = null; reject(new Error('capture window did not load')); }, READY_TIMEOUT_MS);
    onReady = (error: any) => {
      clearTimeout(timer);
      onReady = null;
      if (error) reject(error);
      else resolve();
    };
  });
}

/**
 * Opens the capture window and starts capturing. Resolves { ok: true, sources: { systemAudio,
 * mic } } once audio is flowing, or { ok: false, error } (the window is gone by then).
 *   requireSystemAudio: fail rather than record the microphone alone (main can fall back to FFmpeg)
 *   timeoutMs: how long the page may take to open its streams (macOS may show permission prompts)
 */
async function startCapture({ requireSystemAudio, timeoutMs }: any) {
  destroyWindow();
  try {
    createWindow();
    await waitUntilReady();
  } catch (err: any) {
    destroyWindow();
    return { ok: false, error: err.message };
  }

  const result = await new Promise<any>((resolve) => {
    const timer = setTimeout(() => onStartResult?.({ ok: false, error: 'timed out opening the audio streams' }), timeoutMs);
    onStartResult = (value: any) => {
      clearTimeout(timer);
      onStartResult = null;
      resolve(value);
    };
    win.webContents.send('capture:start', { requireSystemAudio });
  });

  if (result.ok) capturing = true;
  else destroyWindow();   // a late start in a page that already failed must not keep capturing
  return result;
}

/**
 * Stops the capture: the page flushes its remaining chunks, then sends a sentinel. The chunks
 * already on disk stay usable if that never comes. The window is destroyed either way.
 */
async function stopCapture() {
  if (isAlive()) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn('Capture stop timed out, proceeding with what is on disk');
        onStopDone?.();
      }, STOP_TIMEOUT_MS);
      onStopDone = () => {
        clearTimeout(timer);
        onStopDone = null;
        resolve();
      };
      win.webContents.send('capture:stop');
    });
  }
  destroyWindow();
}

function destroyCapture() {
  onStartResult?.({ ok: false, error: 'cancelled' });
  onStopDone?.();
  destroyWindow();
}

/** Loads the capture window and waits for its page, without capturing. For the smoke test. */
async function probeCaptureWindow() {
  destroyWindow();
  try {
    createWindow();
    await waitUntilReady();
  } finally {
    destroyWindow();
  }
}

/**
 * Registers the capture IPC. Hooks: onChunk(buffer) for each WebM chunk, onLevels({ mic,
 * system }) for the live meters, onLost(reason) when the window dies mid-recording.
 * Safe to call more than once.
 */
function registerCaptureIpc(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  if (ipcRegistered) return;
  ipcRegistered = true;

  const fromCapture = (event: any) => isAlive() && event.sender === win.webContents;

  ipcMain.on('capture:ready', (event) => { if (fromCapture(event)) onReady?.(); });
  ipcMain.on('capture:started', (event, sources) => {
    if (fromCapture(event)) onStartResult?.({ ok: true, sources: sources || {} });
  });
  ipcMain.on('capture:failed', (event, error) => {
    if (fromCapture(event)) onStartResult?.({ ok: false, error: String(error || 'capture failed') });
  });
  ipcMain.on('capture:chunk', (event, buffer) => { if (fromCapture(event)) hooks.onChunk?.(buffer); });
  ipcMain.on('capture:levels', (event, levels) => { if (fromCapture(event) && capturing) hooks.onLevels?.(levels); });
  // Zero-length sentinel: every chunk has been sent.
  ipcMain.on('capture:audio-data', (event) => { if (fromCapture(event)) onStopDone?.(); });
}

export { registerCaptureIpc, startCapture, stopCapture, destroyCapture, probeCaptureWindow };
