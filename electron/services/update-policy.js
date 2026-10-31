// Pure update rules for electron/services/updater.js: when to check next, whether updates download
// and install by themselves, when the app counts as idle enough to restart into an update, and
// whether a relaunch should stay in the tray. No electron imports, so it's unit-testable.

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// After a failed background check (usually no network yet: at login, just after waking), retry
// soon and back off, instead of waiting the full interval or giving up.
const RETRY_DELAYS_MS = [2, 10, 30, 60].map((minutes) => minutes * 60 * 1000);
// An update restart after an automatic install starts in the tray if it happens within this long.
const HIDDEN_RELAUNCH_WINDOW_MS = 10 * 60 * 1000;

// Whether this install can download and install updates itself. Unsigned macOS builds can't
// (Squirrel.Mac needs a stable signature); on Linux only an AppImage can replace itself ($APPIMAGE
// is set when one runs), while a .deb is updated by installing the new package. Windows always can.
function canSelfUpdate(platform, env = {}) {
  if (platform === 'darwin') return false;
  if (platform === 'linux') return !!env.APPIMAGE;
  return true;
}

// Delay before the next background check. `failures` counts consecutive failed attempts.
function nextCheckDelay({ ok, failures = 0 }) {
  if (ok || failures <= 0) return CHECK_INTERVAL_MS;
  return RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1];
}

// Updates download and install by themselves only with both settings on (the install switch is
// greyed out while checks are off) and where the app can replace itself (see canSelfUpdate).
function autoInstallEnabled(config, canSelfUpdate) {
  return !!canSelfUpdate && config?.autoCheckUpdates !== false && config?.autoInstallUpdates === true;
}

// Idle enough to restart into an update: the window is hidden in the tray and nothing is being
// recorded, processed or prompted for. A minimised window still counts as in use.
function isIdleForUpdate({ isRecording, activePipelines, activeMeeting, overlayMode, windowVisible }) {
  return !isRecording
    && !activePipelines
    && !activeMeeting
    && (!overlayMode || overlayMode === 'hidden')
    && !windowVisible;
}

// True when a launch follows an automatic update install recorded at `requestedAt` (ms).
function shouldRelaunchHidden(requestedAt, now = Date.now()) {
  return Number.isFinite(requestedAt) && now - requestedAt >= 0 && now - requestedAt <= HIDDEN_RELAUNCH_WINDOW_MS;
}

module.exports = {
  CHECK_INTERVAL_MS,
  RETRY_DELAYS_MS,
  HIDDEN_RELAUNCH_WINDOW_MS,
  canSelfUpdate,
  nextCheckDelay,
  autoInstallEnabled,
  isIdleForUpdate,
  shouldRelaunchHidden,
};
