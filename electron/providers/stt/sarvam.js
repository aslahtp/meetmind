const fs = require('fs');
const path = require('path');
const logger = require('../shared/log');
const { httpsPost, httpsGet, httpsPut, sleep } = require('../shared/http');
const { getWavDurationSeconds } = require('../shared/wav');

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

async function transcribeWithSarvam(wavFilePath, apiKey, model, onProgress) {
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
      model,
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


module.exports = {
  id: 'sarvam',
  name: 'Sarvam AI',
  badge: 'Saaras v3',
  icon: 'sarvam',
  pricing: 'Pay-as-you-go, INR-based billing (~₹0.50/min)',
  description:
    'Built specifically for Indian languages with excellent Malayalam-English code-switching and accent handling. Requires Sarvam API key.',
  credentials: [
    {
      configKey: 'sarvamApiKey',
      label: 'Sarvam AI API key',
      type: 'password',
      placeholder: 'sarvam_api_key_...',
      hint: 'High accuracy transcription for Indian languages, including Malayalam with seamless code-switching.',
      link: { href: 'https://dashboard.sarvam.ai', label: 'Sarvam dashboard' },
      required: true,
    },
  ],
  guide: [
    { text: 'Go to the Sarvam AI Dashboard', url: 'https://dashboard.sarvam.ai' },
    { text: 'Sign up / log in and open "API Keys"' },
    { text: 'Create a new key and paste it into the Sarvam API key field' },
  ],
  models: [
    { id: 'saaras:v3', name: 'Saaras v3', badge: 'Default', description: 'Code-mix mode with automatic language detection and diarization.' },
  ],
  defaultModel: 'saaras:v3',
  allowCustomModel: true,
  capabilities: { diarization: true, languages: ['en', 'ml', 'hi', 'ta', 'te'] },
  transcribe: ({ wavPath, model, config, onProgress }) =>
    transcribeWithSarvam(wavPath, config.sarvamApiKey, model, onProgress),
  test: ({ config }) => testSarvam(config.sarvamApiKey),
};
