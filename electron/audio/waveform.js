const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const { resolveFfmpegPath } = require('./ffmpeg-path');
const logger = require('../utils/logger');

// Decode at 8 kHz mono: plenty for a loudness envelope and ~6x cheaper than the source rate.
const SAMPLE_RATE = 8000;
// One RMS value per 20 ms block — fine enough to keep individual words visible.
const BLOCK_SIZE = 160;
// Upper bound on peaks sent to the renderer; it re-bins these to fit the bar count.
const MAX_BUCKETS = 1600;
// Bump when the peak format or algorithm changes so stale caches are recomputed.
const CACHE_VERSION = 1;
const DECODE_TIMEOUT_MS = 5 * 60 * 1000;

const inFlight = new Map();

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Streaming RMS accumulator over little-endian signed 16-bit PCM. Chunks may split
 * a sample across boundaries; the odd byte is carried to the next push().
 */
function createRmsAccumulator(blockSize = BLOCK_SIZE) {
  const values = [];
  let carry = null;
  let sumSq = 0;
  let count = 0;

  function addSample(s) {
    const v = s / 32768;
    sumSq += v * v;
    count += 1;
    if (count === blockSize) {
      values.push(Math.sqrt(sumSq / count));
      sumSq = 0;
      count = 0;
    }
  }

  return {
    push(chunk) {
      let buf = chunk;
      if (carry) {
        buf = Buffer.concat([carry, chunk]);
        carry = null;
      }
      const even = buf.length - (buf.length % 2);
      for (let i = 0; i < even; i += 2) addSample(buf.readInt16LE(i));
      if (even < buf.length) carry = buf.subarray(even);
    },
    finish() {
      if (count > 0) values.push(Math.sqrt(sumSq / count));
      sumSq = 0;
      count = 0;
      return values;
    },
  };
}

/** Reduce values to at most `buckets` entries, keeping each bucket's maximum. */
function reducePeaks(values, buckets = MAX_BUCKETS) {
  if (values.length <= buckets) return values.slice();
  const out = new Array(buckets);
  const step = values.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.max(start + 1, Math.floor((b + 1) * step));
    let max = 0;
    for (let i = start; i < end; i++) if (values[i] > max) max = values[i];
    out[b] = max;
  }
  return out;
}

/**
 * Scale peaks to 0..1 against the 99th percentile rather than the absolute max, so a
 * single cough or door slam doesn't flatten the rest of the meeting. Values above it clamp to 1.
 */
function normalizePeaks(values) {
  if (values.length === 0) return [];
  const sorted = values.slice().sort((a, b) => a - b);
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || sorted[sorted.length - 1];
  if (!ref) return values.map(() => 0);
  return values.map((v) => Math.round(Math.min(1, v / ref) * 1000) / 1000);
}

// ── Decoding + cache ──────────────────────────────────────────────────────────

function decodeRms(audioPath) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return Promise.reject(new Error('FFmpeg not found.'));

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', audioPath,
      '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 's16le', '-acodec', 'pcm_s16le',
      'pipe:1',
    ], { windowsHide: true });

    const acc = createRmsAccumulator();
    let stderr = '';
    const timer = setTimeout(() => { if (!proc.killed) proc.kill(); }, DECODE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => acc.push(chunk));
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const values = acc.finish();
      if (code !== 0 || values.length === 0) {
        reject(new Error(`FFmpeg waveform decode failed (code ${code}): ${stderr.slice(-300)}`));
        return;
      }
      resolve(values);
    });
  });
}

function cachePathFor(sessionId) {
  const safeId = String(sessionId).replace(/[^\w-]/g, '_');
  return path.join(app.getPath('userData'), 'waveforms', `${safeId}.json`);
}

function readCache(cachePath, stat) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (
      cached?.version === CACHE_VERSION
      && cached.sourceSize === stat.size
      && cached.sourceMtimeMs === stat.mtimeMs
      && Array.isArray(cached.peaks)
    ) {
      return { peaks: cached.peaks, duration: cached.duration };
    }
  } catch {
    // Missing or unreadable cache: recompute.
  }
  return null;
}

/**
 * Loudness envelope for a session's recording: `{ peaks: number[0..1], duration: seconds }`.
 * Cached next to the app data, keyed on the source file's size and mtime.
 */
function getSessionWaveform(sessionId, audioPath) {
  if (inFlight.has(sessionId)) return inFlight.get(sessionId);

  const job = (async () => {
    const stat = fs.statSync(audioPath);
    const cachePath = cachePathFor(sessionId);
    const cached = readCache(cachePath, stat);
    if (cached) return cached;

    const started = Date.now();
    const blocks = await decodeRms(audioPath);
    const result = {
      peaks: normalizePeaks(reducePeaks(blocks)),
      duration: (blocks.length * BLOCK_SIZE) / SAMPLE_RATE,
    };

    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({
        version: CACHE_VERSION,
        sourceSize: stat.size,
        sourceMtimeMs: stat.mtimeMs,
        ...result,
      }));
    } catch (err) {
      logger.warn('Failed to cache waveform', { sessionId, error: err.message });
    }

    logger.info('Waveform computed', { sessionId, peaks: result.peaks.length, ms: Date.now() - started });
    return result;
  })().finally(() => inFlight.delete(sessionId));

  inFlight.set(sessionId, job);
  return job;
}

function deleteSessionWaveform(sessionId) {
  try {
    fs.rmSync(cachePathFor(sessionId), { force: true });
  } catch (err) {
    logger.warn('Failed to delete cached waveform', { sessionId, error: err.message });
  }
}

module.exports = {
  getSessionWaveform,
  deleteSessionWaveform,
  createRmsAccumulator,
  reducePeaks,
  normalizePeaks,
};
