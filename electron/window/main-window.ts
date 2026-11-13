// The main (UI) window. main-window-lifecycle.ts decides when it is created, checked, repaired
// and retired; this file runs those decisions and owns the window's IPC.
//
// The window exists only while it is wanted: none is made for a login launch, and one hidden to
// the tray is destroyed after a while (see the lifecycle file for why). Whenever it is shown a
// health check runs: the preload answers a ping (is React mounted, was a frame drawn) and a
// capture of the top bar must not be one flat colour. Every step is logged.

import path from 'path';
import { app, BrowserWindow, ipcMain, shell, screen, type Rectangle, type WebContents } from 'electron';
import logger from '../utils/logger';
import { appRoot } from '../utils/paths';
import { errorMessage } from '../utils/errors';
import type { ViewState } from '../shared';
import {
  RETIRE_AFTER_MS, createLifecycle, reduceMainWindow, healthVerdict, isBlankCapture,
  type HealthPong, type HealthVerdict, type WindowAction, type WindowEvent, type WindowPhase,
} from './main-window-lifecycle';

/** The hooks main supplies through `registerMainWindowIpc`. */
interface MainWindowHooks {
  /** The saved theme setting. */
  getTheme?: () => string | undefined;
  /** The colour painted before the renderer's first frame, for a theme. */
  getBackgroundColor?: (theme: string) => string | undefined;
  getIconPath?: () => string | undefined;
  onCreated?: (window: BrowserWindow) => void;
  /** Repairs ran out. */
  onGiveUp?: (reason: string) => void;
}

interface PendingMessage {
  channel: string;
  args: unknown[];
  at: number;
}

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';

const LOAD_TIMEOUT_MS = 30000;        // from creation or reload to the renderer's `ready`
const REVEAL_FALLBACK_MS = 400;       // show the window even if ready-to-show never comes
const UNRESPONSIVE_GRACE_MS = 8000;   // a heavy GC or disk flush can stall the renderer briefly
const HEALTH_DELAY_MS = 400;          // let the window settle on screen before checking it
const PING_TIMEOUT_MS = 6000;         // the preload itself waits up to ~2.5 s for a frame
const SPLASH_RECHECK_MS = 3000;       // check again once the startup splash has gone
const TOP_BAR_HEIGHT = 80;            // the captured strip: the 64px top bar and its border
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_MAX = 10;

// Dev only. MEETMIND_UI_RETIRE_MS shortens the retire delay; MEETMIND_DEBUG_UI_FAIL makes the
// window fail on purpose: 'noack' ignores the renderer's ready, 'blank' fails every health check.
const debugFail = !app.isPackaged ? process.env.MEETMIND_DEBUG_UI_FAIL || '' : '';
const retireAfterMs = (!app.isPackaged && Number(process.env.MEETMIND_UI_RETIRE_MS)) || RETIRE_AFTER_MS;

let win: BrowserWindow | null = null;
let life = createLifecycle();
let options: MainWindowHooks = {};
let ipcRegistered = false;

let loadTimer: ReturnType<typeof setTimeout> | undefined;
let retireTimer: ReturnType<typeof setTimeout> | undefined;
let unresponsiveTimer: ReturnType<typeof setTimeout> | undefined;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;
let checking = false;
let pingSeq = 0;
const pendingPings = new Map<number, (pong: HealthPong | null) => void>();   // id → resolve

let lastBounds: Rectangle | null = null;   // restored on the next window, so reopening lands where it was
let lastMaximized = false;
let viewState: ViewState | null = null;    // last reported by the renderer
let pendingMessages: PendingMessage[] = [];   // for a window that isn't ready yet

function aliveWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() && !!win.webContents && !win.webContents.isDestroyed() ? win : null;
}

function isAlive(): boolean {
  return !!aliveWindow();
}

/** The window when it is alive, visible and not minimised. */
function onScreenWindow(): BrowserWindow | null {
  const w = aliveWindow();
  return w && w.isVisible() && !w.isMinimized() ? w : null;
}

// How much memory the machine has left, logged with every window failure. A machine short of
// RAM pages out idle processes and Chromium drops the surfaces of windows it isn't showing, so
// this tells a starved machine from a real fault. `commitFreeMb` is what is left of RAM plus
// the page file (Windows' commit limit): near zero there, allocations start failing.
function memorySnapshot(): Record<string, number> | undefined {
  try {
    const mb = (kb: number) => Math.round(kb / 1024);
    const sys = process.getSystemMemoryInfo();   // kilobytes
    const snapshot: Record<string, number> = {
      freeMb: mb(sys.free),
      totalMb: mb(sys.total),
      freePct: Math.round((sys.free / sys.total) * 100),
    };
    if (sys.swapTotal) {
      snapshot.commitFreeMb = mb(sys.swapFree);
      snapshot.commitTotalMb = mb(sys.swapTotal);
    }
    const alive = aliveWindow();
    if (alive) {
      const pid = alive.webContents.getOSProcessId();
      const metric = app.getAppMetrics().find((m) => m.pid === pid);
      if (metric?.memory) snapshot.rendererMb = mb(metric.memory.workingSetSize);
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function clearWindowTimers() {
  clearTimeout(loadTimer);
  clearTimeout(unresponsiveTimer);
  clearTimeout(recheckTimer);
  loadTimer = undefined;
  unresponsiveTimer = undefined;
  recheckTimer = undefined;
}

function rememberBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    lastMaximized = win.isMaximized();
    lastBounds = win.getNormalBounds();
  } catch { /* cosmetic */ }
}

// Bounds from last time, if they still land on a connected display.
function restoredBounds() {
  if (!lastBounds) return null;
  try {
    const area = screen.getDisplayMatching(lastBounds).workArea;
    const overlapsX = lastBounds.x < area.x + area.width && lastBounds.x + lastBounds.width > area.x;
    const overlapsY = lastBounds.y < area.y + area.height && lastBounds.y + lastBounds.height > area.y;
    return overlapsX && overlapsY ? lastBounds : null;
  } catch {
    return null;
  }
}

function armLoadTimeout(gen: number) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => dispatch({ type: 'timeout', gen, now: Date.now() }), LOAD_TIMEOUT_MS);
}

function rendererUrl() {
  return isDev
    ? 'http://localhost:5173'
    : `file://${path.join(appRoot, 'dist/renderer/index.html')}`;
}

function createWindow(gen: number, reveal: boolean) {
  const savedTheme = options.getTheme?.() || 'light';
  const bounds = restoredBounds();

  const w = new BrowserWindow({
    width: 1100,
    height: 720,
    ...(bounds || {}),
    minWidth: 800,
    minHeight: 600,
    // Painted before the renderer's first frame: must match the theme it is about to apply.
    backgroundColor: options.getBackgroundColor?.(savedTheme),
    // Custom titlebar in the renderer. macOS keeps its native traffic lights, inset into the
    // renderer's top bar (which leaves room for them); Windows has no native frame at all.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 24, y: 25 } }
      : { frame: false, backgroundMaterial: 'none' as const, icon: options.getIconPath?.() }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The saved theme goes in argv so preload can apply it before first paint with no IPC
      // round-trip (which would mean a light→dark flash, or a blocking sendSync).
      additionalArguments: [`--meetmind-theme=${savedTheme}`],
    },
    show: false,
  });
  win = w;
  if (bounds && lastMaximized) w.maximize();

  w.setTitle('MeetMind');
  w.on('page-title-updated', (e) => e.preventDefault());

  // × sends the window to the tray; only quitting really closes it.
  w.on('close', (event) => {
    if (app.isQuitting) return;
    event.preventDefault();
    if (w === win) dispatch({ type: 'hide' });
  });
  w.on('closed', () => {
    if (w !== win) return;
    win = null;
    clearWindowTimers();
    dispatch({ type: 'closed', gen: life.gen });
  });
  w.on('restore', () => { if (w === win) dispatch({ type: 'recheck' }); });

  // Outbound links open in the system browser; the app never opens a second window for them.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  const gone = (reason: string, detail?: Record<string, unknown>) => {
    if (w !== win || app.isQuitting) return;
    logger.warn('Main window lost', { reason, ...detail, memory: memorySnapshot() });
    dispatch({ type: 'gone', gen: life.gen, reason, now: Date.now() });
  };
  w.webContents.on('render-process-gone', (_e, details) =>
    gone('render-process-gone', { cause: details.reason, exitCode: details.exitCode }));
  w.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) gone('load-failed', { errorCode, errorDescription, url });
  });
  w.webContents.on('preload-error', (_e, preloadPath, error) =>
    gone('preload-error', { preloadPath, error: error?.message }));
  w.on('unresponsive', () => {
    if (w !== win) return;
    logger.warn('Main window unresponsive; will repair it if it doesn’t recover', { memory: memorySnapshot() });
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => gone('unresponsive'), UNRESPONSIVE_GRACE_MS);
  });
  w.on('responsive', () => {
    if (w !== win || !unresponsiveTimer) return;
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = undefined;
    logger.info('Main window responsive again');
  });
  // Errors the page logs itself (failed resource loads, React warnings escalated to errors).
  w.webContents.on('console-message', (event) => {
    if (event?.level === 'error' && !isDev) {
      logger.warn('Renderer console error', { message: String(event.message || '').slice(0, 1000), source: event.sourceId, line: event.lineNumber });
    }
  });

  options.onCreated?.(w);

  w.loadURL(rendererUrl()).catch(() => { /* reported by did-fail-load */ });
  armLoadTimeout(gen);

  if (reveal) {
    // Show quickly: don't wait forever for the renderer's first paint.
    w.once('ready-to-show', () => { if (w === win) reveal_(); });
    setTimeout(() => { if (w === win) reveal_(); }, REVEAL_FALLBACK_MS);
  }
  if (isDev) w.webContents.openDevTools({ mode: 'detach' });
  logger.info('Main window created', { gen, restoredBounds: !!bounds });
}

function destroyWindow() {
  clearWindowTimers();
  clearTimeout(retireTimer);
  retireTimer = undefined;
  for (const resolve of pendingPings.values()) resolve(null);
  pendingPings.clear();
  const w = win;
  if (w && !w.isDestroyed()) rememberBounds();
  win = null;   // first, so the window's own 'closed' handler ignores this
  if (w && !w.isDestroyed()) w.destroy();
}

// Shows and focuses the window. When it was hidden, tells the renderer, which plays the startup
// splash only once the window is actually on screen.
function reveal_() {
  if (!win || win.isDestroyed() || !life.shown) return;
  const wasHidden = !win.isVisible();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (wasHidden && isAlive()) win.webContents.send('window:shown');
}

function ping(): Promise<HealthPong | null> {
  return new Promise((resolve) => {
    const id = ++pingSeq;
    const timer = setTimeout(() => { pendingPings.delete(id); resolve(null); }, PING_TIMEOUT_MS);
    pendingPings.set(id, (pong) => { clearTimeout(timer); pendingPings.delete(id); resolve(pong); });
    try {
      if (!win) throw new Error('no window');
      win.webContents.send('window:health-ping', id);
    } catch {
      pendingPings.get(id)?.(null);
    }
  });
}

// True when the top bar strip is one flat colour. A capture that fails or comes back empty is
// "unknown" (null): the check must never be the reason a working window is repaired.
async function topBarIsBlank(w: BrowserWindow): Promise<boolean | null> {
  try {
    const { width } = w.getContentBounds();
    const image = await w.webContents.capturePage({ x: 0, y: 0, width, height: TOP_BAR_HEIGHT });
    if (image.isEmpty()) return null;
    return isBlankCapture(image.toBitmap());
  } catch (err) {
    logger.warn('Main window paint check failed; assuming it painted', { error: errorMessage(err) });
    return null;
  }
}

async function runHealthCheck(gen: number) {
  if (checking) return;
  checking = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, HEALTH_DELAY_MS));
    let w = onScreenWindow();
    if (gen !== life.gen || !w) return;

    try { w.webContents.invalidate(); } catch { /* best effort: forces a fresh frame */ }
    const pong = await ping();
    // Hidden or minimised meanwhile: frames stop then, so the answer says nothing.
    w = onScreenWindow();
    if (gen !== life.gen || !w) return;

    const blank = pong && pong.mounted && !pong.splash ? await topBarIsBlank(w) : null;
    w = onScreenWindow();
    if (gen !== life.gen || !w) return;

    const verdict: HealthVerdict = debugFail === 'blank'
      ? { ok: false, reason: 'blank (debug)' }
      : healthVerdict({ pong, focused: w.isFocused(), blank });
    if (verdict.again) {
      clearTimeout(recheckTimer);
      recheckTimer = setTimeout(() => dispatch({ type: 'recheck' }), SPLASH_RECHECK_MS);
      return;
    }
    if (!verdict.ok) {
      logger.warn('Main window health check failed', {
        reason: verdict.reason, pong, blank, focused: w.isFocused(), memory: memorySnapshot(),
      });
    }
    dispatch({ type: 'health', gen, ok: verdict.ok, reason: verdict.reason, now: Date.now() });
  } finally {
    checking = false;
  }
}

function flushPending() {
  const now = Date.now();
  const queue = pendingMessages.filter((m) => now - m.at < PENDING_MAX_AGE_MS);
  pendingMessages = [];
  for (const { channel, args } of queue) {
    try { win?.webContents.send(channel, ...args); } catch { /* window went away */ }
  }
}

function run(action: WindowAction) {
  switch (action.type) {
    case 'create':
      destroyWindow();
      createWindow(action.gen, action.reveal);
      break;
    case 'destroy':
      destroyWindow();
      break;
    case 'reload':
      clearWindowTimers();
      if (!win || !isAlive()) break;
      armLoadTimeout(action.gen);
      win.webContents.reload();
      break;
    case 'reveal':
      reveal_();
      break;
    case 'hide':
      if (win && !win.isDestroyed()) {
        rememberBounds();
        win.hide();
      }
      break;
    case 'arm-retire':
      clearTimeout(retireTimer);
      retireTimer = setTimeout(() => dispatch({ type: 'retire' }), retireAfterMs);
      break;
    case 'disarm-retire':
      clearTimeout(retireTimer);
      retireTimer = undefined;
      break;
    case 'check':
      runHealthCheck(action.gen);
      break;
    case 'retired':
      logger.info('Main window closed after sitting in the tray; the next open makes a new one');
      break;
    case 'failed':
      logger.warn('Main window failed', { reason: action.reason, step: action.step, next: action.final ? 'giving up' : action.next });
      if (action.final) options.onGiveUp?.(action.reason);
      break;
    case 'recovered':
      logger.info('Main window recovered', { by: action.step === 1 ? 'reload' : 'new window' });
      break;
    default:
      break;
  }
}

function dispatch(event: WindowEvent) {
  const { state, actions } = reduceMainWindow(life, event);
  life = state;
  for (const action of actions) run(action);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Shows and focuses the window, creating it if there is none. */
function openMainWindow() {
  dispatch({ type: 'open' });
}

/** The BrowserWindow, or null when there is none (it may be loading or hidden). */
function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function isMainWindowVisible() {
  return !!win && !win.isDestroyed() && win.isVisible();
}

/**
 * Sends to the renderer. Returns false when there is no window to send to. With `queue: true` a
 * message for a window that isn't up yet is kept (for a few minutes) and delivered once it is:
 * for the few events that must not be lost, like "open this meeting".
 */
function sendToMainWindow(channel: string, args: unknown[] = [], { queue = false }: { queue?: boolean } = {}): boolean {
  try {
    const w = aliveWindow();
    if (w && (life.phase === 'ready' || !queue)) {
      w.webContents.send(channel, ...args);
      return true;
    }
  } catch (err) {
    logger.warn(`Failed to send ${channel} to renderer`, { error: errorMessage(err) });
    return false;
  }
  if (queue) {
    pendingMessages.push({ channel, args, at: Date.now() });
    if (pendingMessages.length > PENDING_MAX) pendingMessages.shift();
  }
  return false;
}

/** Checks a shown window again: after waking from sleep, a display change or a GPU crash. */
function recheckMainWindow() {
  dispatch({ type: 'recheck' });
}

function destroyMainWindow() {
  destroyWindow();
  life = createLifecycle();
}

// none | loading | ready | failed (see main-window-lifecycle.ts); for the smoke test.
function getMainWindowPhase(): WindowPhase {
  return life.phase;
}

/** The page the renderer last showed ({ view, sessionId }), so a new window reopens there. */
function getViewState(): ViewState | null {
  return viewState;
}

/**
 * Registers the window's IPC and stores the hooks main supplies:
 *   getTheme() → saved theme setting; getBackgroundColor(theme) → pre-paint colour;
 *   getIconPath(); onCreated(window); onGiveUp(reason) when repairs ran out.
 * Safe to call more than once.
 */
function registerMainWindowIpc(hooks: MainWindowHooks = {}) {
  options = { ...options, ...hooks };
  if (ipcRegistered) return;
  ipcRegistered = true;

  const fromWindow = (event: { sender: WebContents }) => aliveWindow()?.webContents === event.sender;

  ipcMain.handle('window:minimize', () => { getMainWindow()?.minimize(); });
  ipcMain.handle('window:maximize', () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isMaximized()) w.restore();
    else w.maximize();
  });
  ipcMain.handle('window:close', () => { getMainWindow()?.close(); });
  ipcMain.handle('window:isVisible', () => isMainWindowVisible());
  ipcMain.handle('window:isMaximized', () => !!getMainWindow()?.isMaximized());

  // The renderer mounted. Sent once per page load (repeats are ignored by the lifecycle).
  ipcMain.on('window:ready', (event) => {
    if (!fromWindow(event) || debugFail === 'noack') return;
    const wasLoading = life.phase === 'loading';
    clearTimeout(loadTimer);
    dispatch({ type: 'ready', gen: life.gen });
    if (wasLoading && life.phase === 'ready') flushPending();
  });
  ipcMain.on('window:health-pong', (event, id: number, pong: unknown) => {
    // The renderer's own report; trusted only as far as its being an object.
    if (fromWindow(event)) pendingPings.get(id)?.(pong && typeof pong === 'object' ? (pong as HealthPong) : null);
  });
  ipcMain.on('window:dirty', (event, value: unknown) => {
    if (fromWindow(event)) dispatch({ type: 'dirty', value: !!value });
  });
  ipcMain.on('window:view-state', (event, rawState: unknown) => {
    const state = rawState as Partial<Record<keyof ViewState, unknown>> | null | undefined;   // from the renderer; checked below
    if (!fromWindow(event) || !state || typeof state.view !== 'string') return;
    viewState = { view: state.view, sessionId: typeof state.sessionId === 'string' ? state.sessionId : null };
  });

  screen.on('display-metrics-changed', () => recheckMainWindow());
}

export {
  registerMainWindowIpc, openMainWindow, getMainWindow, isMainWindowVisible, sendToMainWindow,
  recheckMainWindow, destroyMainWindow, getMainWindowPhase, getViewState,
};
