// In-app FFmpeg install (the `ffmpeg:install` IPC handler and the post-update "Repair now").
// Installs the pinned, checksum-verified build from electron/audio/ffmpeg-sources.js:
//
// Windows: next to where the bundled copy lives (resources/ffmpeg, or assets/ffmpeg in
//          development).
// macOS:   into userData/ffmpeg: never inside the .app, whose code signature would break and
//          which may sit on a read-only volume.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { app } = require('electron');
const logger = require('../utils/logger');
const { getFfmpegInstallDir } = require('../audio/ffmpeg-path');
const { fetchPinnedFfmpeg } = require('../audio/ffmpeg-fetch');

function targetDir() {
  if (process.platform === 'darwin') return getFfmpegInstallDir();
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg')
    : path.join(app.getAppPath(), 'assets', 'ffmpeg');
}

// Downloads take 0–80% of the bar, split evenly between the zips; unpacking and copying the rest.
function progressReporter(sendProgress) {
  return ({ stage, index, count, downloaded, total }) => {
    if (stage === 'download') {
      const share = 80 / count;
      const pct = Math.round(index * share + (total > 0 ? (downloaded / total) * share : 0));
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      sendProgress('download', pct, `Downloading… ${mb} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(0)} MB` : ''}`);
    } else if (stage === 'extract') {
      sendProgress('extract', 82, 'Extracting archive…');
    } else {
      sendProgress('copy', 92, 'Installing binaries…');
    }
  };
}

/** Installs FFmpeg for this OS. `sendProgress(stage, percent, message)` drives the Settings UI. */
async function installFfmpeg(sendProgress) {
  const tmpDir = path.join(os.tmpdir(), `meetmind-ffmpeg-${Date.now()}`);
  try {
    sendProgress('download', 0, 'Starting download…');
    const outDir = targetDir();
    const installed = await fetchPinnedFfmpeg({
      platform: process.platform,
      arch: process.arch,
      outDir,
      tmpDir,
      onProgress: progressReporter(sendProgress),
    });

    for (const [tool, binary] of Object.entries(installed)) {
      const check = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      if (check.status !== 0) {
        throw new Error(`${tool} was installed but won't run (${check.error?.message || check.signal || `exit ${check.status}`})`);
      }
    }

    sendProgress('done', 100, 'FFmpeg installed successfully!');
    logger.info('FFmpeg installed', { targetDir: outDir });
    return { success: true };
  } catch (err) {
    logger.error('FFmpeg install failed', { error: err.message });
    sendProgress('error', 0, err.message);
    return { success: false, error: err.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { installFfmpeg };
