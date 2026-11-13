// The floating meeting overlay: a small frameless, transparent, always-on-top window that never
// takes focus, so it can sit over a Meet/Zoom call without stealing keystrokes. It renders
// renderer/overlay.html and is driven entirely by the state main pushes on overlay:state.
//
// A fresh window is made for each show and destroyed once it closes; overlay-lifecycle.ts decides
// when. The renderer invokes overlay:ready once loaded (the window is shown then, so its opening
// animation plays on screen) and sends overlay:shown once it has rendered a visible state; a
// capture then checks that something was actually painted. A window that crashes, fails to load,
// stays silent or paints nothing is replaced once, and if that fails too `onFailure` lets main
// prompt another way. Every step is logged, so a missing overlay shows up in the log.

import path from 'path';
import { app, BrowserWindow, ipcMain, screen, type Display, type WebContents } from 'electron';
import logger from '../utils/logger';
import { appRoot } from '../utils/paths';
import { errorMessage } from '../utils/errors';
import type { Bounds, EffectiveTheme, OverlayState } from '../shared/overlay';
import { createLifecycle, reduceOverlay, type LifecycleAction, type LifecycleEvent } from './overlay-lifecycle';

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const WIDTH = 360;
const INITIAL_HEIGHT = 56;
const TOP_MARGIN = 12;
const CLOSE_FALLBACK_MS = 1200;   // destroy anyway if the renderer never reports its close animation done
const ACK_TIMEOUT_MS = 5000;      // from creation to the renderer acknowledging a visible state
const VERIFY_DELAY_MS = 900;      // let the opening animation settle before checking the paint

let win: BrowserWindow | null = null;
let life = createLifecycle();
let latestState: OverlayState = { mode: 'hidden' };
let theme: EffectiveTheme = 'light';
let anchorBounds: Bounds | null = null;
let userOffsetX = 0;   // horizontal pixels from centre; positive = right
let ackTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let verifyTimer: ReturnType<typeof setTimeout> | undefined;
let onFailure: ((state: OverlayState, reason: string) => void) | null = null;
let ipcRegistered = false;

function liveWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function send(channel: string, payload: unknown) {
  const w = liveWindow();
  if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

function clearTimers() {
  clearTimeout(ackTimer);
  clearTimeout(closeTimer);
  clearTimeout(verifyTimer);
}

// Windows reports other apps' window bounds in physical pixels; Electron places windows in DIPs.
// Without converting, a meeting on a monitor with different scaling can map to the wrong display.
// Minimised windows report off-screen bounds (-32000 / -25600), which getDisplayMatching would
// still map to some display, so those are dropped and the primary display is used.
function toAnchor(bounds: Bounds | null | undefined): Bounds | null {
  if (!bounds || bounds.width <= 200 || bounds.x <= -10000 || bounds.y <= -10000) return null;
  if (process.platform !== 'win32') return bounds;
  try {
    return screen.screenToDipRect(null, bounds);
  } catch {
    return bounds;
  }
}

// Top centre of the work area of the display showing the meeting (primary display otherwise).
function targetPosition(): { display: Display; x: number; y: number } {
  const display = anchorBounds ? screen.getDisplayMatching(anchorBounds) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const centreX = Math.round(area.x + (area.width - WIDTH) / 2);
  // Clamp so the bar stays fully within the work area.
  const x = Math.max(area.x, Math.min(area.x + area.width - WIDTH, centreX + userOffsetX));
  return { display, x, y: Math.round(area.y + TOP_MARGIN) };
}

function place(height: number) {
  const w = liveWindow();
  if (!w) return;
  const { x, y } = targetPosition();
  w.setBounds({ x, y, width: WIDTH, height });
}

// True when the captured window has at least one non-transparent pixel. A capture that throws
// counts as painted: the check must never be the reason a working overlay is replaced.
async function paintedSomething(target: BrowserWindow): Promise<boolean> {
  try {
    const image = await target.webContents.capturePage();
    if (image.isEmpty()) return false;
    const bitmap = image.toBitmap();   // BGRA
    for (let i = 3; i < bitmap.length; i += 4) {
      if (bitmap[i] !== 0) return true;
    }
    return false;
  } catch (err) {
    logger.warn('Meeting overlay paint check failed; assuming it painted', { error: errorMessage(err) });
    return true;
  }
}

function createWindow(gen: number) {
  const w = new BrowserWindow({
    width: WIDTH,
    height: INITIAL_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    title: 'MeetMind',
    // macOS: a non-activating panel floats over full-screen apps and shows on every Space.
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep painting and running timers even when Windows thinks the window is covered.
      backgroundThrottling: false,
      additionalArguments: [`--meetmind-theme=${theme}`],
    },
  });
  win = w;
  userOffsetX = 0;   // each new window starts centred
  w.setAlwaysOnTop(true, 'screen-saver');
  // On macOS the panel type already covers every Space; this call would briefly turn the app
  // into a UI element there, flickering its Dock icon.
  if (!isMac) w.setVisibleOnAllWorkspaces(true);

  const gone = (reason: string, detail?: Record<string, unknown>) => {
    if (w !== win) return;
    logger.warn('Meeting overlay window lost', { reason, ...detail });
    dispatch({ type: 'gone', gen, reason });
  };
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('render-process-gone', (_e, details) =>
    gone('render-process-gone', { cause: details.reason, exitCode: details.exitCode }));
  w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) gone('load-failed', { errorCode, errorDescription, url });
  });
  w.on('unresponsive', () => gone('unresponsive'));
  w.on('closed', () => {
    if (w !== win) return;
    win = null;
    dispatch({ type: 'gone', gen, reason: 'window-closed' });
  });

  const url = isDev
    ? 'http://localhost:5173/overlay.html'
    : `file://${path.join(appRoot, 'dist/renderer/overlay.html')}`;
  w.loadURL(url).catch(() => { /* reported by did-fail-load */ });
}

function destroyWindow() {
  clearTimers();
  const w = win;
  win = null;   // first, so the window's own 'closed' handler ignores this
  if (w && !w.isDestroyed()) w.destroy();
}

function run(action: LifecycleAction) {
  switch (action.type) {
    case 'create':
      destroyWindow();
      createWindow(action.gen);
      ackTimer = setTimeout(() => dispatch({ type: 'timeout', gen: action.gen }), ACK_TIMEOUT_MS);
      break;
    case 'destroy':   // there is only ever one window, the latest generation's
      destroyWindow();
      break;
    case 'reveal': {
      const w = liveWindow();
      if (!w) break;
      const { display, x, y } = targetPosition();
      w.setBounds({ x, y, width: WIDTH, height: w.getBounds().height });
      w.showInactive();
      w.moveTop();
      logger.info('Meeting overlay shown', {
        mode: latestState.mode,
        display: display.id,
        bounds: w.getBounds(),
        pid: w.webContents.getOSProcessId(),
      });
      break;
    }
    case 'send':
      send('overlay:state', latestState);
      break;
    case 'arm-close':
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => dispatch({ type: 'closed', gen: life.gen }), CLOSE_FALLBACK_MS);
      break;
    case 'disarm-close':
      clearTimeout(closeTimer);
      break;
    case 'verify': {
      clearTimeout(ackTimer);
      clearTimeout(verifyTimer);
      const { gen } = action;
      verifyTimer = setTimeout(async () => {
        const w = liveWindow();
        if (!w || gen !== life.gen) return;
        const ok = await paintedSomething(w);
        dispatch({ type: 'verified', gen, ok });
      }, VERIFY_DELAY_MS);
      break;
    }
    case 'failed':
      logger.warn('Meeting overlay failed', {
        reason: action.reason, attempt: action.attempt, mode: latestState.mode, retrying: !action.final,
      });
      if (action.final) onFailure?.(latestState, action.reason);
      break;
    case 'recovered':
      logger.info('Meeting overlay recovered', { attempt: action.attempt });
      break;
    default:
      break;
  }
}

function dispatch(event: LifecycleEvent) {
  const { state, actions } = reduceOverlay(life, event);
  life = state;
  for (const action of actions) run(action);
}

// Shows `state` in the overlay, making a window if needed, without activating it.
function showOverlay(
  state: OverlayState,
  { theme: nextTheme, bounds = null }: { theme?: EffectiveTheme; bounds?: Bounds | null } = {},
) {
  latestState = state;
  if (nextTheme) theme = nextTheme;
  // A new window follows this meeting (or the primary display); an open one keeps its anchor
  // unless the meeting's window is known.
  const anchor = toAnchor(bounds);
  if (anchor || life.phase === 'idle' || life.phase === 'failed') anchorBounds = anchor;
  dispatch({ type: 'show', mode: state.mode });
}

// Asks the renderer to play its closing animation; the window is destroyed when it reports back
// (overlay:closed), or after a fallback delay.
function hideOverlay(state: OverlayState = { mode: 'hidden' }) {
  latestState = state;
  dispatch({ type: 'hide' });
}

function destroyOverlay() {
  destroyWindow();
  life = createLifecycle();
}

// Re-checks that a shown overlay is still painting (after sleep or a display change).
function recheckOverlay() {
  dispatch({ type: 'recheck' });
}

// idle | loading | revealed | shown | closing | failed (see overlay-lifecycle.ts); for the smoke test.
function getOverlayPhase(): string {
  return life.phase;
}

function setOverlayTheme(nextTheme: EffectiveTheme) {
  theme = nextTheme;
  send('overlay:theme', nextTheme);
}

// Registers the overlay's own IPC; `onFailure(state, reason)` runs when the overlay could not be
// shown even after a retry. Safe to call more than once.
function registerOverlayIpc(options: { onFailure?: (state: OverlayState, reason: string) => void } = {}) {
  if (options.onFailure) onFailure = options.onFailure;
  if (ipcRegistered) return;
  ipcRegistered = true;

  const fromOverlay = (event: { sender: WebContents }) => liveWindow()?.webContents === event.sender;
  // Dev only: never acknowledge, to exercise the retry and the fallback notification.
  const failOnPurpose = !app.isPackaged && process.env.MEETMIND_DEBUG_OVERLAY_FAIL === '1';

  ipcMain.handle('overlay:ready', (event) => {
    if (!fromOverlay(event)) return { mode: 'hidden' };
    dispatch({ type: 'ready', gen: life.gen });
    return latestState;
  });
  ipcMain.on('overlay:shown', (event) => {
    if (fromOverlay(event) && !failOnPurpose) dispatch({ type: 'ack', gen: life.gen });
  });
  ipcMain.on('overlay:closed', (event) => {
    if (fromOverlay(event)) dispatch({ type: 'closed', gen: life.gen });
  });
  // The renderer reports its content height; the top edge stays put.
  ipcMain.on('overlay:resize', (event, height) => {
    if (!fromOverlay(event)) return;
    place(Math.max(48, Math.min(400, Math.ceil(Number(height) || 0))));
  });
  // Move the overlay horizontally by a pixel delta (from the renderer's pointer drag).
  ipcMain.on('overlay:move', (event, deltaX) => {
    if (!fromOverlay(event)) return;
    userOffsetX += Math.round(Number(deltaX) || 0);
    const w = liveWindow();
    if (w) place(w.getBounds().height);
  });

  screen.on('display-metrics-changed', () => {
    const w = liveWindow();
    if (!w || !w.isVisible()) return;
    place(w.getBounds().height);
    recheckOverlay();
  });
}

export {
  showOverlay, hideOverlay, destroyOverlay, recheckOverlay, setOverlayTheme, registerOverlayIpc, getOverlayPhase,
};
