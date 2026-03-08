const fs = require('fs');
const https = require('https');
const logger = require('../utils/logger');

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_SECONDS = 55;
const OVERLAP_SECONDS = 5;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_HEADER_BYTES = 44;

// ── REST helpers ──────────────────────────────────────────────────────────────

function httpsPost(url, body) {
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

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
    };

    https.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    }).on('error', reject);
  });
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
 * Scan up to ~2 seconds of WAV samples (skipping the header) and return the
 * peak absolute amplitude (0–32767 for 16-bit PCM).  Returns 0 for an
 * unreadable or zero-byte data section.
 */
function getWavPeakAmplitude(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = parseWavHeader(buffer);
  if (!parsed || parsed.dataSize === 0) return 0;

  // Find the data chunk start
  let dataStart = WAV_HEADER_BYTES; // fallback
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    if (chunkId === 'data') { dataStart = pos + 8; break; }
    pos += 8 + buffer.readUInt32LE(pos + 4);
  }

  // Sample the first 2 seconds worth of 16-bit samples
  const samplesToCheck = parsed.sampleRate * parsed.numChannels * 2; // 2 seconds
  const endByte = Math.min(dataStart + samplesToCheck * 2, buffer.length);

  let peak = 0;
  for (let i = dataStart; i + 1 < endByte; i += 2) {
    const sample = Math.abs(buffer.readInt16LE(i));
    if (sample > peak) peak = sample;
  }
  return peak;
}

function extractWavChunk(filePath, startSec, endSec) {
  const buffer = fs.readFileSync(filePath);
  const startByte = WAV_HEADER_BYTES + Math.floor(startSec * SAMPLE_RATE * BYTES_PER_SAMPLE);
  const endByte   = WAV_HEADER_BYTES + Math.floor(endSec   * SAMPLE_RATE * BYTES_PER_SAMPLE);
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

// ── Long-running recognition ──────────────────────────────────────────────────

async function recognizeChunk(base64Audio, apiKey) {
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

  // Poll until done
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

function parseTranscriptResponse(response, timeOffsetSeconds = 0) {
  const results = response?.results || [];
  const segments = [];

  for (const result of results) {
    const alternative = result?.alternatives?.[0];
    if (!alternative) continue;

    const words = alternative.words || [];
    if (words.length === 0) {
      // No word-level data — treat whole result as one segment
      segments.push({
        speaker: 'Speaker 1',
        text: alternative.transcript || '',
        startTime: timeOffsetSeconds,
        endTime: timeOffsetSeconds,
      });
      continue;
    }

    // Group words by speaker tag
    let currentSpeaker = null;
    let currentWords = [];
    let segStartTime = timeOffsetSeconds;
    let segEndTime = timeOffsetSeconds;

    for (const word of words) {
      const speaker = `Speaker ${word.speakerTag || 1}`;
      const wordStart = parseTimeOffset(word.startTime) + timeOffsetSeconds;
      const wordEnd   = parseTimeOffset(word.endTime)   + timeOffsetSeconds;

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
  // Format: "1.234s" or { seconds: "1", nanos: 234000000 }
  if (typeof offset === 'string') {
    return parseFloat(offset.replace('s', ''));
  }
  if (typeof offset === 'object') {
    return (parseInt(offset.seconds || 0)) + (offset.nanos || 0) / 1e9;
  }
  return 0;
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

async function transcribeAudio(wavFilePath, apiKey, onProgress) {
  if (!apiKey) throw new Error('Google API key is required for transcription');
  if (!fs.existsSync(wavFilePath)) throw new Error(`Audio file not found: ${wavFilePath}`);

  const stat = fs.statSync(wavFilePath);
  const durationSeconds = getWavDurationSeconds(wavFilePath);
  const peakAmplitude = getWavPeakAmplitude(wavFilePath);
  // 32767 = max for 16-bit PCM; values below ~200 indicate near-silence
  const isSilent = peakAmplitude < 200;

  logger.info('Starting transcription', { wavFilePath, durationSeconds, fileSizeBytes: stat.size, peakAmplitude });

  if (isSilent) {
    logger.warn('Recording is silent (peak amplitude below threshold)', {
      peakAmplitude,
      hint: [
        'Stereo Mix only captures audio going out to your speakers — it will be silent if nothing is playing (no call, no music).',
        'For your own voice: make sure the microphone is selected in Settings → Audio.',
        'Test by playing a YouTube video or audio file and recording for a few seconds.',
        'If using a headset/headphones: Stereo Mix must be enabled on the same sound card as your headphones.',
      ],
    });
    throw new Error(
      'The recording is completely silent (peak=' + peakAmplitude + '). ' +
      'Stereo Mix only captures audio playing through your speakers — it will be silent if no audio is playing. ' +
      'To test: play a YouTube video or music, then record. ' +
      'To capture your voice: select your microphone in Settings → Audio.'
    );
  }

  onProgress?.(0);

  if (durationSeconds <= CHUNK_DURATION_SECONDS) {
    // Single chunk — no splitting needed
    const base64 = fs.readFileSync(wavFilePath).toString('base64');
    const response = await recognizeChunk(base64, apiKey);
    onProgress?.(1);
    return parseTranscriptResponse(response);
  }

  // Split into overlapping chunks
  const chunks = [];
  let start = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + CHUNK_DURATION_SECONDS, durationSeconds);
    chunks.push({ start, end });
    start += CHUNK_DURATION_SECONDS - OVERLAP_SECONDS;
  }

  logger.info('Splitting audio into chunks', { chunkCount: chunks.length });

  const segmentGroups = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    logger.debug('Processing chunk', { i, start, end });

    const base64Chunk = extractWavChunk(wavFilePath, start, end);
    const response = await recognizeChunk(base64Chunk, apiKey);
    const segments = parseTranscriptResponse(response, start);
    segmentGroups.push(segments);

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

module.exports = { transcribeAudio, testGoogleSTT };
