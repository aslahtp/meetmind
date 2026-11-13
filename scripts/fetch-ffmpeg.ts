/**
 * Downloads the pinned FFmpeg build (electron/audio/ffmpeg-sources.ts), verifies each SHA-256
 * and puts ffmpeg + ffprobe where electron-builder bundles them as resources/ffmpeg/:
 *   Windows → assets/ffmpeg/ffmpeg.exe, ffprobe.exe
 *   macOS   → assets/ffmpeg/mac-<arch>/ffmpeg, ffprobe
 *   Linux   → assets/ffmpeg/linux-<arch>/ffmpeg, ffprobe
 * Used by CI and the release builds; also the quickest local dev setup.
 *
 * Run: pnpm exec tsx scripts/fetch-ffmpeg.ts [--platform win32|darwin|linux] [--arch x64|arm64]... [--out <dir>]
 *   --platform  defaults to this machine's
 *   --arch      repeatable; defaults to both Mac architectures on darwin, x64 on win32 and linux
 *   --out       put the binaries here instead (one arch only); handy for testing
 */

'use strict';

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fetchPinnedFfmpeg } from '../electron/audio/ffmpeg-fetch';
import { FFMPEG_VERSION, ffmpegDownloads } from '../electron/audio/ffmpeg-sources';
import { devBinaryDir } from '../electron/audio/ffmpeg-path';

const ROOT = path.join(__dirname, '..');

interface FetchOptions {
  platform: string;
  arches: string[];
  out: string | null;
}

function parseArgs(argv: string[]): FetchOptions {
  const opts: FetchOptions = { platform: process.platform, arches: [], out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--platform' && value) { opts.platform = value; i++; }
    else if (flag === '--arch' && value) { opts.arches.push(value); i++; }
    else if (flag === '--out' && value) { opts.out = path.resolve(value); i++; }
  }
  if (!opts.arches.length) opts.arches = opts.platform === 'darwin' ? ['arm64', 'x64'] : ['x64'];
  if (opts.out && opts.arches.length > 1) throw new Error('--out takes a single --arch');
  return opts;
}

async function fetchArch(platform: string, arch: string, out: string | null) {
  if (!ffmpegDownloads(platform, arch)) throw new Error(`No pinned FFmpeg build for ${platform} ${arch}`);
  const outDir = out || path.join(ROOT, 'assets', 'ffmpeg', devBinaryDir(platform, arch));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `meetmind-ffmpeg-${platform}-${arch}-`));
  try {
    let lastIndex = -1;
    const installed = await fetchPinnedFfmpeg({
      platform,
      arch,
      outDir,
      tmpDir,
      userAgent: 'MeetMind-Build/1.0',
      onProgress: ({ stage, index, count }) => {
        if (stage === 'download' && index !== lastIndex) {
          lastIndex = index;
          console.log(`[fetch-ffmpeg] ${platform}-${arch}: download ${index + 1}/${count}`);
        }
      },
    });
    for (const file of Object.values<string>(installed)) {
      console.log(`[fetch-ffmpeg] ${platform}-${arch}: verified -> ${path.relative(ROOT, file) || file}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

(async () => {
  const { platform, arches, out } = parseArgs(process.argv.slice(2));
  console.log(`[fetch-ffmpeg] FFmpeg ${FFMPEG_VERSION} for ${platform}: ${arches.join(', ')}`);
  for (const arch of arches) await fetchArch(platform, arch, out);
})().catch((err) => {
  console.error(`[fetch-ffmpeg] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
