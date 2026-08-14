const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const logger = require('../utils/logger');
const { getConfig } = require('../utils/config');

let currentStatus = 'idle'; // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
let updateInfo = null;
let downloadProgress = { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 };
let lastCheckTime = null;
let errorMessage = null;
let sendToRendererCallback = null;
let onUpdateDownloadedCallback = null;
let checkInterval = null;

function broadcastState() {
  if (typeof sendToRendererCallback === 'function') {
    sendToRendererCallback('updater:status', getUpdaterState());
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
    isPackaged: app.isPackaged,
  };
}

function setupAutoUpdaterEvents() {
  // Configure autoUpdater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    currentStatus = 'checking';
    errorMessage = null;
    logger.info('AutoUpdater: checking for updates...');
    broadcastState();
  });

  autoUpdater.on('update-available', (info) => {
    currentStatus = 'available';
    updateInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    };
    logger.info('AutoUpdater: update available', { version: info.version });
    broadcastState();
  });

  autoUpdater.on('update-not-available', (info) => {
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
    currentStatus = 'downloaded';
    updateInfo = {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    };
    logger.info('AutoUpdater: update downloaded and ready to install', { version: info.version });
    broadcastState();
    if (typeof onUpdateDownloadedCallback === 'function') {
      try {
        onUpdateDownloadedCallback(updateInfo);
      } catch (err) {
        logger.warn('Error in onUpdateDownloaded callback', { error: err.message });
      }
    }
  });

  autoUpdater.on('error', (err) => {
    currentStatus = 'error';
    errorMessage = err?.message || 'Error checking for updates';
    logger.warn('AutoUpdater error', { error: errorMessage });
    broadcastState();
  });
}

function initializeAutoUpdater({ sendToRenderer, onUpdateDownloaded }) {
  sendToRendererCallback = sendToRenderer;
  onUpdateDownloadedCallback = onUpdateDownloaded;

  setupAutoUpdaterEvents();

  // In production builds, schedule background updates
  if (app.isPackaged) {
    const config = getConfig();
    if (config.autoCheckUpdates !== false) {
      // Delay first check by 6 seconds to prioritize app startup UI
      setTimeout(() => {
        checkForUpdates(false).catch((err) => {
          logger.warn('Initial background update check failed', { error: err.message });
        });
      }, 6000);

      // Check periodically every 4 hours while running in background/tray
      if (checkInterval) clearInterval(checkInterval);
      checkInterval = setInterval(() => {
        const currentConfig = getConfig();
        if (currentConfig.autoCheckUpdates !== false && currentStatus !== 'downloading' && currentStatus !== 'downloaded') {
          checkForUpdates(false).catch((err) => {
            logger.warn('Periodic background update check failed', { error: err.message });
          });
        }
      }, 4 * 60 * 60 * 1000);
    }
  } else {
    logger.info('AutoUpdater: dev mode detected, background auto-update checks disabled');
  }
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

  try {
    currentStatus = 'checking';
    errorMessage = null;
    broadcastState();
    const result = await autoUpdater.checkForUpdates();
    return { success: true, status: currentStatus, result };
  } catch (err) {
    currentStatus = 'error';
    errorMessage = err?.message || 'Failed to check for updates';
    logger.warn('AutoUpdater: check failed', { error: errorMessage });
    broadcastState();
    return { success: false, error: errorMessage };
  }
}

function quitAndInstall() {
  if (currentStatus === 'downloaded') {
    logger.info('AutoUpdater: restarting and installing update...');
    // set isQuitting flag if necessary
    app.isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  }
  return { success: false, error: 'No update downloaded yet' };
}

module.exports = {
  initializeAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getUpdaterState,
};
