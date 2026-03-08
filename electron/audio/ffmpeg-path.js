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

module.exports = { getFfmpegPath, getFfprobePath, validateFfmpegExists };
