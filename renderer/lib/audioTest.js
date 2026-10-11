// Settings › System › "Test system audio" (macOS): the capture methods it can try and how a
// result reads. Mirrors electron/audio/mac-capture.js.

export const CAPTURE_STRATEGIES = [
  { id: 'screen', label: 'Screen source', description: 'The standard method. Needs Screen & System Audio Recording permission.' },
  { id: 'frame', label: 'App window source', description: 'Uses MeetMind’s own window; may work without Screen Recording permission.' },
  { id: 'picker', label: 'System picker', description: 'macOS asks you to choose what to share each time a recording starts.' },
];

/** Peak level (0–1) above which a test counts as having heard system audio. */
export const HEARD_THRESHOLD = 0.01;

/** Largest absolute sample in a Float32Array of audio samples. */
export function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * Reads a test result { peak, ended, error } as { tone, text } for a StatusDot + caption.
 * 'ok' only when audio was heard; silence can mean nothing was playing, so it says so.
 */
export function describeAudioTest(result) {
  if (!result) return null;
  if (result.error) return { tone: 'error', text: `Failed: ${result.error}` };
  if (result.ended && !(result.peak > HEARD_THRESHOLD)) {
    return { tone: 'error', text: 'The system audio stream stopped straight away. This method doesn’t work on this Mac.' };
  }
  if (result.peak > HEARD_THRESHOLD) return { tone: 'ok', text: `Heard system audio (peak ${Math.round(result.peak * 100)}%).` };
  return { tone: 'warning', text: 'Silent. Make sure something was playing; if it was, this method doesn’t capture audio here.' };
}
