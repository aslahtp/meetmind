// The floating meeting overlay: a small frameless, transparent, always-on-top window that never
// takes focus, so it can sit over a Meet/Zoom call without stealing keystrokes. It renders
// renderer/overlay.html and is driven entirely by the state main pushes on overlay:state.

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const WIDTH = 360;
const INITIAL_HEIGHT = 56;
const TOP_MARGIN = 12;
const CLOSE_FALLBACK_MS = 1200;   // hide anyway if the renderer never reports its close animation done

let win = null;
let latestState = null;
let anchorBounds = null;
let closeTimer = null;
let userOffsetX = 0;   // horizontal pixels from centre; positive = right

function isAlive() {
  return !!win && !win.isDestroyed();
}

function send(channel, payload) {
  if (isAlive() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

// Top centre of the work area of the display showing the meeting (primary display otherwise).
// Minimised windows report off-screen bounds (-32000 / -25600), which getDisplayMatching would
// still map to some display, so those fall back to the primary one too.
function targetPosition() {
  const usable = anchorBounds && anchorBounds.width > 200 && anchorBounds.x > -10000 && anchorBounds.y > -10000;
  const display = usable ? screen.getDisplayMatching(anchorBounds) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const centreX = Math.round(area.x + (area.width - WIDTH) / 2);
  // Clamp so the bar stays fully within the work area.
  const x = Math.max(area.x, Math.min(area.x + area.width - WIDTH, centreX + userOffsetX));
  return { x, y: Math.round(area.y + TOP_MARGIN) };
}

function create(theme) {
  win = new BrowserWindow({
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
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--meetmind-theme=${theme}`],
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // On macOS the panel type already covers every Space; this call would briefly turn the app
  // into a UI element there, flickering its Dock icon.
  if (!isMac) win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; clearTimeout(closeTimer); });

  const url = isDev
    ? 'http://localhost:5173/overlay.html'
    : `file://${path.join(__dirname, '../../dist/renderer/overlay.html')}`;
  win.loadURL(url);
  win.webContents.on('did-finish-load', () => send('overlay:state', latestState));
}

// Shows (creating if needed) the overlay with `state`, without activating it. The window is shown
// before the state is sent, so the renderer's opening animation plays on screen, not while hidden.
function showOverlay(state, { theme = 'light', bounds = null } = {}) {
  clearTimeout(closeTimer);
  latestState = state;
  if (bounds) anchorBounds = bounds;
  userOffsetX = 0;   // each show starts centred
  if (!isAlive()) create(theme);
  const { height } = win.getBounds();
  win.setBounds({ ...targetPosition(), width: WIDTH, height });
  if (!win.isVisible()) win.showInactive();
  send('overlay:state', state);
}

function updateOverlay(state) {
  latestState = state;
  send('overlay:state', state);
}

// Asks the renderer to play its closing animation; the window hides when it reports back
// (overlayClosed), or after a fallback delay.
function hideOverlay(state = { mode: 'hidden' }) {
  latestState = state;
  if (!isAlive()) return;
  send('overlay:state', state);
  if (!win.isVisible()) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(overlayClosed, CLOSE_FALLBACK_MS);
}

function overlayClosed() {
  clearTimeout(closeTimer);
  anchorBounds = null;
  userOffsetX = 0;
  if (isAlive() && !(latestState && latestState.mode !== 'hidden')) win.hide();
}

function destroyOverlay() {
  clearTimeout(closeTimer);
  if (isAlive()) win.destroy();
  win = null;
}

// The renderer reports its content height; the top edge stays put.
function resizeOverlay(height) {
  if (!isAlive()) return;
  const h = Math.max(48, Math.min(400, Math.ceil(Number(height) || 0)));
  win.setBounds({ ...targetPosition(), width: WIDTH, height: h });
}

// Move the overlay horizontally by a pixel delta (from the renderer's pointer drag).
function moveOverlay(deltaX) {
  if (!isAlive()) return;
  userOffsetX += Math.round(Number(deltaX) || 0);
  const { height } = win.getBounds();
  win.setBounds({ ...targetPosition(), width: WIDTH, height });
}

function setOverlayTheme(theme) {
  send('overlay:theme', theme);
}

function isOverlayVisible() {
  return isAlive() && win.isVisible();
}

module.exports = {
  showOverlay, updateOverlay, hideOverlay, overlayClosed, destroyOverlay, resizeOverlay, moveOverlay, setOverlayTheme, isOverlayVisible,
};
