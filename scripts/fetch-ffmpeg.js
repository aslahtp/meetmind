/**
 * Downloads the pinned macOS FFmpeg builds (electron/audio/ffmpeg-sources.js), verifies each
 * SHA-256 and unpacks ffmpeg + ffprobe into assets/ffmpeg/mac-<arch>/, the folder
 * electron-builder bundles as resources/ffmpeg/. Used by CI and the release build; also handy
 * for a local macOS dev setup.
 *
 * Run: node scripts/fetch-ffmpeg.js [--arch arm64|x64]...   (default: both)
 *
 * Windows builds are fetched by release.yml itself (gyan.dev, pinned there).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { downloadFile, assertSha256 } = require('../electron/utils/download');
const { FFMPEG_VERSION, macFfmpegSources } = require('../electron/audio/ffmpeg-sources');
const { devBinaryDir } = require('../electron/audio/ffmpeg-path');

const ROOT = path.join(__dirname, '..');

function parseArches(argv) {
  const arches = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arch' && argv[i + 1]) arches.push(argv[++i]);
  }
  return arches.length ? arches : ['arm64', 'x64'];
}

function unzip(zipPath, destDir) {
  // ditto ships with macOS; unzip covers Linux runners and local checks elsewhere.
  if (process.platform === 'darwin') execFileSync('/usr/bin/ditto', ['-x', '-k', zipPath, destDir]);
  else execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
}

async function fetchArch(arch) {
  const sources = macFfmpegSources('darwin', arch);
  if (!sources) throw new Error(`No pinned macOS FFmpeg build for arch "${arch}"`);
  const outDir = path.join(ROOT, 'assets', 'ffmpeg', devBinaryDir('darwin', arch));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `meetmind-ffmpeg-${arch}-`));
  fs.mkdirSync(outDir, { recursive: true });

  try {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const { url, sha256 } = sources[tool];
      const zipPath = path.join(tmp, `${tool}.zip`);
      console.log(`[fetch-ffmpeg] ${arch} ${tool}: ${url}`);
      const actual = await downloadFile(url, zipPath, { userAgent: 'MeetMind-Build/1.0' });
      assertSha256(actual, sha256, `${arch}/${tool}.zip`);
      const extractDir = path.join(tmp, tool);
      fs.mkdirSync(extractDir);
      unzip(zipPath, extractDir);
      const binary = path.join(extractDir, tool);
      if (!fs.existsSync(binary)) throw new Error(`${tool} missing from ${url}`);
      const dest = path.join(outDir, tool);
      fs.copyFileSync(binary, dest);
      fs.chmodSync(dest, 0o755);
      console.log(`[fetch-ffmpeg] ${arch} ${tool}: verified ${actual} -> ${path.relative(ROOT, dest)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  const arches = parseArches(process.argv.slice(2));
  console.log(`[fetch-ffmpeg] FFmpeg ${FFMPEG_VERSION} for macOS: ${arches.join(', ')}`);
  for (const arch of arches) await fetchArch(arch);
})().catch((err) => {
  console.error(`[fetch-ffmpeg] ${err.message}`);
  process.exit(1);
});
