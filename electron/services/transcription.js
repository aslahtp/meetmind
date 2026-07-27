const fs = require('fs');
const https = require('https');
const path = require('path');
const { AssemblyAI } = require('assemblyai');
const logger = require('../utils/logger');

const SAMPLE_RATE = 16000;
// v2 sync recognize is limited to 1 min. When GCS bucket is set we use BatchRecognize (no chunking).
const V2_MAX_SYNC_SECONDS = 60;
const CHUNK_DURATION_SECONDS = 55;
const OVERLAP_SECONDS = 5;
// v1 longrunningrecognize inline limit: ~10 MB request body.
// 160 s * 16000 Hz * 2 bytes = 5.12 MB raw → ~6.8 MB base64 — safely under the limit.
const V1_MAX_INLINE_SECONDS = 160;
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

function httpsPut(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ?? Buffer.alloc(0);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      headers: {
        'Content-Length': payload.length,
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: responseBody });
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}: ${responseBody || res.statusMessage}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── AssemblyAI helpers ─────────────────────────────────────────────────────────

async function transcribeWithAssemblyAI(wavFilePath, apiKey, prompt, onProgress) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('AssemblyAI API key is required for transcription');
  }
  if (!fs.existsSync(wavFilePath)) {
    throw new Error(`Audio file not found: ${wavFilePath}`);
  }

  const client = new AssemblyAI({ apiKey: apiKey.trim() });

  onProgress?.(0);

  const options = {
    audio: wavFilePath,
    language_codes: ['en', 'ml'],
    speaker_labels: true,
    // Prefer highest-accuracy multilingual models and fall back automatically.
    speech_models: ['universal-3-pro', 'universal-2'],
  };

  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    options.prompt = prompt.trim();
  }

  const transcript = await client.transcripts.transcribe(options);

  onProgress?.(1);

  const segments = [];

  if (Array.isArray(transcript.utterances) && transcript.utterances.length > 0) {
    for (const utt of transcript.utterances) {
      const startSec = typeof utt.start === 'number' ? utt.start / 1000 : 0;
      const endSec = typeof utt.end === 'number' ? utt.end / 1000 : startSec;
      const speakerLabel = utt.speaker != null ? String(utt.speaker) : '1';
      const speaker =
        /^\d+$/.test(speakerLabel.trim()) ? `Speaker ${speakerLabel.trim()}` : speakerLabel;

      segments.push({
        speaker,
        text: utt.text || '',
        startTime: startSec,
        endTime: endSec,
      });
    }
  } else if (transcript.text) {
    // Fallback: no utterances/speaker labels, but we still have text.
    segments.push({
      speaker: 'Speaker 1',
      text: transcript.text,
      startTime: 0,
      endTime: getWavDurationSeconds(wavFilePath) || 0,
    });
  }

  if (!segments.length) {
    throw new Error('No speech detected in the recording (AssemblyAI returned an empty transcript).');
  }

  return segments;
}

async function testAssemblyAI(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('AssemblyAI API key is required');
  }
  const url = 'https://api.assemblyai.com/v2/account';
  const result = await httpsGet(url, { Authorization: apiKey.trim() });
  if (result && result.error) {
    throw new Error(result.error);
  }
}

// ── Sarvam AI helpers ────────────────────────────────────────────────────────

const SARVAM_API_BASE = 'https://api.sarvam.ai';
const SARVAM_POLL_INTERVAL_MS = 5000;
const SARVAM_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function sarvamHeaders(apiKey) {
  return { 'api-subscription-key': apiKey.trim() };
}

function throwIfSarvamError(result, fallbackMessage) {
  if (!result || typeof result !== 'object') return;
  if (result.error) {
    const message = result.error.message || result.error.code || fallbackMessage;
    throw new Error(message);
  }
}

async function sarvamPost(path, apiKey, body) {
  const result = await httpsPost(
    `${SARVAM_API_BASE}${path}`,
    body,
    { ...sarvamHeaders(apiKey), 'Content-Type': 'application/json' }
  );
  throwIfSarvamError(result, 'Sarvam AI request failed');
  return result;
}

async function sarvamGet(path, apiKey) {
  const result = await httpsGet(`${SARVAM_API_BASE}${path}`, sarvamHeaders(apiKey));
  throwIfSarvamError(result, 'Sarvam AI request failed');
  return result;
}

function formatSarvamSpeaker(speakerId) {
  const raw = speakerId != null ? String(speakerId).trim() : '0';
  if (/^\d+$/.test(raw)) {
    return `Speaker ${Number(raw) + 1}`;
  }
  return raw;
}

function parseSarvamTranscriptResponse(response, durationFallback = 0) {
  const segments = [];

  if (Array.isArray(response?.diarized_transcript?.entries) && response.diarized_transcript.entries.length > 0) {
    for (const entry of response.diarized_transcript.entries) {
      const text = entry.transcript || '';
      if (!text.trim()) continue;
      segments.push({
        speaker: formatSarvamSpeaker(entry.speaker_id),
        text,
        startTime: typeof entry.start_time_seconds === 'number' ? entry.start_time_seconds : 0,
        endTime: typeof entry.end_time_seconds === 'number' ? entry.end_time_seconds : durationFallback,
      });
    }
  } else if (Array.isArray(response?.timestamps?.chunks) && response.timestamps.chunks.length > 0) {
    const starts = response.timestamps.start_time_seconds || [];
    const ends = response.timestamps.end_time_seconds || [];
    for (let i = 0; i < response.timestamps.chunks.length; i++) {
      const text = response.timestamps.chunks[i] || '';
      if (!text.trim()) continue;
      segments.push({
        speaker: 'Speaker 1',
        text,
        startTime: typeof starts[i] === 'number' ? starts[i] : 0,
        endTime: typeof ends[i] === 'number' ? ends[i] : durationFallback,
      });
    }
  } else if (response?.transcript?.trim()) {
    segments.push({
      speaker: 'Speaker 1',
      text: response.transcript.trim(),
      startTime: 0,
      endTime: durationFallback,
    });
  }

  return segments;
}

async function pollSarvamJob(jobId, apiKey, onProgress) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SARVAM_POLL_TIMEOUT_MS) {
    const status = await sarvamGet(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/status`, apiKey);
    const jobState = status.job_state;

    if (jobState === 'Completed' || jobState === 'PartiallyCompleted') {
      onProgress?.(0.95);
      return status;
    }
    if (jobState === 'Failed') {
      throw new Error(status.error_message || 'Sarvam AI transcription job failed');
    }

    const elapsed = Date.now() - startedAt;
    onProgress?.(0.3 + Math.min(0.6, elapsed / SARVAM_POLL_TIMEOUT_MS * 0.6));
    await sleep(SARVAM_POLL_INTERVAL_MS);
  }

  throw new Error('Sarvam AI transcription timed out after 30 minutes');
}

async function downloadSarvamJobResult(jobId, apiKey, status) {
  const outputFiles = [];
  for (const task of status.job_details || []) {
    for (const output of task.outputs || []) {
      if (output?.file_name) outputFiles.push(output.file_name);
    }
  }

  if (!outputFiles.length) {
    throw new Error('Sarvam AI returned no transcript output files');
  }

  const downloadResponse = await sarvamPost('/speech-to-text/job/v1/download-files', apiKey, {
    job_id: jobId,
    files: outputFiles,
  });

  const downloadUrls = downloadResponse.download_urls || {};
  const firstFile = outputFiles.find((name) => downloadUrls[name]?.file_url);
  if (!firstFile) {
    throw new Error('Sarvam AI did not return a download URL for the transcript');
  }

  return httpsGet(downloadUrls[firstFile].file_url);
}

async function transcribeWithSarvam(wavFilePath, apiKey, onProgress) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Sarvam AI API key is required for transcription');
  }
  if (!fs.existsSync(wavFilePath)) {
    throw new Error(`Audio file not found: ${wavFilePath}`);
  }

  const trimmedKey = apiKey.trim();
  const durationSeconds = getWavDurationSeconds(wavFilePath) || 0;
  const fileName = path.basename(wavFilePath);
  const audioBuffer = fs.readFileSync(wavFilePath);

  onProgress?.(0);

  const createResponse = await sarvamPost('/speech-to-text/job/v1', trimmedKey, {
    job_parameters: {
      model: 'saaras:v3',
      mode: 'codemix',
      language_code: 'unknown',
      with_timestamps: true,
      with_diarization: true,
    },
  });

  const jobId = createResponse.job_id;
  if (!jobId) {
    throw new Error('Sarvam AI did not return a job ID');
  }

  onProgress?.(0.1);

  const uploadResponse = await sarvamPost('/speech-to-text/job/v1/upload-files', trimmedKey, {
    job_id: jobId,
    files: [fileName],
  });

  const uploadDetails = uploadResponse.upload_urls?.[fileName];
  if (!uploadDetails?.file_url) {
    throw new Error(`Sarvam AI did not return an upload URL for ${fileName}`);
  }

  const uploadHeaders = { 'Content-Type': 'audio/wav' };
  const storageType = uploadResponse.storage_container_type || createResponse.storage_container_type;
  if (storageType === 'Azure' || storageType === 'Azure_V1') {
    uploadHeaders['x-ms-blob-type'] = 'BlockBlob';
  }

  await httpsPut(uploadDetails.file_url, audioBuffer, uploadHeaders);
  onProgress?.(0.2);

  await sarvamPost(`/speech-to-text/job/v1/${encodeURIComponent(jobId)}/start`, trimmedKey, {});
  onProgress?.(0.3);

  const status = await pollSarvamJob(jobId, trimmedKey, onProgress);
  const result = await downloadSarvamJobResult(jobId, trimmedKey, status);
  const segments = parseSarvamTranscriptResponse(result, durationSeconds);

  if (!segments.length) {
    throw new Error('No speech detected in the recording (Sarvam AI returned an empty transcript).');
  }

  onProgress?.(1);
  logger.info('Sarvam AI transcription complete', {
    jobId,
    segmentCount: segments.length,
    languageCode: result?.language_code,
  });

  return segments;
}

async function testSarvam(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Sarvam AI API key is required');
  }

  const result = await httpsPost(
    `${SARVAM_API_BASE}/translate`,
    {
      input: 'Hello',
      source_language_code: 'auto',
      target_language_code: 'ml-IN',
      speaker_gender: 'Male',
    },
    { ...sarvamHeaders(apiKey), 'Content-Type': 'application/json' }
  );
  throwIfSarvamError(result, 'Invalid Sarvam AI API key');
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
      // Each chunk is a full WAV file (with RIFF/fmt/data headers), so
      // autoDecodingConfig correctly reads the format instead of relying on
      // hardcoded values that could mismatch and cause hallucinations.
      autoDecodingConfig: {},
      model: 'chirp_3',
      languageCodes: ['en-US', 'ml-IN'],
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

async function uploadWavToGcs(wavFilePath, bucketName, keyFilePath) {
  const { Storage } = require('@google-cloud/storage');
  const keyPath = normalizeKeyPath(keyFilePath);
  const options = keyPath ? { keyFilename: keyPath } : {};
  const storage = new Storage(options);
  const bucket = storage.bucket(bucketName.trim());
  const objectName = `${GCS_TEMP_PREFIX}transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`;
  const gsUri = `gs://${bucketName.trim()}/${objectName}`;

  logger.info('GCS upload started (WAV/LINEAR16)', {
    bucket: bucketName.trim(),
    objectName,
    wavFilePath,
  });
  await bucket.upload(wavFilePath, {
    destination: objectName,
    metadata: { contentType: 'audio/wav' },
  });
  logger.info('GCS upload completed', { gsUri });
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

// BatchRecognize enforces a 20-minute limit when enableWordTimeOffsets is true.
const BATCH_WORD_OFFSET_MAX_SECONDS = 20 * 60;

async function batchRecognizeV2(projectId, accessToken, gcsUri, enableWordOffsets) {
  const recognizer = `projects/${encodeURIComponent(projectId)}/locations/${STT_V2_LOCATION}/recognizers/_`;
  const url = `${STT_V2_ENDPOINT}/v2/${recognizer}:batchRecognize`;

  const body = {
    config: {
      // WAV is a self-describing container (headers carry sample rate, channels,
      // encoding). autoDecodingConfig lets the API read the WAV headers directly
      // rather than trusting a hardcoded declaration, which avoids hallucinations
      // caused by any mismatch between declared and actual audio properties.
      autoDecodingConfig: {},
      model: 'chirp_3',
      languageCodes: ['en-US', 'ml-IN'],
      features: {
        // Word offsets allow proper speaker-turn segmentation but enforce a
        // 20-minute file limit. For longer recordings we disable them and rely
        // on the sentence-splitter in parseTranscriptResponse instead.
        enableWordTimeOffsets: enableWordOffsets,
        enableAutomaticPunctuation: true,
        // diarizationConfig is not supported by chirp_3 BatchRecognize
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

async function pollOperationV2(operationName, accessToken, maxAttempts = 300) {
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
  throw new Error('BatchRecognize operation timed out after 15 minutes');
}

// ── Speech-to-Text v1 (long-running, fallback when no project ID) ──────────────

async function recognizeChunkV1(base64Audio, apiKey) {
  const url = `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`;

  const body = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: SAMPLE_RATE,
      languageCode: 'en-US',
      alternativeLanguageCodes: ['ml-IN'],
      enableWordTimeOffsets: false,
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

async function pollOperation(operationName, apiKey, maxAttempts = 180) {
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

  throw new Error('STT operation timed out after 15 minutes');
}

// ── Parse STT response → structured transcript ────────────────────────────────
// Supports both v1 (startTime/endTime, speakerTag) and v2 (startOffset/endOffset, speakerLabel).

/**
 * When a result has no word-level timestamps (e.g. BatchRecognize returned a
 * plain transcript blob), split the text into sentence-sized segments and
 * distribute timestamps proportionally to character count.
 * Handles both Latin punctuation (. ? !) and the Indic danda (।).
 */
function splitTextIntoSegments(text, startTime, endTime) {
  const MAX_CHARS = 280;
  if (!text) return [];
  if (text.length <= MAX_CHARS) {
    return [{ speaker: 'Speaker 1', text, startTime, endTime }];
  }

  const secPerChar = (endTime - startTime) / Math.max(text.length, 1);
  // Split after sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.?!।])\s+/u).filter(Boolean);

  const segments = [];
  let buffer = '';
  let bufferCharStart = 0;
  let charPos = 0;

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer && candidate.length > MAX_CHARS) {
      segments.push({
        speaker: 'Speaker 1',
        text: buffer.trim(),
        startTime: startTime + bufferCharStart * secPerChar,
        endTime: startTime + charPos * secPerChar,
      });
      bufferCharStart = charPos;
      buffer = sentence;
    } else {
      buffer = candidate;
    }
    charPos += sentence.length + 1; // +1 for the space/split char
  }
  if (buffer) {
    segments.push({
      speaker: 'Speaker 1',
      text: buffer.trim(),
      startTime: startTime + bufferCharStart * secPerChar,
      endTime,
    });
  }
  return segments.length ? segments : [{ speaker: 'Speaker 1', text, startTime, endTime }];
}

function parseTranscriptResponse(response, timeOffsetSeconds = 0) {
  const results = response?.results || [];
  const segments = [];

  for (const result of results) {
    const alternative = result?.alternatives?.[0];
    if (!alternative) continue;

    const words = alternative.words || [];
    if (words.length === 0) {
      // No word timestamps — split by sentence so the transcript viewer shows
      // multiple readable segments instead of one giant blob.
      const text = alternative.transcript || '';
      segments.push(...splitTextIntoSegments(text, timeOffsetSeconds, timeOffsetSeconds));
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

async function transcribeAudio(
  wavFilePath,
  apiKey,
  onProgress,
  projectId,
  gcsBucket,
  gcsKeyPath,
  sttService = 'google',
  assemblyAiApiKey = '',
  assemblyAiPrompt = '',
  sarvamApiKey = ''
) {
  const useAssemblyAI = sttService === 'assemblyai';
  const useSarvam = sttService === 'sarvam';

  if (!useAssemblyAI && !useSarvam && !apiKey) {
    throw new Error('Google API key is required for transcription');
  }
  if (!fs.existsSync(wavFilePath)) {
    throw new Error(`Audio file not found: ${wavFilePath}`);
  }

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
    sttApi: useSarvam
      ? 'sarvam (saaras:v3 codemix, auto-detect)'
      : useAssemblyAI
      ? 'assemblyai'
      : (useBatch ? 'v2 (BatchRecognize)' : useV2 ? 'v2 (chirp_3)' : 'v1 (longrunning)'),
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

  if (useSarvam) {
    logger.info('Using Sarvam AI for transcription', {
      wavFilePath,
      durationSeconds,
      mode: 'codemix',
      languageCode: 'unknown',
    });
    return transcribeWithSarvam(wavFilePath, sarvamApiKey, onProgress);
  }

  // AssemblyAI path: use a single call with automatic language detection and speaker labels.
  if (useAssemblyAI) {
    logger.info('Using AssemblyAI for transcription', {
      wavFilePath,
      durationSeconds,
    });
    return transcribeWithAssemblyAI(wavFilePath, assemblyAiApiKey, assemblyAiPrompt, onProgress);
  }

  // v2 + GCS bucket: BatchRecognize (one request, no chunking)
  if (useBatch) {
    const keyPath = normalizeKeyPath(gcsKeyPath);
    if (!keyPath) throw new Error('A service account key file is required for v2 BatchRecognize (API keys are not supported by Speech-to-Text v2). Set "Service account key path" in Settings.');
    const accessToken = await getServiceAccountAccessToken(keyPath);
    const gcsUri = await uploadWavToGcs(wavFilePath, gcsBucket, gcsKeyPath);

    // Word-level timestamps are only supported by BatchRecognize for files ≤ 20 min.
    // For longer recordings we disable them and the sentence-splitter handles display.
    const enableWordOffsets = durationSeconds <= BATCH_WORD_OFFSET_MAX_SECONDS;
    logger.info('BatchRecognize started', { gcsUri, enableWordOffsets, durationSeconds: Math.round(durationSeconds) });

    try {
      const operationName = await batchRecognizeV2(projectId.trim(), accessToken, gcsUri, enableWordOffsets);
      logger.info('BatchRecognize accepted, polling operation', { operationName });
      onProgress?.(0.2);
      const batchResponse = await pollOperationV2(operationName, accessToken);
      onProgress?.(1);
      logger.info('BatchRecognize full response', { responseString: JSON.stringify(batchResponse).substring(0, 2000) });
      const resultsMap = batchResponse?.results || {};
      const firstUri = Object.keys(resultsMap)[0];
      const fileResult = firstUri ? resultsMap[firstUri] : null;

      // Surface per-file errors returned inside the results map
      if (fileResult?.error) {
        throw new Error(`BatchRecognize file error: ${fileResult.error.message}`);
      }

      const transcript = fileResult?.inlineResult?.transcript ?? fileResult?.transcript;
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

  // v1 inline limit: ~10 MB request body (~160 s of 16 kHz mono 16-bit WAV).
  // v2 sync limit: 60 s per request.
  // Both paths chunk when the audio exceeds the respective limit.
  const maxSingleSecs = useV2 ? V2_MAX_SYNC_SECONDS : V1_MAX_INLINE_SECONDS;
  const singleRequest = durationSeconds <= maxSingleSecs;

  if (singleRequest) {
    const base64 = fs.readFileSync(wavFilePath).toString('base64');
    const response = await recognizeChunk(base64);
    onProgress?.(1);
    return parseTranscriptResponse(response);
  }

  // Both v1 and v2 (no bucket): chunk into CHUNK_DURATION_SECONDS slices.
  // v1 uses longrunningrecognize per chunk; v2 uses chirp_3 sync recognize per chunk.
  const chunks = [];
  let start = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + CHUNK_DURATION_SECONDS, durationSeconds);
    chunks.push({ start, end });
    start += CHUNK_DURATION_SECONDS - OVERLAP_SECONDS;
  }

  logger.info('Splitting audio into chunks', { chunkCount: chunks.length, useV2 });

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
  testAssemblyAI,
  testSarvam,
};
