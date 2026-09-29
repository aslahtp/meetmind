// Pure helpers for the Audio tab waveform (kept out of the component so they're unit-testable).

/**
 * Fit `peaks` (0..1) to exactly `count` bars. Downsampling keeps each range's maximum so
 * short bursts of speech never disappear; upsampling (short recordings) repeats the nearest peak.
 */
export function resamplePeaks(peaks, count) {
  if (!count || count < 1) return [];
  if (!peaks || peaks.length === 0) return new Array(count).fill(0);
  const out = new Array(count);
  const step = peaks.length / count;
  if (step <= 1) {
    for (let i = 0; i < count; i++) out[i] = peaks[Math.min(peaks.length - 1, Math.floor(i * step))];
    return out;
  }
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let max = 0;
    for (let j = start; j < end; j++) if (peaks[j] > max) max = peaks[j];
    out[i] = max;
  }
  return out;
}

/** Map a pointer x offset within a width to a time, clamped to [0, duration]. */
export function timeAtOffset(x, width, duration) {
  if (!width || !duration) return 0;
  return Math.min(duration, Math.max(0, (x / width) * duration));
}
