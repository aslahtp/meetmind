const fs = require('fs');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_HEADER_BYTES = 44;

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

/** Extract [startSec, endSec) of a 16 kHz mono 16-bit WAV as a standalone WAV Buffer. */
function extractWavChunkBuffer(filePath, startSec, endSec) {
  const buffer = fs.readFileSync(filePath);
  const startByte = WAV_HEADER_BYTES + Math.floor(startSec * SAMPLE_RATE * BYTES_PER_SAMPLE);
  const endByte = WAV_HEADER_BYTES + Math.floor(endSec * SAMPLE_RATE * BYTES_PER_SAMPLE);
  const audioData = buffer.subarray(startByte, Math.min(endByte, buffer.length));

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

  return Buffer.concat([header, audioData]);
}

function extractWavChunk(filePath, startSec, endSec) {
  return extractWavChunkBuffer(filePath, startSec, endSec).toString('base64');
}

/** Overlapping [start, end) windows covering `durationSeconds`. */
function planChunks(durationSeconds, chunkSeconds, overlapSeconds) {
  const chunks = [];
  let start = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + chunkSeconds, durationSeconds);
    chunks.push({ start, end });
    if (end >= durationSeconds) break;
    start += chunkSeconds - overlapSeconds;
  }
  return chunks;
}

/** Merge per-chunk segments, dropping ones that fall in the overlap region. */
function mergeTranscriptSegments(segmentGroups, overlapSeconds) {
  const all = segmentGroups.flat();
  all.sort((a, b) => a.startTime - b.startTime);

  const merged = [];
  for (const seg of all) {
    const last = merged[merged.length - 1];
    if (last && seg.startTime < last.endTime - overlapSeconds / 2) continue;
    merged.push(seg);
  }
  return merged;
}

module.exports = {
  SAMPLE_RATE,
  BYTES_PER_SAMPLE,
  WAV_HEADER_BYTES,
  parseWavHeader,
  getWavDurationSeconds,
  getWavPeakAmplitude,
  extractWavChunkBuffer,
  extractWavChunk,
  planChunks,
  mergeTranscriptSegments,
};
