/**
 * Builds FFmpeg filter graph arguments for mixing system audio + mic.
 * Returns the filter_complex string and output options.
 */
function buildAmixFilter(systemDevice, micDevice) {
  const inputs = [];
  const filterParts = [];

  if (systemDevice && micDevice) {
    // Both tracks: amix
    inputs.push('-f', 'dshow', '-i', `audio=${systemDevice}`);
    inputs.push('-f', 'dshow', '-i', `audio=${micDevice}`);
    filterParts.push('-filter_complex', 'amix=inputs=2:duration=first:dropout_transition=2');
  } else if (systemDevice) {
    inputs.push('-f', 'dshow', '-i', `audio=${systemDevice}`);
  } else if (micDevice) {
    inputs.push('-f', 'dshow', '-i', `audio=${micDevice}`);
  } else {
    throw new Error('No audio device specified');
  }

  const outputArgs = ['-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le'];

  return { inputs, filterParts, outputArgs };
}

/**
 * Parses FFmpeg's dshow device list output into an array of device names.
 * Handles both audio and video device sections.
 */
function parseDeviceList(ffmpegOutput) {
  const audioDevices = [];
  let inAudioSection = false;

  const lines = ffmpegOutput.split('\n');
  for (const line of lines) {
    if (line.includes('"audio"')) {
      inAudioSection = true;
      continue;
    }
    if (line.includes('"video"')) {
      inAudioSection = false;
    }

    if (inAudioSection) {
      // Match lines like:  [dshow @ ...] "Device Name"
      const match = line.match(/"([^"]+)"/);
      if (match && match[1]) {
        audioDevices.push(match[1]);
      }
    }
  }

  // Also handle newer FFmpeg output format: DirectShow audio devices
  const altMatch = ffmpegOutput.matchAll(/\[dshow[^\]]*\]\s+"([^"]+)"\s*\(audio\)/gi);
  for (const m of altMatch) {
    if (!audioDevices.includes(m[1])) audioDevices.push(m[1]);
  }

  return audioDevices;
}

/**
 * Detect the preferred system loopback device from a list of available devices.
 * Preference order: Stereo Mix > WASAPI Loopback > Virtual Cable > first device
 */
function detectSystemLoopback(devices) {
  const preferenceOrder = [
    'stereo mix',
    'wasapi loopback',
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

module.exports = { buildAmixFilter, parseDeviceList, detectSystemLoopback, detectMicrophone };
