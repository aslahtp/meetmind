const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { validateFfmpegExists } = require('../audio/ffmpeg-path');
const logger = require('../utils/logger');

const SAMPLE_RATE = 16000;
// v2 sync recognize is limited to 1 min. When GCS bucket is set we use BatchRecognize (no chunking).
const V2_MAX_SYNC_SECONDS = 60;
const CHUNK_DURATION_SECONDS = 55;
const OVERLAP_SECONDS = 5;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_HEADER_BYTES = 44;
const GCS_TEMP_PREFIX = 'meetmind-temp/';

// ── REST helpers ──────────────────────────────────────────────────────────────

function httpsPost(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { ...extraHeaders },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Obtain a short-lived OAuth2 access token from a service account JSON key.
 * Used for Speech-to-Text v2, which does not accept API keys.
 */
async function getServiceAccountAccessToken(keyFilePath) {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: keyFilePath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

// ── WAV chunking ──────────────────────────────────────────────────────────────

function parseWavHeader(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let dataSize = 0;
  let sampleRate = SAMPLE_RATE;
  let numChannels = 1;
  let bytesPerSample = BYTES_PER_SAMPLE;
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkSize = buffer.readUInt32LE(pos + 4);
    if (chunkId === 'fmt ') {
      if (chunkSize >= 16 && pos + 8 + chunkSize <= buffer.length) {
        numChannels = buffer.readUInt16LE(pos + 10);
        sampleRate = buffer.readUInt32LE(pos + 12);
        const bitsPerSample = buffer.readUInt16LE(pos + 22);
        bytesPerSample = Math.max(2, bitsPerSample / 8);
      }
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
  }
  const totalBytes = dataSize;
  const durationSec = totalBytes / (sampleRate * numChannels * bytesPerSample);
  return { dataSize, sampleRate, numChannels, bytesPerSample, durationSec };
}

function getWavDurationSeconds(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = parseWavHeader(buffer);
  if (!parsed) return 0;
  return parsed.durationSec;
}

/**
 * Sample three windows of the WAV file (start, middle, end) and return both
 * the overall peak absolute amplitude (0–32767 for 16-bit PCM) and per-window
 * details for diagnostics.
 *
 * Returns: { peak, windows: [{ label, peak }] }
 */
function getWavPeakAmplitude(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = parseWavHeader(buffer);
  if (!parsed || parsed.dataSize === 0) return { peak: 0, windows: [] };

  // Find the data chunk start
  let dataStart = WAV_HEADER_BYTES;
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    if (chunkId === 'data') { dataStart = pos + 8; break; }
    pos += 8 + buffer.readUInt32LE(pos + 4);
  }

  const dataEnd = Math.min(dataStart + parsed.dataSize, buffer.length);
  const dataLen = dataEnd - dataStart;
  if (dataLen < 4) return { peak: 0, windows: [] };

  const windowBytes = Math.min(
    parsed.sampleRate * parsed.numChannels * 2,
    Math.floor(dataLen / 4)
  );

  const halfSecBytes = Math.floor(parsed.sampleRate * parsed.numChannels * 0.5) * 2;
  const windowDefs = [
    { label: 'start', offset: dataStart + halfSecBytes },
    { label: 'middle', offset: dataStart + Math.floor(dataLen / 2) },
    { label: 'end', offset: dataEnd - windowBytes },
  ];

  let overallPeak = 0;
  const windowResults = [];
  for (const { label, offset } of windowDefs) {
    let winPeak = 0;
    const winEnd = Math.min(offset + windowBytes, dataEnd);
    for (let i = offset; i + 1 < winEnd; i += 2) {
      const sample = Math.abs(buffer.readInt16LE(i));
      if (sample > winPeak) winPeak = sample;
    }
    if (winPeak > overallPeak) overallPeak = winPeak;
    windowResults.push({ label, peak: winPeak });
  }

  return { peak: overallPeak, windows: windowResults };
}

function extractWavChunk(filePath, startSec, endSec) {
  const buffer = fs.readFileSync(filePath);
  const startByte = WAV_HEADER_BYTES + Math.floor(startSec * SAMPLE_RATE * BYTES_PER_SAMPLE);
  const endByte = WAV_HEADER_BYTES + Math.floor(endSec * SAMPLE_RATE * BYTES_PER_SAMPLE);
  const audioData = buffer.slice(startByte, Math.min(endByte, buffer.length));

  // Build a valid WAV header for the chunk
  const dataSize = audioData.length;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM
  header.writeUInt16LE(1, 20);           // PCM format
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);          // 16-bit
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, audioData]).toString('base64');
}

// ── Speech-to-Text v2 (fastest: sync recognize + chirp_3) ──────────────────────
// https://cloud.google.com/speech-to-text/v2/docs/reference/rest/v2/projects.locations.recognizers/recognize

async function recognizeChunkV2(base64Audio, apiKey, projectId) {
  const recognizer = `projects/${encodeURIComponent(projectId)}/locations/global/recognizers/_`;
  const url = `https://speech.googleapis.com/v2/${recognizer}:recognize?key=${apiKey}`;

  const body = {
    config: {
      explicitDecodingConfig: {
        encoding: 'LINEAR16',
        sampleRateHertz: SAMPLE_RATE,
        audioChannelCount: 1,
      },
      model: 'chirp_3',
      languageCodes: ['en-US'],
      features: {
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
        diarizationConfig: {},
      },
    },
    content: base64Audio,
  };

  const response = await httpsPost(url, body);

  if (response.error) {
    throw new Error(`Speech-to-Text v2 error: ${response.error.message}`);
  }

  return response;
}

// ── GCS upload (for v2 BatchRecognize; BatchRecognize only accepts gs:// URIs) ─

function normalizeKeyPath(keyFilePath) {
  if (!keyFilePath || !keyFilePath.trim()) return null;
  const s = keyFilePath.trim().replace(/^["']|["']$/g, '');
  return s ? path.resolve(s) : null;
}

async function convertWavToFlac(wavPath) {
  const ffmpegPath = validateFfmpegExists();
  const dir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  const flacPath = path.join(dir, `${base}.flac`);

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-y',
      '-i',
      wavPath,
      '-vn',
      '-acodec',
      'flac',
      flacPath,
    ];

    logger.info('Converting wav to flac for GCS', { wavPath, flacPath });
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(flacPath)) {
        logger.info('Wav→flac conversion complete', { flacPath });
        resolve(flacPath);
      } else {
        reject(
          new Error(
            `FFmpeg wav→flac failed (code ${code}): ${stderr.slice(-500)}`
          )
        );
      }
    });
    proc.on('error', (err) => reject(err));
    setTimeout(() => {
      if (!proc.killed) proc.kill();
    }, 120000);
  });
}

async function uploadWavToGcs(wavFilePath, bucketName, keyFilePath) {
  const { Storage } = require('@google-cloud/storage');
  const keyPath = normalizeKeyPath(keyFilePath);
  const options = keyPath ? { keyFilename: keyPath } : {};
  const storage = new Storage(options);
  const bucket = storage.bucket(bucketName.trim());
  const objectName = `${GCS_TEMP_PREFIX}transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.flac`;
  const gsUri = `gs://${bucketName.trim()}/${objectName}`;
  const flacPath = await convertWavToFlac(wavFilePath);

  logger.info('GCS upload started', {
    bucket: bucketName.trim(),
    objectName,
    wavFilePath,
    flacPath,
  });
  try {
    await bucket.upload(flacPath, {
      destination: objectName,
      metadata: { contentType: 'audio/flac' },
    });
    logger.info('GCS upload completed', { gsUri });
  } finally {
    fs.unlink(flacPath, () => { });
  }
  return gsUri;
}

async function deleteGcsObject(gsUri, keyFilePath) {
  try {
    const { Storage } = require('@google-cloud/storage');
    const match = gsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return;
    const [, bucketName, objectName] = match;
    const keyPath = normalizeKeyPath(keyFilePath);
    const options = keyPath ? { keyFilename: keyPath } : {};
    const storage = new Storage(options);
    await storage.bucket(bucketName).file(objectName).delete();
  } catch (err) {
    logger.warn('Failed to delete temp GCS object', { gsUri, error: err.message });
  }
}

// ── Speech-to-Text v2 BatchRecognize (long audio, no chunking) ─────────────────
// https://cloud.google.com/speech-to-text/v2/docs/batch-recognize
// Note: v2 does NOT support API key auth; a Bearer token from the service account is required.

// chirp_3 is available in `us` multi-region.
const STT_V2_LOCATION = 'us';
const STT_V2_ENDPOINT = `https://${STT_V2_LOCATION}-speech.googleapis.com`;

async function batchRecognizeV2(projectId, accessToken, gcsUri) {
  const recognizer = `projects/${encodeURIComponent(projectId)}/locations/${STT_V2_LOCATION}/recognizers/_`;
  const url = `${STT_V2_ENDPOINT}/v2/${recognizer}:batchRecognize`;

  const body = {
    config: {
      autoDecodingConfig: {},
      model: 'chirp_3',
      languageCodes: ['en-US'],
      features: {
        enableWordTimeOffsets: false, // Disabling because it enforces a 20-minute max on BatchRecognize
        enableAutomaticPunctuation: true,
        diarizationConfig: {
          minSpeakerCount: 2,
          maxSpeakerCount: 6,
        },
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: {
      inlineResponseConfig: {},
    },
  };

  const response = await httpsPost(url, body, { Authorization: `Bearer ${accessToken}` });
  if (response.error) {
    throw new Error(`Speech-to-Text v2 BatchRecognize error: ${response.error.message}`);
  }
  if (!response.name) {
    throw new Error('No operation name returned from BatchRecognize');
  }
  return response.name;
}

async function pollOperationV2(operationName, accessToken, maxAttempts = 120) {
  const pollUrl = `${STT_V2_ENDPOINT}/v2/${operationName}`;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(3000);
    const result = await httpsGet(pollUrl, { Authorization: `Bearer ${accessToken}` });
    if (result.error) {
      throw new Error(`BatchRecognize operation error: ${result.error.message}`);
    }
    if (result.done) {
      logger.info('BatchRecognize operation completed', { operationName, attempt });
      return result.response;
    }
    logger.debug('BatchRecognize operation still running', { attempt, operationName });
  }
  throw new Error('BatchRecognize operation timed out');
}

// ── Speech-to-Text v1 (long-running, fallback when no project ID) ──────────────

async function recognizeChunkV1(base64Audio, apiKey) {
  const url = `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`;

  const body = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: SAMPLE_RATE,
      languageCode: 'en-US',
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: true,
      model: 'latest_long',
      diarizationConfig: {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
      },
    },
    audio: { content: base64Audio },
  };

  const response = await httpsPost(url, body);

  if (response.error) {
    throw new Error(`STT API error: ${response.error.message}`);
  }

  const operationName = response.name;
  if (!operationName) {
    throw new Error('No operation name returned from STT API');
  }

  return pollOperation(operationName, apiKey);
}

async function pollOperation(operationName, apiKey, maxAttempts = 60) {
  const pollUrl = `https://speech.googleapis.com/v1/operations/${operationName}?key=${apiKey}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(5000);

    const result = await httpsGet(pollUrl);

    if (result.error) {
      throw new Error(`STT operation error: ${result.error.message}`);
    }

    if (result.done) {
      return result.response;
    }

    logger.debug('STT operation still running', { attempt, operationName });
  }

  throw new Error('STT operation timed out after 5 minutes');
}

// ── Parse STT response → structured transcript ────────────────────────────────
// Supports both v1 (startTime/endTime, speakerTag) and v2 (startOffset/endOffset, speakerLabel).

function parseTranscriptResponse(response, timeOffsetSeconds = 0) {
  const results = response?.results || [];
  const segments = [];

  for (const result of results) {
    const alternative = result?.alternatives?.[0];
    if (!alternative) continue;

    const words = alternative.words || [];
    if (words.length === 0) {
      segments.push({
        speaker: 'Speaker 1',
        text: alternative.transcript || '',
        startTime: timeOffsetSeconds,
        endTime: timeOffsetSeconds,
      });
      continue;
    }

    let currentSpeaker = null;
    let currentWords = [];
    let segStartTime = timeOffsetSeconds;
    let segEndTime = timeOffsetSeconds;

    for (const word of words) {
      const rawTag = word.speakerTag ?? word.speakerLabel;
      const speaker = normalizeSpeakerLabel(rawTag);
      const wordStart = parseTimeOffset(word.startTime ?? word.startOffset) + timeOffsetSeconds;
      const wordEnd = parseTimeOffset(word.endTime ?? word.endOffset) + timeOffsetSeconds;

      if (currentSpeaker !== speaker && currentWords.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          text: currentWords.join(' '),
          startTime: segStartTime,
          endTime: segEndTime,
        });
        currentWords = [];
        segStartTime = wordStart;
      }

      currentSpeaker = speaker;
      currentWords.push(word.word);
      segEndTime = wordEnd;
      if (currentWords.length === 1) segStartTime = wordStart;
    }

    if (currentWords.length > 0) {
      segments.push({
        speaker: currentSpeaker,
        text: currentWords.join(' '),
        startTime: segStartTime,
        endTime: segEndTime,
      });
    }
  }

  return segments;
}

function parseTimeOffset(offset) {
  if (!offset) return 0;
  if (typeof offset === 'string') {
    return parseFloat(offset.replace('s', ''));
  }
  if (typeof offset === 'object') {
    return (parseInt(offset.seconds || 0)) + (offset.nanos || 0) / 1e9;
  }
  return 0;
}

function normalizeSpeakerLabel(tag) {
  if (tag == null) return 'Speaker 1';
  const n = parseInt(tag, 10);
  if (!Number.isNaN(n)) return `Speaker ${n}`;
  if (typeof tag === 'string' && /^\d+$/.test(tag.trim())) return `Speaker ${tag.trim()}`;
  return tag;
}

function mergeTranscriptSegments(segmentGroups) {
  // Merge overlapping chunks and deduplicate using time offsets
  const all = segmentGroups.flat();
  all.sort((a, b) => a.startTime - b.startTime);

  const merged = [];
  for (const seg of all) {
    const last = merged[merged.length - 1];
    // Skip if this segment starts before the last one ends (overlap region)
    if (last && seg.startTime < last.endTime - OVERLAP_SECONDS / 2) continue;
    merged.push(seg);
  }

  return merged;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function transcribeAudio(wavFilePath, apiKey, onProgress, projectId, gcsBucket, gcsKeyPath) {
  if (!apiKey) throw new Error('Google API key is required for transcription');
  if (!fs.existsSync(wavFilePath)) throw new Error(`Audio file not found: ${wavFilePath}`);

  const useV2 = Boolean(projectId && projectId.trim());
  const useBatch = useV2 && Boolean(gcsBucket && gcsBucket.trim());

  const stat = fs.statSync(wavFilePath);
  const durationSeconds = getWavDurationSeconds(wavFilePath);
  const ampResult = getWavPeakAmplitude(wavFilePath);
  const peakAmplitude = ampResult.peak;
  const isSilent = peakAmplitude < 200;

  logger.info('Starting transcription', {
    wavFilePath,
    durationSeconds,
    fileSizeBytes: stat.size,
    peakAmplitude,
    windows: ampResult.windows,
    sttApi: useBatch ? 'v2 (BatchRecognize)' : useV2 ? 'v2 (chirp_3)' : 'v1 (longrunning)',
  });

  if (isSilent) {
    const windowDetail = ampResult.windows.map((w) => `${w.label}=${w.peak}`).join(', ');
    logger.warn('Recording is silent (peak amplitude below threshold)', {
      peakAmplitude,
      windows: ampResult.windows,
      hint: [
        'Check Windows Settings → Privacy & security → Microphone → enable "Let desktop apps access your microphone".',
        'In Windows Sound → Recording → right-click your Microphone → Properties → Levels → set to 80–100 and unmute.',
        'If using headphones/USB/Bluetooth: select "WASAPI Loopback" in MeetMind Settings → Audio (Stereo Mix only captures from built-in speakers).',
        'Test by playing a YouTube video while recording for a few seconds.',
      ],
    });
    throw new Error(
      `The recording is completely silent (peak=${peakAmplitude}, per-section: ${windowDetail}). ` +
      'Likely causes: (1) Windows microphone privacy is blocking the app — go to Settings → Privacy & security → Microphone → enable "Let desktop apps access your microphone". ' +
      '(2) Microphone level is at 0 or muted — open Windows Sound → Recording → Microphone → Properties → Levels and set to 80+. ' +
      '(3) System audio device (Stereo Mix) only captures built-in speaker output — if using headphones, switch to "WASAPI Loopback" in MeetMind Settings → Audio.'
    );
  }

  onProgress?.(0);

  // v2 + GCS bucket: BatchRecognize (one request, no chunking)
  if (useBatch) {
    const keyPath = normalizeKeyPath(gcsKeyPath);
    if (!keyPath) throw new Error('A service account key file is required for v2 BatchRecognize (API keys are not supported by Speech-to-Text v2). Set "Service account key path" in Settings.');
    const accessToken = await getServiceAccountAccessToken(keyPath);
    const gcsUri = await uploadWavToGcs(wavFilePath, gcsBucket, gcsKeyPath);
    try {
      logger.info('BatchRecognize started', { gcsUri });
      const operationName = await batchRecognizeV2(projectId.trim(), accessToken, gcsUri);
      logger.info('BatchRecognize accepted, polling operation', { operationName });
      onProgress?.(0.2);
      const batchResponse = await pollOperationV2(operationName, accessToken);
      onProgress?.(1);
      logger.info('BatchRecognize full response', { responseString: JSON.stringify(batchResponse).substring(0, 2000) });
      const resultsMap = batchResponse?.results || {};
      const firstUri = Object.keys(resultsMap)[0];
      const fileResult = firstUri ? resultsMap[firstUri] : null;
      const transcript = fileResult?.inlineResult?.transcript;
      if (!transcript || !transcript.results) {
        throw new Error('BatchRecognize returned no transcript');
      }
      const parsed = parseTranscriptResponse(transcript);
      logger.info('BatchRecognize transcript parsed', { segmentCount: parsed?.length ?? 0 });
      return parsed;
    } finally {
      await deleteGcsObject(gcsUri, gcsKeyPath);
      logger.info('Temp GCS object deleted', { gcsUri });
    }
  }

  // v1: one longrunningrecognize. v2 without bucket: sync for short, chunk for long.
  const recognizeChunk = useV2
    ? (base64) => recognizeChunkV2(base64, apiKey, projectId.trim())
    : (base64) => recognizeChunkV1(base64, apiKey);

  const singleRequest =
    !useV2 ||
    durationSeconds <= V2_MAX_SYNC_SECONDS;

  if (singleRequest) {
    const base64 = fs.readFileSync(wavFilePath).toString('base64');
    const response = await recognizeChunk(base64);
    onProgress?.(1);
    return parseTranscriptResponse(response);
  }

  // v2 only (no bucket): audio > 1 min — chunk (sync recognize limit)
  const chunks = [];
  let start = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + CHUNK_DURATION_SECONDS, durationSeconds);
    chunks.push({ start, end });
    start += CHUNK_DURATION_SECONDS - OVERLAP_SECONDS;
  }

  logger.info('Splitting audio into chunks (v2 sync limit)', { chunkCount: chunks.length });

  const segmentGroups = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    const base64Chunk = extractWavChunk(wavFilePath, start, end);
    const response = await recognizeChunk(base64Chunk);
    segmentGroups.push(parseTranscriptResponse(response, start));
    onProgress?.((i + 1) / chunks.length);
  }

  return mergeTranscriptSegments(segmentGroups);
}

async function testGoogleSTT(apiKey) {
  // Minimal test: try to create a tiny silent WAV and send it
  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;
  const body = {
    config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'en-US' },
    audio: { content: '' },
  };
  const result = await httpsPost(url, body);
  if (result.error && result.error.code !== 400) {
    throw new Error(result.error.message);
  }
  // 400 is expected for empty content — means API key is valid and API is enabled
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  transcribeAudio,
  testGoogleSTT,
  getWavDurationSeconds,
};
