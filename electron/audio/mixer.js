/**
 * Special device ID for WASAPI loopback.
 * Captures whatever audio is playing through the current Windows default
 * output device — works with speakers, 3.5mm headphones, USB headphones,
 * and Bluetooth headphones without requiring Stereo Mix.
 */
const WASAPI_LOOPBACK_ID = '__wasapi_loopback__';
const WASAPI_LOOPBACK_LABEL = 'WASAPI Loopback (All system audio — recommended)';

function isWasapiLoopback(device) {
  return device === WASAPI_LOOPBACK_ID;
}

/**
 * Builds FFmpeg filter graph arguments for mixing system audio + mic.
 * Returns the filter_complex string and output options.
 */
function buildAmixFilter(systemDevice, micDevice) {
  const inputs = [];
  const filterParts = [];

  // WASAPI loopback: captures the Windows default audio output (speakers, headphones, USB, BT)
  const wasapiLoopbackInput = () => [
    '-f', 'wasapi',
    '-thread_queue_size', '512',
    '-loopback',
    '-i', '',
  ];

  // DirectShow input for a named device (e.g. Stereo Mix, microphone)
  const dshowInput = (device) => [
    '-f', 'dshow',
    '-thread_queue_size', '512',
    '-rtbufsize', '30485760',
    '-audio_buffer_size', '80',
    '-i', `audio=${device}`,
  ];

  const sysInput = (device) => isWasapiLoopback(device) ? wasapiLoopbackInput() : dshowInput(device);

  if (systemDevice && micDevice) {
    inputs.push(...sysInput(systemDevice));
    inputs.push(...dshowInput(micDevice));
    // asetpts=PTS-STARTPTS resets each input's timestamps to start at zero.
    // Without this, dshow devices often have different start timestamps (e.g.
    // 0.5 s apart) which can cause amix to output silence while waiting for
    // alignment.
    // duration=longest ensures output includes all audio even if one input stops.
    // dropout_transition=0 prevents fade-out when one input ends before the other.
    filterParts.push(
      '-filter_complex',
      '[0:a]asetpts=PTS-STARTPTS[s];[1:a]asetpts=PTS-STARTPTS[m];' +
      '[s][m]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,volume=4[aout]',
      '-map', '[aout]',
    );
  } else if (systemDevice) {
    inputs.push(...sysInput(systemDevice));
  } else if (micDevice) {
    inputs.push(...dshowInput(micDevice));
  } else {
    throw new Error('No audio device specified');
  }

  // Simple volume boost for single-input paths (no filter_complex conflict).
  const afArgs = filterParts.length === 0 ? ['-af', 'volume=4'] : [];
  const outputArgs = [...afArgs, '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le'];

  return { inputs, filterParts, outputArgs };
}

const SECTION_HEADERS_TO_SKIP = [
  'directshow video devices',
  'directshow audio devices',
  'directshow video and audio devices',
  'alternative directshow video devices',
  'alternative directshow audio devices',
];

function isSectionHeader(name) {
  return SECTION_HEADERS_TO_SKIP.includes((name || '').toLowerCase().trim());
}

/**
 * Parses FFmpeg device list output into an array of audio device names.
 * Handles:
 * - Newer format: [in#0 @ ...] "Device Name" (audio)
 * - Older format: [dshow @ ...] "Device Name" under "DirectShow audio devices"
 */
function parseDeviceList(ffmpegOutput) {
  const audioDevices = [];
  const seen = new Set();
  const raw = ffmpegOutput || '';

  // Newer FFmpeg (e.g. 2024+): "Device Name" (audio) on the same line
  const audioLineRegex = /"([^"]+)"\s*\(audio\)/g;
  let m;
  while ((m = audioLineRegex.exec(raw)) !== null) {
    const name = m[1].trim();
    if (!isSectionHeader(name) && name.toLowerCase() !== 'dummy' && !seen.has(name)) {
      seen.add(name);
      audioDevices.push(name);
    }
  }

  if (audioDevices.length > 0) return audioDevices;

  // Older format: DirectShow section + [dshow @ ...] "Name"
  let inAudioSection = false;
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().includes('audio') && trimmed.toLowerCase().includes('directshow')) {
      inAudioSection = true;
      continue;
    }
    if (trimmed.toLowerCase().includes('video') && trimmed.toLowerCase().includes('directshow')) {
      inAudioSection = false;
      continue;
    }
    if (inAudioSection) {
      const match = trimmed.match(/"([^"]+)"/);
      if (match && match[1]) {
        const name = match[1].trim();
        if (!isSectionHeader(name) && name.toLowerCase() !== 'dummy' && !seen.has(name)) {
          seen.add(name);
          audioDevices.push(name);
        }
      }
    }
  }

  if (audioDevices.length > 0) return audioDevices;

  // Last resort: any [dshow @ ...] or [in#0 @ ...] "Name" line
  const anyDeviceRegex = /\[(?:dshow|in#\d+)[^\]]*\]\s*"([^"]+)"/g;
  while ((m = anyDeviceRegex.exec(raw)) !== null) {
    const name = m[1].trim();
    if (!isSectionHeader(name) && name.toLowerCase() !== 'dummy' && !seen.has(name)) {
      seen.add(name);
      audioDevices.push(name);
    }
  }

  return audioDevices;
}

/**
 * Detect the preferred system loopback device.
 * WASAPI Loopback is always the first preference — it captures all system audio
 * regardless of output device (speakers, headphones, USB, Bluetooth).
 * Falls back to Stereo Mix or virtual cable devices if WASAPI loopback shouldn't be used.
 */
function detectSystemLoopback(devices) {
  // WASAPI loopback is always the best option on Windows — return it unconditionally
  return WASAPI_LOOPBACK_ID;
}

/**
 * Find dshow-based fallback loopback device (Stereo Mix, virtual cable, etc.)
 * Used as display info in Settings; not used for actual recording (WASAPI preferred).
 */
function detectDshowLoopback(devices) {
  const preferenceOrder = [
    'stereo mix',
    'virtual cable',
    'vb-audio',
    'cable output',
    'loopback',
    'what u hear',
  ];
  for (const pref of preferenceOrder) {
    const found = devices.find((d) => d.toLowerCase().includes(pref));
    if (found) return found;
  }
  return null;
}

/**
 * Detect default microphone from device list.
 */
function detectMicrophone(devices) {
  const micKeywords = ['microphone', 'mic', 'headset', 'webcam', 'usb audio'];
  for (const keyword of micKeywords) {
    const found = devices.find((d) => d.toLowerCase().includes(keyword));
    if (found) return found;
  }
  // Fallback: return first device that isn't a loopback
  return devices.find((d) => !d.toLowerCase().includes('loopback') && !d.toLowerCase().includes('stereo mix')) || null;
}

/**
 * Build FFmpeg args for recording a single device (used for device probing).
 */
function buildSingleDeviceArgs(device) {
  const inputs = isWasapiLoopback(device)
    ? ['-f', 'wasapi', '-thread_queue_size', '512', '-loopback', '-i', '']
    : ['-f', 'dshow', '-thread_queue_size', '512', '-rtbufsize', '30485760',
       '-audio_buffer_size', '80', '-i', `audio=${device}`];
  return {
    inputs,
    outputArgs: ['-af', 'volume=1', '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le'],
  };
}

module.exports = {
  buildAmixFilter,
  buildSingleDeviceArgs,
  parseDeviceList,
  detectSystemLoopback,
  detectDshowLoopback,
  detectMicrophone,
  isWasapiLoopback,
  WASAPI_LOOPBACK_ID,
  WASAPI_LOOPBACK_LABEL,
};
