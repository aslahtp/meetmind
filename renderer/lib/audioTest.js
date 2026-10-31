// Settings › System › "Test system audio" (macOS and Linux): the capture methods it can try on
// macOS (mirrors electron/audio/mac-capture.js), the test itself, and how a result reads.

export const CAPTURE_STRATEGIES = [
  { id: 'screen', label: 'Screen source', description: 'The standard method. Needs Screen & System Audio Recording permission.' },
  { id: 'frame', label: 'App window source', description: 'Uses MeetMind’s own window; may work without Screen Recording permission.' },
  { id: 'picker', label: 'System picker', description: 'macOS asks you to choose what to share each time a recording starts.' },
];

const TEST_SECONDS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long each test records, in seconds. */
export const CAPTURE_TEST_SECONDS = TEST_SECONDS;

/**
 * One short system-audio capture through Electron's loopback, measuring the peak level. On macOS
 * `strategy` picks the capture method for this test; Linux has one method. Resolves with
 * { peak, ended } or { error }.
 */
export async function runCaptureTest(strategy) {
  const begin = await window.meetmind.capture.testBegin(strategy);
  if (!begin?.success) return { error: begin?.error || 'Could not start the test' };
  let stream = null;
  let ctx = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) return { error: 'No system audio track (permission denied?)' };

    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let peak = 0;
    let ended = track.readyState === 'ended';
    const until = Date.now() + TEST_SECONDS * 1000;
    while (!ended && Date.now() < until) {
      await sleep(100);
      analyser.getFloatTimeDomainData(buf);
      peak = Math.max(peak, peakOf(buf));
      ended = track.readyState === 'ended';
    }
    return { peak, ended };
  } catch (err) {
    return { error: err?.message || String(err) };
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    await window.meetmind.capture.testEnd();
  }
}

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
    return { tone: 'error', text: 'The system audio stream stopped straight away. This method doesn’t work on this computer.' };
  }
  if (result.peak > HEARD_THRESHOLD) return { tone: 'ok', text: `Heard system audio (peak ${Math.round(result.peak * 100)}%).` };
  return { tone: 'warning', text: 'Silent. Make sure something was playing; if it was, this method doesn’t capture audio here.' };
}
