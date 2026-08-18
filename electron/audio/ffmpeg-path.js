const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getFfmpegPath() {
  if (app.isPackaged) {
    // In production: extracted outside ASAR via extraResources
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  }
  // In development: bundled in assets/
  return path.join(__dirname, '../../assets/ffmpeg/ffmpeg.exe');
}

function getFfprobePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
  }
  return path.join(__dirname, '../../assets/ffmpeg/ffprobe.exe');
}

/**
 * Returns the best available ffmpeg path:
 *   1. Bundled binary (preferred — reliable, no PATH dependency)
 *   2. 'ffmpeg' command on the system PATH (fallback for users who have it installed)
 * Returns null if neither is available.
 */
function resolveFfmpegPath() {
  const bundled = getFfmpegPath();
  if (fs.existsSync(bundled)) return bundled;
  // Verify system PATH before returning the bare command
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 3000 });
    if (result.status === 0 || (result.stdout || result.stderr || '').includes('ffmpeg version')) {
      return 'ffmpeg';
    }
  } catch {}
  return null;
}

/**
 * Returns the best available ffprobe path (same resolution order as resolveFfmpegPath).
 * Returns null if neither is available.
 */
function resolveFfprobePath() {
  const bundled = getFfprobePath();
  if (fs.existsSync(bundled)) return bundled;
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 3000 });
    if (result.status === 0 || (result.stdout || result.stderr || '').includes('ffprobe version')) {
      return 'ffprobe';
    }
  } catch {}
  return null;
}

function validateFfmpegExists() {
  const p = getFfmpegPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      `FFmpeg not found at: ${p}\n` +
      'Please download ffmpeg.exe and place it in assets/ffmpeg/'
    );
  }
  return p;
}

module.exports = { getFfmpegPath, getFfprobePath, resolveFfmpegPath, resolveFfprobePath, validateFfmpegExists };
