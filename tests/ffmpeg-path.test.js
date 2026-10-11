import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { binaryName, devBinaryDir, ffmpegCandidates } = require('../electron/audio/ffmpeg-path.js');
const { silenceHints } = require('../electron/audio/audio-hints.js');

const WIN = {
  platform: 'win32',
  arch: 'x64',
  resourcesPath: 'C:\\Program Files\\MeetMind\\resources',
  appRoot: 'C:\\dev\\meetmind',
  userData: 'C:\\Users\\me\\AppData\\Roaming\\MeetMind',
};

const MAC = {
  platform: 'darwin',
  arch: 'arm64',
  resourcesPath: '/Applications/MeetMind.app/Contents/Resources',
  appRoot: '/Users/me/meetmind',
  userData: '/Users/me/Library/Application Support/MeetMind',
};

describe('binaryName', () => {
  it('adds .exe on Windows only', () => {
    expect(binaryName('ffmpeg', 'win32')).toBe('ffmpeg.exe');
    expect(binaryName('ffprobe', 'darwin')).toBe('ffprobe');
  });
});

describe('devBinaryDir', () => {
  it('keeps Windows binaries at the assets/ffmpeg root and splits macOS by arch', () => {
    expect(devBinaryDir('win32', 'x64')).toBe('');
    expect(devBinaryDir('darwin', 'arm64')).toBe('mac-arm64');
    expect(devBinaryDir('darwin', 'x64')).toBe('mac-x64');
  });
});

describe('ffmpegCandidates', () => {
  it('packaged Windows: only the bundled binary in resources', () => {
    expect(ffmpegCandidates('ffmpeg', { ...WIN, isPackaged: true })).toEqual([
      { source: 'bundled', path: 'C:\\Program Files\\MeetMind\\resources\\ffmpeg\\ffmpeg.exe' },
    ]);
  });

  it('development Windows: assets/ffmpeg at the repo root', () => {
    expect(ffmpegCandidates('ffprobe', { ...WIN, isPackaged: false })).toEqual([
      { source: 'bundled', path: 'C:\\dev\\meetmind\\assets\\ffmpeg\\ffprobe.exe' },
    ]);
  });

  it('packaged macOS: bundled, then the in-app install in userData, then Homebrew', () => {
    expect(ffmpegCandidates('ffmpeg', { ...MAC, isPackaged: true })).toEqual([
      { source: 'bundled', path: '/Applications/MeetMind.app/Contents/Resources/ffmpeg/ffmpeg' },
      { source: 'installed', path: '/Users/me/Library/Application Support/MeetMind/ffmpeg/ffmpeg' },
      { source: 'system', path: '/opt/homebrew/bin/ffmpeg' },
      { source: 'system', path: '/usr/local/bin/ffmpeg' },
    ]);
  });

  it('development macOS: the per-arch assets folder comes first', () => {
    const [first] = ffmpegCandidates('ffmpeg', { ...MAC, arch: 'x64', isPackaged: false });
    expect(first).toEqual({ source: 'bundled', path: '/Users/me/meetmind/assets/ffmpeg/mac-x64/ffmpeg' });
  });

  it('skips the userData location when it is unknown', () => {
    const list = ffmpegCandidates('ffmpeg', { ...MAC, userData: null, isPackaged: true });
    expect(list.some((c) => c.source === 'installed')).toBe(false);
  });
});

describe('silenceHints', () => {
  it('gives macOS users System Settings steps', () => {
    const hints = silenceHints('darwin');
    expect(hints.join(' ')).toContain('Screen & System Audio Recording');
    expect(hints.join(' ')).not.toContain('Windows');
  });

  it('falls back to the Windows wording for other platforms', () => {
    expect(silenceHints('win32')).toEqual(silenceHints('linux'));
    expect(silenceHints('win32').join(' ')).toContain('Privacy & security');
  });
});
