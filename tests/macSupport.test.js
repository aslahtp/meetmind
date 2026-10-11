import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { CAPTURE_STRATEGIES, HEARD_THRESHOLD, describeAudioTest, peakOf } from '../renderer/lib/audioTest.js';

const require = createRequire(import.meta.url);
const { MAC_CAPTURE_STRATEGIES, DEFAULT_MAC_CAPTURE_STRATEGY, normalizeMacCaptureStrategy } = require('../electron/audio/mac-capture.js');
const { FFMPEG_VERSION, ffmpegDownloads, pinnedTargets } = require('../electron/audio/ffmpeg-sources.js');

describe('mac capture strategies', () => {
  it('falls back to the default for unknown values', () => {
    expect(normalizeMacCaptureStrategy('frame')).toBe('frame');
    expect(normalizeMacCaptureStrategy('bogus')).toBe(DEFAULT_MAC_CAPTURE_STRATEGY);
    expect(normalizeMacCaptureStrategy(undefined)).toBe(DEFAULT_MAC_CAPTURE_STRATEGY);
  });

  it('the Settings test offers exactly the strategies main understands', () => {
    expect(CAPTURE_STRATEGIES.map((s) => s.id).sort()).toEqual([...MAC_CAPTURE_STRATEGIES].sort());
  });
});

describe('describeAudioTest', () => {
  it('reports heard audio as ok', () => {
    expect(describeAudioTest({ peak: 0.4, ended: false }).tone).toBe('ok');
  });

  it('reports silence as a warning, not a failure (nothing may have been playing)', () => {
    expect(describeAudioTest({ peak: HEARD_THRESHOLD / 2, ended: false }).tone).toBe('warning');
  });

  it('reports a stream that ended at once without audio as an error', () => {
    expect(describeAudioTest({ peak: 0, ended: true }).tone).toBe('error');
  });

  it('passes errors through', () => {
    expect(describeAudioTest({ error: 'Permission denied' })).toEqual({ tone: 'error', text: 'Failed: Permission denied' });
    expect(describeAudioTest(null)).toBeNull();
  });

  it('peakOf takes the largest absolute sample', () => {
    expect(peakOf(new Float32Array([0.1, -0.5, 0.3]))).toBeCloseTo(0.5);
    expect(peakOf(new Float32Array([]))).toBe(0);
  });
});

describe('ffmpegDownloads', () => {
  it('pins every shipped platform/arch', () => {
    expect(pinnedTargets().sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
  });

  it('pins an https zip and a SHA-256 for each download, and covers ffmpeg and ffprobe exactly once', () => {
    for (const target of pinnedTargets()) {
      const [platform, arch] = target.split('-');
      const downloads = ffmpegDownloads(platform, arch);
      for (const d of downloads) {
        expect(d.url).toMatch(/^https:\/\/.+\.zip$/);
        expect(d.url).toContain(FFMPEG_VERSION);
        expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(downloads.flatMap((d) => d.tools).sort()).toEqual(['ffmpeg', 'ffprobe']);
    }
  });

  it('has nothing for other platforms or architectures', () => {
    expect(ffmpegDownloads('linux', 'x64')).toBeNull();
    expect(ffmpegDownloads('darwin', 'ia32')).toBeNull();
  });
});
