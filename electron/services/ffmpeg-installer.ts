// In-app FFmpeg install (the `ffmpeg:install` IPC handler and the post-update "Repair now").
// Installs the pinned, checksum-verified build from electron/audio/ffmpeg-sources.ts:
//
// Windows: next to where the bundled copy lives (resources/ffmpeg, or assets/ffmpeg in
//          development).
// macOS:   into userData/ffmpeg: never inside the .app, whose code signature would break and
//          which may sit on a read-only volume.
// Linux:   into userData/ffmpeg too: an AppImage is a read-only image, and a .deb installs into
//          /opt, which the user can't write to.

import type { Outcome } from '../shared';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { app } from 'electron';
import logger from '../utils/logger';
import { errorMessage } from '../utils/errors';
import { getFfmpegInstallDir } from '../audio/ffmpeg-path';
import { fetchPinnedFfmpeg } from '../audio/ffmpeg-fetch';

function targetDir() {
  if (process.platform === 'darwin' || process.platform === 'linux') return getFfmpegInstallDir();
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg')
    : path.join(app.getAppPath(), 'assets', 'ffmpeg');
}

type SendProgress = (stage: string, percent: number, message: string) => void;

/** What `fetchPinnedFfmpeg` reports. */
interface FetchProgress {
  stage: 'download' | 'extract' | 'copy';
  index: number;
  count: number;
  downloaded?: number;
  total?: number;
}

// Downloads take 0–80% of the bar, split evenly between the zips; unpacking and copying the rest.
function progressReporter(sendProgress: SendProgress) {
  return ({ stage, index, count, downloaded = 0, total = 0 }: FetchProgress) => {
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
async function installFfmpeg(sendProgress: SendProgress): Promise<Outcome> {
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

    for (const [tool, binary] of Object.entries<string>(installed)) {
      const check = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      if (check.status !== 0) {
        throw new Error(`${tool} was installed but won't run (${check.error?.message || check.signal || `exit ${check.status}`})`);
      }
    }

    sendProgress('done', 100, 'FFmpeg installed successfully!');
    logger.info('FFmpeg installed', { targetDir: outDir });
    return { success: true };
  } catch (err) {
    const message = errorMessage(err);
    logger.error('FFmpeg install failed', { error: message });
    sendProgress('error', 0, message);
    return { success: false, error: message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export { installFfmpeg };
