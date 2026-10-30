// Checks GitHub Releases for updates (electron-updater). Background checks run at startup and
// every 4 hours while `autoCheckUpdates` is on, retrying a failed check within minutes instead of
// waiting hours, and again after the PC wakes. With `autoInstallUpdates` also on, an update found
// downloads by itself (checksum-verified by electron-updater) and installs when the app quits, or
// sooner once MeetMind has sat idle in the tray (see update-policy.js), relaunching into the tray.
// Otherwise downloading and installing wait for the user (Settings, the top-bar pill, the tray).

const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { app, shell, powerMonitor } = require('electron');
const logger = require('../utils/logger');
const { getConfig, store } = require('../utils/config');
const { binaryName, getFfmpegPath, getFfprobePath } = require('../audio/ffmpeg-path');
const { CHECK_INTERVAL_MS, nextCheckDelay, autoInstallEnabled, shouldRelaunchHidden } = require('./update-policy');

const FIRST_CHECK_DELAY_MS = 6000;        // let startup settle first
const RESUME_CHECK_DELAY_MS = 30 * 1000;  // give the network a moment after waking
const RESUME_RECHECK_AFTER_MS = 60 * 60 * 1000;
const IDLE_POLL_MS = 60 * 1000;
const IDLE_POLLS_BEFORE_INSTALL = 2;      // idle on two polls in a row (1-2 minutes) before restarting
const RELEASES_URL = 'https://github.com/aslahtp/meetmind/releases';
const HIDDEN_RELAUNCH_KEY = 'updateRelaunchHiddenAt';

// macOS builds are ad-hoc signed, and Squirrel.Mac refuses to install an update into an app
// without a stable signature. Until there is a Developer ID, the Mac app only checks
// latest-mac.yml and sends the user to the release page to download the new DMG. Flip this to
// true once mac builds are Developer ID signed and notarized.
const CAN_SELF_UPDATE = process.platform !== 'darwin';

let currentStatus = 'idle'; // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
let updateInfo = null;
let downloadProgress = { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 };
let lastCheckTime = null;
let lastSuccessTime = 0;
let errorMessage = null;
let errorPhase = null;      // 'check' | 'download': what the last error interrupted
let consecutiveFailures = 0;
let downloadInFlight = false;
let postUpdateCheck = null; // null | { version, ok, missing: string[], checkedAt }
let sendToRendererCallback = null;
let onStatusChangeCallback = null;
let isIdleCallback = () => false;
let checkTimer = null;
let idleTimer = null;
let idlePolls = 0;

function autoInstall() {
  return autoInstallEnabled(getConfig(), CAN_SELF_UPDATE);
}

function broadcastState() {
  if (typeof sendToRendererCallback === 'function') {
    sendToRendererCallback('updater:status', getUpdaterState());
  }
  try {
    onStatusChangeCallback?.(getUpdaterState());
  } catch (err) {
    logger.warn('Error in updater status callback', { error: err.message });
  }
}

function getUpdaterState() {
  return {
    status: currentStatus,
    currentVersion: app.getVersion(),
    updateInfo,
    downloadProgress,
    lastCheckTime,
    errorMessage,
    errorPhase,
    consecutiveFailures,
    postUpdateCheck,
    isPackaged: app.isPackaged,
    canSelfUpdate: CAN_SELF_UPDATE,
    autoInstall: autoInstall(),
    releaseUrl: updateInfo?.version ? `${RELEASES_URL}/tag/v${updateInfo.version}` : RELEASES_URL,
  };
}

// Minimal numeric semver compare (good enough for the plain X.Y.Z tags this project publishes).
// Returns 1 if a>b, -1 if a<b, 0 if equal/unparseable.
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Verifies that resources critical to app functionality (bundled FFmpeg/FFprobe) actually
 * exist on disk. Run after a version change is detected so a broken release (e.g. a CI build
 * that shipped without extraResources) is caught instead of failing silently mid-recording.
 */
function verifyBundledResources() {
  const checks = [
    { name: binaryName('ffmpeg', process.platform), path: getFfmpegPath() },
    { name: binaryName('ffprobe', process.platform), path: getFfprobePath() },
  ];
  const missing = checks.filter((c) => !fs.existsSync(c.path)).map((c) => c.name);
  return { ok: missing.length === 0, missing };
}

/**
 * Detects whether the app was just updated (installed version differs from the last one we
 * recorded) and, if so, runs the bundled-resource integrity check so a broken release surfaces
 * as a clear "update incomplete" state instead of a confusing runtime error later.
 */
function runPostUpdateCheck() {
  if (!app.isPackaged) return;

  const currentVersion = app.getVersion();
  const lastSeenVersion = store.get('lastSeenVersion');

  if (lastSeenVersion && lastSeenVersion !== currentVersion) {
    const result = verifyBundledResources();
    postUpdateCheck = { version: currentVersion, ok: result.ok, missing: result.missing, checkedAt: new Date().toISOString() };
    if (!result.ok) {
      logger.warn('Post-update integrity check failed — bundled resources missing', { version: currentVersion, missing: result.missing });
    } else {
      logger.info('Post-update integrity check passed', { version: currentVersion });
    }
    broadcastState();
  }

  store.set('lastSeenVersion', currentVersion);
}

function setupAutoUpdaterEvents() {
  // Downloads start from downloadUpdate() (by the user, or automatically when autoInstall() is
  // on), never from electron-updater itself, so the version guard there always runs.
  // Installing on quit follows the setting (applyUpdateSettings).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = autoInstall();
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    currentStatus = 'checking';
    errorMessage = null;
    errorPhase = null;
    logger.info('AutoUpdater: checking for updates...');
    broadcastState();
  });

  autoUpdater.on('update-available', (info) => {
    consecutiveFailures = 0;
    lastSuccessTime = Date.now();
    currentStatus = 'available';
    updateInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    };
    logger.info('AutoUpdater: update available', { version: info.version });
    broadcastState();
    if (autoInstall()) {
      logger.info('AutoUpdater: downloading automatically', { version: info.version });
      downloadUpdate();
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    consecutiveFailures = 0;
    lastSuccessTime = Date.now();
    currentStatus = 'not-available';
    updateInfo = {
      version: info.version,
    };
    logger.info('AutoUpdater: app is up to date', { version: info.version });
    broadcastState();
  });

  autoUpdater.on('download-progress', (progressObj) => {
    currentStatus = 'downloading';
    downloadProgress = {
      percent: Math.round(progressObj.percent || 0),
      bytesPerSecond: Math.round(progressObj.bytesPerSecond || 0),
      transferred: Math.round(progressObj.transferred || 0),
      total: Math.round(progressObj.total || 0),
    };
    broadcastState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadInFlight = false;
    consecutiveFailures = 0;
    currentStatus = 'downloaded';
    updateInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    };
    logger.info('AutoUpdater: update downloaded and ready to install', { version: info.version });
    broadcastState();
    armIdleInstall();
  });

  autoUpdater.on('error', (err) => {
    currentStatus = 'error';
    errorPhase = downloadInFlight ? 'download' : 'check';
    downloadInFlight = false;
    consecutiveFailures += 1;

    const raw = err?.message || 'Error checking for updates';
    // Provide a friendly error message — strip raw download URLs to avoid noise
    let friendlyMessage = raw;
    if (/sha512|checksum|integrity/i.test(raw)) {
      friendlyMessage = 'Downloaded update failed integrity verification and was discarded. Please try again later.';
    } else if (/cannot download/i.test(raw) || /net::/i.test(raw) || /ENOTFOUND/i.test(raw) || /ETIMEDOUT/i.test(raw)) {
      friendlyMessage = 'Unable to download update. The release may not be ready yet — please try again later.';
    } else if (/404/i.test(raw) || /not found/i.test(raw)) {
      friendlyMessage = 'Update release not found on GitHub. It may still be publishing.';
    } else if (/403/i.test(raw) || /forbidden/i.test(raw)) {
      friendlyMessage = 'Access denied when checking for updates.';
    } else if (raw.length > 120) {
      // Truncate overly long messages that usually contain URLs
      friendlyMessage = raw.substring(0, 120).replace(/https?:\/\/\S+/g, '').trim() + '…';
    }
    errorMessage = friendlyMessage;
    logger.warn('AutoUpdater error', { error: raw, phase: errorPhase, consecutiveFailures });
    broadcastState();
    // A failed automatic download is retried through the next check, on the same backoff.
    if (errorPhase === 'download' && autoInstall()) {
      scheduleBackgroundCheck(nextCheckDelay({ ok: false, failures: consecutiveFailures }));
    }
  });
}

// ── Background checks ────────────────────────────────────────────────────────

function scheduleBackgroundCheck(delayMs) {
  clearTimeout(checkTimer);
  checkTimer = null;
  if (!app.isPackaged || getConfig().autoCheckUpdates === false) return;
  checkTimer = setTimeout(runBackgroundCheck, delayMs);
  checkTimer.unref?.();
}

async function runBackgroundCheck() {
  checkTimer = null;
  // Nothing to look for while an update is downloading or waiting to install.
  if (currentStatus === 'downloading' || currentStatus === 'downloaded' || downloadInFlight) {
    scheduleBackgroundCheck(CHECK_INTERVAL_MS);
    return;
  }
  const result = await checkForUpdates(false).catch((err) => ({ success: false, error: err.message }));
  if (checkTimer) return;   // a settings change or a failed download already rescheduled
  const ok = !!result?.success;
  const delay = nextCheckDelay({ ok, failures: consecutiveFailures });
  if (!ok) logger.info('AutoUpdater: will retry the update check', { inMinutes: Math.round(delay / 60000) });
  scheduleBackgroundCheck(delay);
}

// ── Installing when idle ─────────────────────────────────────────────────────

// While an update waits and automatic installs are on, polls whether the app is idle and, after
// two idle polls in a row, restarts into the update.
function armIdleInstall() {
  clearInterval(idleTimer);
  idleTimer = null;
  idlePolls = 0;
  if (currentStatus !== 'downloaded' || !autoInstall()) return;
  idleTimer = setInterval(() => {
    if (currentStatus !== 'downloaded' || !autoInstall()) {
      armIdleInstall();
      return;
    }
    let idle = false;
    try {
      idle = !!isIdleCallback();
    } catch (err) {
      logger.warn('AutoUpdater: idle check failed', { error: err.message });
    }
    idlePolls = idle ? idlePolls + 1 : 0;
    if (idlePolls >= IDLE_POLLS_BEFORE_INSTALL) {
      clearInterval(idleTimer);
      idleTimer = null;
      logger.info('AutoUpdater: MeetMind is idle; installing the update', { version: updateInfo?.version });
      quitAndInstall({ automatic: true });
    }
  }, IDLE_POLL_MS);
  idleTimer.unref?.();
}

// Applies a change to `autoCheckUpdates` / `autoInstallUpdates` without a restart.
function applyUpdateSettings() {
  autoUpdater.autoInstallOnAppQuit = autoInstall();
  if (getConfig().autoCheckUpdates === false) {
    clearTimeout(checkTimer);
    checkTimer = null;
  } else if (!checkTimer) {
    const sinceSuccess = Date.now() - lastSuccessTime;
    scheduleBackgroundCheck(sinceSuccess >= CHECK_INTERVAL_MS ? FIRST_CHECK_DELAY_MS : CHECK_INTERVAL_MS - sinceSuccess);
  }
  if (autoInstall() && currentStatus === 'available') downloadUpdate();
  armIdleInstall();
  broadcastState();
}

// True (once) when this launch follows an automatic update install, which should start in the tray.
function takeHiddenRelaunch() {
  const requestedAt = store.get(HIDDEN_RELAUNCH_KEY);
  if (requestedAt === undefined) return false;
  store.delete(HIDDEN_RELAUNCH_KEY);
  return shouldRelaunchHidden(Number(requestedAt));
}

// `onStatusChange(state)` runs on every state change; `isIdle()` says whether the app may restart
// into a downloaded update now (see isIdleForUpdate in update-policy.js).
function initializeAutoUpdater({ sendToRenderer, onStatusChange, isIdle }) {
  sendToRendererCallback = sendToRenderer;
  onStatusChangeCallback = onStatusChange;
  if (typeof isIdle === 'function') isIdleCallback = isIdle;

  setupAutoUpdaterEvents();
  runPostUpdateCheck();

  if (!app.isPackaged) {
    logger.info('AutoUpdater: dev mode detected, background auto-update checks disabled');
    return;
  }
  scheduleBackgroundCheck(FIRST_CHECK_DELAY_MS);
  // Waking from sleep: check again soon if the last good check is old (or there wasn't one).
  powerMonitor.on('resume', () => {
    if (currentStatus === 'downloading' || currentStatus === 'downloaded') return;
    if (Date.now() - lastSuccessTime < RESUME_RECHECK_AFTER_MS) return;
    scheduleBackgroundCheck(RESUME_CHECK_DELAY_MS);
  });
}

async function checkForUpdates(manual = false) {
  lastCheckTime = new Date().toISOString();

  if (!app.isPackaged) {
    logger.info('AutoUpdater: skipped check in development mode');
    currentStatus = 'not-available';
    errorMessage = null;
    broadcastState();
    return {
      success: true,
      status: 'not-available',
      devMode: true,
      currentVersion: app.getVersion(),
    };
  }

  const config = getConfig();
  if (!manual && config.autoCheckUpdates === false) {
    return { success: false, reason: 'Auto check disabled' };
  }

  // A manual check starts the retry backoff afresh.
  if (manual) consecutiveFailures = 0;

  try {
    currentStatus = 'checking';
    errorMessage = null;
    broadcastState();
    // autoDownload is false, so this only fetches metadata — it never starts a download.
    await autoUpdater.checkForUpdates();
    return { success: true, status: currentStatus };
  } catch (err) {
    currentStatus = 'error';
    errorMessage = err?.message || 'Failed to check for updates';
    logger.warn('AutoUpdater: check failed', { error: errorMessage });
    broadcastState();
    return { success: false, error: errorMessage };
  }
}

/**
 * Starts downloading the update the last check found: from a user action, or automatically when
 * autoInstall() is on. Also retries a download that failed. Refuses a version that isn't newer
 * than the installed one. Where the app can't update itself (unsigned macOS builds), opens the
 * release page instead.
 */
async function downloadUpdate() {
  const retrying = currentStatus === 'error' && errorPhase === 'download';
  if ((currentStatus !== 'available' && !retrying) || !updateInfo?.version) {
    return { success: false, error: 'No update available to download' };
  }
  if (downloadInFlight) return { success: true, alreadyDownloading: true };
  if (compareVersions(updateInfo.version, app.getVersion()) <= 0) {
    logger.warn('AutoUpdater: refused to download — reported version is not newer than current', {
      updateVersion: updateInfo.version,
      currentVersion: app.getVersion(),
    });
    return { success: false, error: 'Reported update version is not newer than the installed version' };
  }

  if (!CAN_SELF_UPDATE) {
    await shell.openExternal(`${RELEASES_URL}/tag/v${updateInfo.version}`);
    return { success: true, openedReleasePage: true };
  }

  try {
    downloadInFlight = true;
    currentStatus = 'downloading';
    errorMessage = null;
    errorPhase = null;
    downloadProgress = { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 };
    broadcastState();
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    // 'error' event handler already updates currentStatus/errorMessage/broadcastState
    return { success: false, error: err?.message || 'Failed to download update' };
  }
}

// Restarts into the downloaded update. An automatic install (idle) runs the installer silently
// and relaunches into the tray; one the user asked for shows the installer and opens the window.
function quitAndInstall({ automatic = false } = {}) {
  if (currentStatus !== 'downloaded') return { success: false, error: 'No update downloaded yet' };
  logger.info('AutoUpdater: restarting and installing update...', { version: updateInfo?.version, automatic });
  if (automatic) store.set(HIDDEN_RELAUNCH_KEY, Date.now());
  app.isQuitting = true;
  autoUpdater.quitAndInstall(automatic, true);
  return { success: true };
}

module.exports = {
  initializeAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getUpdaterState,
  applyUpdateSettings,
  takeHiddenRelaunch,
};
