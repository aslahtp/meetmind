// In-app FFmpeg install (the `ffmpeg:install` IPC handler and the post-update "Repair now").
//
// Windows: downloads gyan.dev's current essentials build and copies ffmpeg.exe/ffprobe.exe next
//          to where the bundled copy lives (resources/ffmpeg, or assets/ffmpeg in development).
// macOS:   downloads the pinned per-arch builds from electron/audio/ffmpeg-sources.js, verifies
//          each SHA-256, and installs into userData/ffmpeg: never inside the .app, whose code
//          signature would break and which may sit on a read-only volume.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { app } = require('electron');
const logger = require('../utils/logger');
const { downloadFile, assertSha256 } = require('../utils/download');
const { getFfmpegInstallDir } = require('../audio/ffmpeg-path');
const { macFfmpegSources } = require('../audio/ffmpeg-sources');

const WINDOWS_DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

// Maps a download's progress onto [from, to] of the overall install percentage.
function downloadProgress(sendProgress, from, to, label = 'Downloading') {
  return ({ downloaded, total }) => {
    const pct = total > 0 ? Math.round(from + (downloaded / total) * (to - from)) : from;
    sendProgress('download', pct, `${label}… ${formatMb(downloaded)} MB${total > 0 ? ` / ${(total / 1024 / 1024).toFixed(0)} MB` : ''}`);
  };
}

function findAll(dir, names) {
  const found = {};
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (names.includes(entry.name.toLowerCase())) found[entry.name.toLowerCase()] = full;
    }
  })(dir);
  return found;
}

async function installWindows(tmpRoot, sendProgress) {
  const targetDir = app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg')
    : path.join(app.getAppPath(), 'assets', 'ffmpeg');
  const zipPath = path.join(tmpRoot, 'ffmpeg.zip');
  const extractDir = path.join(tmpRoot, 'extracted');
  fs.mkdirSync(targetDir, { recursive: true });

  sendProgress('download', 0, 'Starting download…');
  await downloadFile(WINDOWS_DOWNLOAD_URL, zipPath, { onProgress: downloadProgress(sendProgress, 0, 65) });

  sendProgress('extract', 68, 'Extracting archive…');
  fs.mkdirSync(extractDir, { recursive: true });
  const extract = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`],
    { timeout: 120_000, encoding: 'utf8' }
  );
  if (extract.status !== 0) {
    throw new Error(`Extraction failed:\n${(extract.stderr || extract.stdout || '').trim()}`);
  }

  sendProgress('copy', 88, 'Locating binaries…');
  const binaries = findAll(extractDir, ['ffmpeg.exe', 'ffprobe.exe']);
  if (!binaries['ffmpeg.exe']) throw new Error('ffmpeg.exe not found in downloaded archive');
  if (!binaries['ffprobe.exe']) throw new Error('ffprobe.exe not found in downloaded archive');

  sendProgress('copy', 93, 'Installing binaries…');
  fs.copyFileSync(binaries['ffmpeg.exe'], path.join(targetDir, 'ffmpeg.exe'));
  fs.copyFileSync(binaries['ffprobe.exe'], path.join(targetDir, 'ffprobe.exe'));
  return targetDir;
}

async function installMac(tmpRoot, sendProgress) {
  const sources = macFfmpegSources(process.platform, process.arch);
  if (!sources) throw new Error(`No FFmpeg build is available for macOS ${process.arch}`);
  const targetDir = getFfmpegInstallDir();
  fs.mkdirSync(targetDir, { recursive: true });

  // Two downloads (ffmpeg, ffprobe), each verified before it is unpacked.
  const tools = ['ffmpeg', 'ffprobe'];
  for (const [i, tool] of tools.entries()) {
    const { url, sha256 } = sources[tool];
    const zipPath = path.join(tmpRoot, `${tool}.zip`);
    const from = i * 35;
    sendProgress('download', from, `Downloading ${tool}…`);
    const actual = await downloadFile(url, zipPath, { onProgress: downloadProgress(sendProgress, from, from + 33, `Downloading ${tool}`) });
    assertSha256(actual, sha256, `${tool}.zip`);
  }

  sendProgress('extract', 72, 'Extracting archives…');
  const extractDir = path.join(tmpRoot, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });
  for (const tool of tools) {
    const result = spawnSync('/usr/bin/ditto', ['-x', '-k', path.join(tmpRoot, `${tool}.zip`), extractDir], { timeout: 120_000, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Extraction failed:\n${(result.stderr || result.stdout || '').trim()}`);
  }

  sendProgress('copy', 88, 'Installing binaries…');
  const binaries = findAll(extractDir, tools);
  for (const tool of tools) {
    if (!binaries[tool]) throw new Error(`${tool} not found in downloaded archive`);
    const dest = path.join(targetDir, tool);
    fs.copyFileSync(binaries[tool], dest);
    fs.chmodSync(dest, 0o755);
    const check = spawnSync(dest, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    if (check.status !== 0) {
      throw new Error(`${tool} was installed but won't run (${check.error?.message || check.signal || `exit ${check.status}`})`);
    }
  }
  return targetDir;
}

/** Installs FFmpeg for this OS. `sendProgress(stage, percent, message)` drives the Settings UI. */
async function installFfmpeg(sendProgress) {
  const tmpRoot = path.join(os.tmpdir(), `meetmind-ffmpeg-${Date.now()}`);
  try {
    fs.mkdirSync(tmpRoot, { recursive: true });
    const targetDir = process.platform === 'darwin'
      ? await installMac(tmpRoot, sendProgress)
      : await installWindows(tmpRoot, sendProgress);
    sendProgress('done', 100, 'FFmpeg installed successfully!');
    logger.info('FFmpeg installed', { targetDir });
    return { success: true };
  } catch (err) {
    logger.error('FFmpeg install failed', { error: err.message });
    sendProgress('error', 0, err.message);
    return { success: false, error: err.message };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { installFfmpeg };
