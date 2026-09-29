const fs = require('fs');
const logger = require('../shared/log');
const { fetchJson, sleep } = require('../shared/http');
const {
  getWavDurationSeconds,
  extractWavChunkBuffer,
  planChunks,
  mergeTranscriptSegments,
} = require('../shared/wav');

const GROQ_BASE = 'https://api.groq.com/openai/v1';
// Groq's upload cap is 25 MB on the free tier. 16 kHz mono 16-bit WAV is ~1.92 MB/min,
// so 10-minute windows (~19 MB) stay safely under it.
const CHUNK_SECONDS = 10 * 60;
const OVERLAP_SECONDS = 2;
const MAX_RETRIES = 3;

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey.trim()}` };
}

/** Map Groq `verbose_json` segments to MeetMind segments, shifted by the chunk offset. */
function parseGroqSegments(response, offsetSeconds = 0) {
  const raw = Array.isArray(response?.segments) ? response.segments : [];
  const segments = [];
  for (const s of raw) {
    const text = String(s.text || '').trim();
    if (!text) continue;
    segments.push({
      speaker: 'Speaker 1',
      text,
      startTime: (Number(s.start) || 0) + offsetSeconds,
      endTime: (Number(s.end) || 0) + offsetSeconds,
    });
  }
  if (!segments.length && response?.text?.trim()) {
    segments.push({
      speaker: 'Speaker 1',
      text: response.text.trim(),
      startTime: offsetSeconds,
      endTime: offsetSeconds + (Number(response.duration) || 0),
    });
  }
  return segments;
}

async function transcribeChunk(audioBuffer, { apiKey, model, fetchImpl, sleepImpl }) {
  for (let attempt = 0; ; attempt++) {
    // FormData bodies are single-use, so rebuild on every attempt.
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('timestamp_granularities[]', 'segment');

    try {
      return await fetchJson(
        `${GROQ_BASE}/audio/transcriptions`,
        { method: 'POST', headers: authHeaders(apiKey), body: form },
        { label: 'Groq transcription', fetchImpl }
      );
    } catch (err) {
      if (err.status === 429 && attempt < MAX_RETRIES) {
        const waitMs = err.retryAfterMs || 5000 * (attempt + 1);
        logger.warn('Groq rate limited, retrying', { attempt: attempt + 1, waitMs });
        await sleepImpl(waitMs);
        continue;
      }
      if (err.status === 413) {
        throw new Error('Groq rejected the audio chunk as too large (25 MB free-tier limit).');
      }
      throw err;
    }
  }
}

async function transcribe({ wavPath, model, config, onProgress }, deps = {}) {
  const apiKey = config.groqApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required for transcription');
  if (!fs.existsSync(wavPath)) throw new Error(`Audio file not found: ${wavPath}`);

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const sleepImpl = deps.sleepImpl || sleep;
  const durationSeconds = deps.durationSeconds ?? getWavDurationSeconds(wavPath);
  const chunks = planChunks(durationSeconds, CHUNK_SECONDS, OVERLAP_SECONDS);
  const extract = deps.extractChunk || extractWavChunkBuffer;

  logger.info('Groq STT', { model, chunkCount: chunks.length, durationSeconds: Math.round(durationSeconds) });
  onProgress?.(0);

  const groups = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    const audio = extract(wavPath, start, end);
    const response = await transcribeChunk(audio, { apiKey, model, fetchImpl, sleepImpl });
    groups.push(parseGroqSegments(response, start));
    onProgress?.((i + 1) / chunks.length);
  }

  const segments = mergeTranscriptSegments(groups, OVERLAP_SECONDS);
  if (!segments.length) {
    throw new Error('No speech detected in the recording (Groq returned an empty transcript).');
  }
  return segments;
}

async function test({ config }, deps = {}) {
  const apiKey = config.groqApiKey;
  if (!apiKey || !apiKey.trim()) throw new Error('Groq API key is required');
  await fetchJson(`${GROQ_BASE}/models`, { headers: authHeaders(apiKey) }, {
    label: 'Groq',
    fetchImpl: deps.fetchImpl || globalThis.fetch,
  });
}

module.exports = {
  id: 'groq',
  name: 'Groq Whisper',
  badge: 'Whisper v3',
  icon: 'groq',
  pricing: 'Free tier available, then from $0.04/hour of audio',
  description:
    'Very fast Whisper transcription on Groq hardware. No speaker diarization, and weaker than Sarvam for English/Malayalam code-switching.',
  credentials: [
    {
      configKey: 'groqApiKey',
      label: 'Groq API key',
      type: 'password',
      placeholder: 'gsk_...',
      hint: 'The same Groq key is used for Groq note generation.',
      link: { href: 'https://console.groq.com/keys', label: 'Groq console' },
      required: true,
    },
  ],
  guide: [
    { text: 'Go to the Groq Console', url: 'https://console.groq.com/keys' },
    { text: 'Sign up / log in and click "Create API Key"' },
    { text: 'Paste the key into the Groq API key field' },
  ],
  models: [
    { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', badge: 'Default', description: 'Fastest and cheapest; good accuracy for most meetings.' },
    { id: 'whisper-large-v3', name: 'Whisper Large v3', badge: 'Accurate', description: 'Higher accuracy, slightly slower and pricier.' },
  ],
  defaultModel: 'whisper-large-v3-turbo',
  allowCustomModel: true,
  capabilities: { diarization: false, languages: ['en', 'ml'] },
  transcribe,
  test,
  // exported for unit tests
  _internals: { parseGroqSegments },
};
