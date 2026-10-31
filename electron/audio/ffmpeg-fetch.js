// Downloads, verifies and unpacks the pinned FFmpeg build for a platform/arch
// (electron/audio/ffmpeg-sources.js) into a folder. Shared by the in-app installer and by
// scripts/fetch-ffmpeg.js (CI and release builds), so both always get the same checksum-verified
// files. No electron import.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { downloadFile, assertSha256 } = require('../utils/download');
const { ffmpegDownloads } = require('./ffmpeg-sources');
const { binaryName } = require('./ffmpeg-path');

/** How a pinned download is packed, from its URL: 'tar.xz' or 'zip'. */
function archiveType(url) {
  return /\.tar\.xz$/i.test(new URL(url).pathname) ? 'tar.xz' : 'zip';
}

// Unpacks with a tool the host OS ships: PowerShell on Windows, ditto on macOS, unzip elsewhere.
function unzip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`], { timeout: 300_000 });
  } else if (process.platform === 'darwin') {
    execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, destDir], { timeout: 300_000 });
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { timeout: 300_000 });
  }
}

// tar ships with Linux, macOS and Windows 10+. On Windows, call System32's bsdtar (which detects
// xz itself) by path: a GNU tar from Git or MSYS earlier on PATH reads `C:` as a remote host.
function untarXz(archivePath, destDir) {
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', archivePath, '-C', destDir], { timeout: 300_000 });
  } else {
    execFileSync('tar', ['-xJf', archivePath, '-C', destDir], { timeout: 300_000 });
  }
}

// First file named `name` (case-insensitive) anywhere under `dir`.
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/**
 * Installs the pinned ffmpeg and ffprobe for `platform`/`arch` into `outDir`, using `tmpDir`
 * (created, and left for the caller to remove) for the downloads. Each archive's SHA-256 is checked
 * before it is unpacked. `onProgress({ stage: 'download' | 'extract' | 'copy', index, count,
 * downloaded, total })` reports progress. Resolves with { ffmpeg, ffprobe } paths.
 */
async function fetchPinnedFfmpeg({ platform, arch, outDir, tmpDir, onProgress, userAgent }) {
  const downloads = ffmpegDownloads(platform, arch);
  if (!downloads) throw new Error(`No pinned FFmpeg build for ${platform} ${arch}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const installed = {};
  for (const [index, { url, sha256, tools }] of downloads.entries()) {
    const type = archiveType(url);
    const archivePath = path.join(tmpDir, `download-${index}.${type}`);
    const actual = await downloadFile(url, archivePath, {
      userAgent,
      onProgress: ({ downloaded, total }) => onProgress?.({ stage: 'download', index, count: downloads.length, downloaded, total }),
    });
    assertSha256(actual, sha256, path.basename(new URL(url).pathname));

    onProgress?.({ stage: 'extract', index, count: downloads.length });
    const extractDir = path.join(tmpDir, `extracted-${index}`);
    fs.mkdirSync(extractDir, { recursive: true });
    if (type === 'tar.xz') untarXz(archivePath, extractDir);
    else unzip(archivePath, extractDir);

    onProgress?.({ stage: 'copy', index, count: downloads.length });
    for (const tool of tools) {
      const name = binaryName(tool, platform);
      const found = findFile(extractDir, name);
      if (!found) throw new Error(`${name} not found in ${url}`);
      const dest = path.join(outDir, name);
      fs.copyFileSync(found, dest);
      if (platform !== 'win32') fs.chmodSync(dest, 0o755);
      installed[tool] = dest;
    }
  }
  return installed;
}

module.exports = { fetchPinnedFfmpeg, archiveType };
