// Linux meeting-detection backend, the counterpart of win32.ts with the same readers:
//   readMicUsers()       apps recording from a source, from PulseAudio/PipeWire (`pactl list
//                        source-outputs`), as linuxAppId()s
//   listVisibleWindows() window titles from Electron's desktopCapturer, with the app guessed from
//                        each title (appFromWindowTitle). Only on X11 or XWayland: on a native
//                        Wayland session other apps' windows can't be listed, so browser meetings
//                        aren't detected there (the Zoom app still is, by its mic use alone).
// Both sources are asynchronous, so each poll returns the result of the previous refresh and
// starts the next one; the detector's 2-tick debounce absorbs the lag, and the main process never
// waits on pactl.

import { execFileSync } from 'child_process';
import { listSourceOutputs } from '../audio/pulse';
import { errorMessage } from '../utils/errors';
import { linuxAppId, appFromWindowTitle, type MicUsers, type WindowInfo } from './meeting-rules';

let loaded = false;
let loadError: Error | null = null;
let micUsers: MicUsers = { sessions: [], registry: [], sessionsError: null };
let windows: WindowInfo[] = [];
let refreshing = false;

function load(): boolean {
  if (loaded) return !loadError;
  loaded = true;
  if (process.platform !== 'linux') {
    loadError = new Error('This backend is Linux-only');
    return false;
  }
  try {
    execFileSync('pactl', ['--version'], { stdio: 'ignore', timeout: 3000 });
  } catch {
    loadError = new Error('pactl not found (install pulseaudio-utils)');
    return false;
  }
  return true;
}

function isAvailable(): boolean {
  return load();
}

function getLoadError(): Error | null {
  load();
  return loadError;
}

/** Whether other apps' window titles can be read: X11, or XWayland (main.ts forces it when present). */
function canListWindows(): boolean {
  return !!process.env.DISPLAY;
}

async function readWindows(): Promise<WindowInfo[]> {
  if (!canListWindows()) return [];
  const { desktopCapturer }: typeof import('electron') = require('electron');
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources
    .filter((s) => s.name)
    .map((s) => ({ exe: appFromWindowTitle(s.name), title: s.name, bounds: null }));
}

async function refresh(): Promise<void> {
  if (refreshing || !load()) return;
  refreshing = true;
  try {
    const [outputs, wins] = await Promise.allSettled([listSourceOutputs(), readWindows()]);
    if (outputs.status === 'fulfilled') {
      const sessions: string[] = [];
      for (const o of outputs.value) {
        const id = o.binary ? linuxAppId(o.binary) : null;
        if (id && !sessions.includes(id)) sessions.push(id);
      }
      micUsers = { sessions, registry: [], sessionsError: null };
    } else {
      micUsers = { sessions: [], registry: [], sessionsError: errorMessage(outputs.reason) || String(outputs.reason) };
    }
    windows = wins.status === 'fulfilled' ? wins.value : [];
  } finally {
    refreshing = false;
  }
}

/** { sessions, registry, sessionsError }, the shape win32.readMicUsers() returns; registry is always empty. */
function readMicUsers(): MicUsers {
  refresh();
  return micUsers;
}

function listVisibleWindows(): WindowInfo[] {
  return windows;
}

export { isAvailable, getLoadError, readMicUsers, listVisibleWindows, canListWindows };
