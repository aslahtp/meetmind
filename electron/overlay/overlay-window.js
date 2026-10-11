// The floating meeting overlay: a small frameless, transparent, always-on-top window that never
// takes focus, so it can sit over a Meet/Zoom call without stealing keystrokes. It renders
// renderer/overlay.html and is driven entirely by the state main pushes on overlay:state.

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const isDev = process.env.NODE_ENV === 'development';
const WIDTH = 360;
const INITIAL_HEIGHT = 56;
const MARGIN = 24;

let win = null;
let latestState = null;
let anchorBounds = null;

function isAlive() {
  return !!win && !win.isDestroyed();
}

function send(channel, payload) {
  if (isAlive() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

// Bottom-right of the work area of the display showing the meeting (primary display otherwise).
// Minimised windows report off-screen bounds (-32000 / -25600), which getDisplayMatching would
// still map to some display, so those fall back to the primary one too.
function targetPosition(height) {
  const usable = anchorBounds && anchorBounds.width > 200 && anchorBounds.x > -10000 && anchorBounds.y > -10000;
  const display = usable ? screen.getDisplayMatching(anchorBounds) : screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: Math.round(area.x + area.width - WIDTH - MARGIN),
    y: Math.round(area.y + area.height - height - MARGIN),
  };
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--meetmind-theme=${theme}`],
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });

  const url = isDev
    ? 'http://localhost:5173/overlay.html'
    : `file://${path.join(__dirname, '../../dist/renderer/overlay.html')}`;
  win.loadURL(url);
  win.webContents.on('did-finish-load', () => send('overlay:state', latestState));
}

// Shows (creating if needed) the overlay with `state`, without activating it.
function showOverlay(state, { theme = 'light', bounds = null } = {}) {
  latestState = state;
  if (bounds) anchorBounds = bounds;
  if (!isAlive()) create(theme);
  send('overlay:state', state);
  const { height } = win.getBounds();
  const { x, y } = targetPosition(height);
  win.setBounds({ x, y, width: WIDTH, height });
  if (!win.isVisible()) win.showInactive();
}

function updateOverlay(state) {
  latestState = state;
  send('overlay:state', state);
}

function hideOverlay() {
  anchorBounds = null;
  if (isAlive()) win.hide();
}

function destroyOverlay() {
  if (isAlive()) win.destroy();
  win = null;
}

// The renderer reports its content height; grow/shrink upward so the bottom edge stays put.
function resizeOverlay(height) {
  if (!isAlive()) return;
  const h = Math.max(48, Math.min(400, Math.ceil(Number(height) || 0)));
  const { x, y } = targetPosition(h);
  win.setBounds({ x, y, width: WIDTH, height: h });
}

function setOverlayTheme(theme) {
  send('overlay:theme', theme);
}

function isOverlayVisible() {
  return isAlive() && win.isVisible();
}

module.exports = { showOverlay, updateOverlay, hideOverlay, destroyOverlay, resizeOverlay, setOverlayTheme, isOverlayVisible };
