const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ── Pure helpers (no electron import, unit-tested in tests/ffmpeg-path.test.js) ──────────────

/** `ffmpeg` → `ffmpeg.exe` on Windows, unchanged elsewhere. */
function binaryName(tool, platform) {
  return platform === 'win32' ? `${tool}.exe` : tool;
}

/**
 * Folder under assets/ffmpeg/ that holds the dev binaries. Windows keeps them at the root
 * (unchanged layout); macOS keeps one folder per architecture (mac-arm64, mac-x64), the same
 * folders electron-builder copies into the app as resources/ffmpeg/.
 */
function devBinaryDir(platform, arch) {
  return platform === 'darwin' ? `mac-${arch}` : '';
}

/**
 * Every place a tool may live, most preferred first, as { source, path }:
 *   bundled   — resources/ffmpeg/ in the packaged app, assets/ffmpeg/ in development
 *   installed — userData/ffmpeg/, where the in-app download puts it on macOS (never inside the
 *               signed .app bundle)
 *   system    — Homebrew locations on macOS; apps launched from Finder don't inherit the
 *               shell's PATH, so the bare-command lookup below would miss them
 */
function ffmpegCandidates(tool, { platform, arch, isPackaged, resourcesPath, appRoot, userData }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = binaryName(tool, platform);
  const list = [];
  if (isPackaged) list.push({ source: 'bundled', path: p.join(resourcesPath, 'ffmpeg', name) });
  else list.push({ source: 'bundled', path: p.join(appRoot, 'assets', 'ffmpeg', devBinaryDir(platform, arch), name) });
  if (platform !== 'win32' && userData) list.push({ source: 'installed', path: p.join(userData, 'ffmpeg', name) });
  if (platform === 'darwin') {
    list.push({ source: 'system', path: `/opt/homebrew/bin/${name}` });
    list.push({ source: 'system', path: `/usr/local/bin/${name}` });
  }
  return list;
}

// ── Runtime ───────────────────────────────────────────────────────────────────────────────────

function runtimeContext() {
  const { app } = require('electron');
  let userData = null;
  try { userData = app.getPath('userData'); } catch { /* before ready — skip */ }
  return {
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: path.join(__dirname, '../..'),
    userData,
  };
}

function candidates(tool) {
  return ffmpegCandidates(tool, runtimeContext());
}

/** Where the bundled binary should be (whether or not it exists). */
function getFfmpegPath() {
  return candidates('ffmpeg')[0].path;
}

function getFfprobePath() {
  return candidates('ffprobe')[0].path;
}

/** Folder the in-app download installs into: next to the bundled binary on Windows, userData elsewhere. */
function getFfmpegInstallDir() {
  const list = candidates('ffmpeg');
  const target = list.find((c) => c.source === 'installed') || list[0];
  return path.dirname(target.path);
}

function onPath(tool) {
  try {
    const result = spawnSync(tool, ['-version'], { encoding: 'utf8', timeout: 3000 });
    return result.status === 0 || (result.stdout || result.stderr || '').includes(`${tool} version`);
  } catch {
    return false;
  }
}

/**
 * Finds a usable tool: the first candidate on disk, else the bare command if it is on PATH.
 * Returns { source: 'bundled' | 'installed' | 'system', path } or null.
 */
function locate(tool) {
  const hit = candidates(tool).find((c) => fs.existsSync(c.path));
  if (hit) return hit;
  return onPath(tool) ? { source: 'system', path: tool } : null;
}

/** Best available ffmpeg path, or null if there is none. */
function resolveFfmpegPath() {
  return locate('ffmpeg')?.path || null;
}

/** Best available ffprobe path, or null if there is none. */
function resolveFfprobePath() {
  return locate('ffprobe')?.path || null;
}

module.exports = {
  binaryName,
  devBinaryDir,
  ffmpegCandidates,
  getFfmpegPath,
  getFfprobePath,
  getFfmpegInstallDir,
  locate,
  resolveFfmpegPath,
  resolveFfprobePath,
};
