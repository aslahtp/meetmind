import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { resamplePeaks, timeAtOffset } from '../renderer/components/note/waveform.js';

// CommonJS main-process module; outside Electron, require('electron') is just a path string,
// which is fine because the helpers under test never touch the Electron API.
const require = createRequire(import.meta.url);
const { createRmsAccumulator, reducePeaks, normalizePeaks } = require('../electron/audio/waveform.js');

function pcm(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe('createRmsAccumulator', () => {
  it('emits one RMS value per block, plus a partial trailing block', () => {
    const acc = createRmsAccumulator(4);
    acc.push(pcm([16384, -16384, 16384, -16384, 0, 0]));
    const values = acc.finish();
    expect(values).toHaveLength(2);
    expect(values[0]).toBeCloseTo(0.5);
    expect(values[1]).toBe(0);
  });

  it('handles a sample split across chunk boundaries', () => {
    const whole = pcm([32767, 32767]);
    const acc = createRmsAccumulator(2);
    acc.push(whole.subarray(0, 1));
    acc.push(whole.subarray(1, 3));
    acc.push(whole.subarray(3));
    const values = acc.finish();
    expect(values).toHaveLength(1);
    expect(values[0]).toBeCloseTo(1, 3);
  });
});

describe('reducePeaks', () => {
  it('returns a copy when already within the bucket count', () => {
    const input = [0.1, 0.2];
    const out = reducePeaks(input, 4);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('keeps the maximum of each bucket', () => {
    expect(reducePeaks([0.1, 0.9, 0.2, 0.3, 0.8, 0.1], 3)).toEqual([0.9, 0.3, 0.8]);
  });
});

describe('normalizePeaks', () => {
  it('scales to the 99th percentile and clamps outliers to 1', () => {
    const values = [...Array(200).fill(0.25), 5];
    const out = normalizePeaks(values);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(1);
  });

  it('returns zeros for silence and handles empty input', () => {
    expect(normalizePeaks([0, 0, 0])).toEqual([0, 0, 0]);
    expect(normalizePeaks([])).toEqual([]);
  });
});

describe('resamplePeaks', () => {
  it('downsamples by taking the max of each range', () => {
    expect(resamplePeaks([0.1, 0.5, 0.2, 0.9], 2)).toEqual([0.5, 0.9]);
  });

  it('upsamples short recordings by repeating the nearest peak', () => {
    expect(resamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
  });

  it('returns flat bars when there are no peaks yet', () => {
    expect(resamplePeaks(null, 3)).toEqual([0, 0, 0]);
    expect(resamplePeaks([0.5], 0)).toEqual([]);
  });
});

describe('timeAtOffset', () => {
  it('maps and clamps a pointer offset to a time', () => {
    expect(timeAtOffset(50, 200, 60)).toBe(15);
    expect(timeAtOffset(-10, 200, 60)).toBe(0);
    expect(timeAtOffset(500, 200, 60)).toBe(60);
    expect(timeAtOffset(10, 0, 60)).toBe(0);
  });
});
