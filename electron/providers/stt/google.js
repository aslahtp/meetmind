const fs = require('fs');
const path = require('path');
const logger = require('../shared/log');
const { httpsPost, httpsGet, sleep } = require('../shared/http');
const {
  SAMPLE_RATE,
  getWavDurationSeconds,
  extractWavChunk,
  planChunks,
  mergeTranscriptSegments,
} = require('../shared/wav');

// v2 sync recognize is limited to 1 min. When a GCS bucket is set we use BatchRecognize (no chunking).
const V2_MAX_SYNC_SECONDS = 60;
const CHUNK_DURATION_SECONDS = 55;
const OVERLAP_SECONDS = 5;
// v1 longrunningrecognize inline limit: ~10 MB request body.
// 160 s * 16000 Hz * 2 bytes = 5.12 MB raw → ~6.8 MB base64 — safely under the limit.
const V1_MAX_INLINE_SECONDS = 160;
const GCS_TEMP_PREFIX = 'meetmind-temp/';
const V1_MODEL = 'latest_long';

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

// ── Speech-to-Text v2 (fastest: sync recognize + chirp_3) ──────────────────────
// https://cloud.google.com/speech-to-text/v2/docs/reference/rest/v2/projects.locations.recognizers/recognize

async function recognizeChunkV2(base64Audio, apiKey, projectId, model) {
  const recognizer = `projects/${encodeURIComponent(projectId)}/locations/global/recognizers/_`;
  const url = `https://speech.googleapis.com/v2/${recognizer}:recognize?key=${apiKey}`;

  const body = {
    config: {
      // Each chunk is a full WAV file (with RIFF/fmt/data headers), so
      // autoDecodingConfig correctly reads the format instead of relying on
      // hardcoded values that could mismatch and cause hallucinations.
      autoDecodingConfig: {},
      model,
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

async function batchRecognizeV2(projectId, accessToken, gcsUri, enableWordOffsets, model) {
  const recognizer = `projects/${encodeURIComponent(projectId)}/locations/${STT_V2_LOCATION}/recognizers/_`;
  const url = `${STT_V2_ENDPOINT}/v2/${recognizer}:batchRecognize`;

  const body = {
    config: {
      // WAV is a self-describing container (headers carry sample rate, channels,
      // encoding). autoDecodingConfig lets the API read the WAV headers directly
      // rather than trusting a hardcoded declaration, which avoids hallucinations
      // caused by any mismatch between declared and actual audio properties.
      autoDecodingConfig: {},
      model,
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
      model: V1_MODEL,
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

// ── Provider ──────────────────────────────────────────────────────────────────

async function transcribe({ wavPath, model, config, onProgress }) {
  const apiKey = config.googleApiKey;
  const projectId = (config.googleCloudProjectId || '').trim();
  const gcsBucket = (config.googleCloudStorageBucket || '').trim();
  const gcsKeyPath = config.googleCloudStorageKeyPath;

  if (!apiKey) throw new Error('Google API key is required for transcription');
  if (!fs.existsSync(wavPath)) throw new Error(`Audio file not found: ${wavPath}`);

  // "latest_long" always means Speech-to-Text v1; other models use v2 when a project ID is set.
  const useV2 = Boolean(projectId) && model !== V1_MODEL;
  const useBatch = useV2 && Boolean(gcsBucket);
  const v2Model = model === V1_MODEL ? 'chirp_3' : model;
  const durationSeconds = getWavDurationSeconds(wavPath);

  logger.info('Google STT', {
    api: useBatch ? 'v2 (BatchRecognize)' : useV2 ? `v2 (${v2Model})` : 'v1 (longrunning)',
  });

  // v2 + GCS bucket: BatchRecognize (one request, no chunking)
  if (useBatch) {
    const keyPath = normalizeKeyPath(gcsKeyPath);
    if (!keyPath) throw new Error('A service account key file is required for v2 BatchRecognize (API keys are not supported by Speech-to-Text v2). Set "Service account key path" in Settings.');
    const accessToken = await getServiceAccountAccessToken(keyPath);
    const gcsUri = await uploadWavToGcs(wavPath, gcsBucket, gcsKeyPath);

    // Word-level timestamps are only supported by BatchRecognize for files ≤ 20 min.
    // For longer recordings we disable them and the sentence-splitter handles display.
    const enableWordOffsets = durationSeconds <= BATCH_WORD_OFFSET_MAX_SECONDS;
    logger.info('BatchRecognize started', { gcsUri, enableWordOffsets, durationSeconds: Math.round(durationSeconds) });

    try {
      const operationName = await batchRecognizeV2(projectId, accessToken, gcsUri, enableWordOffsets, v2Model);
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
    ? (base64) => recognizeChunkV2(base64, apiKey, projectId, v2Model)
    : (base64) => recognizeChunkV1(base64, apiKey);

  const maxSingleSecs = useV2 ? V2_MAX_SYNC_SECONDS : V1_MAX_INLINE_SECONDS;

  if (durationSeconds <= maxSingleSecs) {
    const base64 = fs.readFileSync(wavPath).toString('base64');
    const response = await recognizeChunk(base64);
    onProgress?.(1);
    return parseTranscriptResponse(response);
  }

  const chunks = planChunks(durationSeconds, CHUNK_DURATION_SECONDS, OVERLAP_SECONDS);
  logger.info('Splitting audio into chunks', { chunkCount: chunks.length, useV2 });

  const segmentGroups = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    const response = await recognizeChunk(extractWavChunk(wavPath, start, end));
    segmentGroups.push(parseTranscriptResponse(response, start));
    onProgress?.((i + 1) / chunks.length);
  }

  return mergeTranscriptSegments(segmentGroups, OVERLAP_SECONDS);
}

async function test({ config }) {
  // Minimal test: an empty recognize request. 400 means the key is valid and the API is enabled.
  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${config.googleApiKey}`;
  const body = {
    config: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, languageCode: 'en-US' },
    audio: { content: '' },
  };
  const result = await httpsPost(url, body);
  if (result.error && result.error.code !== 400) {
    throw new Error(result.error.message);
  }
}

module.exports = {
  id: 'google',
  name: 'Google Cloud STT',
  badge: 'Chirp 3',
  icon: 'google-cloud',
  pricing: 'Free tier available (60 mins/mo), then ~$0.016/min',
  description:
    'High accuracy with speaker diarization. Supports English and Malayalam (ml-IN) with code-switching. Best overall for multilingual meetings.',
  credentials: [
    {
      configKey: 'googleApiKey',
      label: 'Google Cloud STT API key',
      type: 'password',
      placeholder: 'AIzaSy...',
      hint: 'You can use the same Google AI Studio / Gemini API key for Google STT.',
      link: { href: 'https://aistudio.google.com/app/apikey', label: 'Get API key' },
      required: true,
    },
    {
      configKey: 'googleCloudProjectId',
      label: 'Google Cloud project ID (optional)',
      type: 'text',
      placeholder: 'my-project-123',
      hint: 'Enables Speech-to-Text v2 (Chirp 3). Leave empty to use v1.',
    },
    {
      configKey: 'googleCloudStorageBucket',
      label: 'Cloud Storage bucket (optional)',
      type: 'text',
      placeholder: 'my-bucket',
      hint: 'With a project ID, enables BatchRecognize for long recordings (no chunking).',
    },
    {
      configKey: 'googleCloudStorageKeyPath',
      label: 'Service account key path (optional)',
      type: 'text',
      placeholder: 'C:\\keys\\service-account.json',
      hint: 'Required for BatchRecognize; v2 does not accept API keys.',
    },
  ],
  guide: [
    { text: 'Go to Google AI Studio', url: 'https://aistudio.google.com/app/apikey' },
    { text: 'Click "Get API Key" → "Create API Key"' },
    { text: 'Copy the key and paste it into both the Google Cloud STT and Gemini fields' },
    { text: '(Optional) For Cloud STT v2, enable the Cloud Speech-to-Text API in Google Cloud Console', url: 'https://console.cloud.google.com/apis/library/speech.googleapis.com' },
  ],
  models: [
    { id: 'chirp_3', name: 'Chirp 3', badge: 'Default', description: 'Speech-to-Text v2 when a project ID is set; falls back to v1 otherwise.' },
    { id: V1_MODEL, name: 'Latest Long', badge: 'v1', description: 'Speech-to-Text v1 with diarization. Works with just an API key.' },
  ],
  defaultModel: 'chirp_3',
  allowCustomModel: false,
  capabilities: { diarization: true, languages: ['en', 'ml'] },
  transcribe,
  test,
};
