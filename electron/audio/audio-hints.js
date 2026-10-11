// User-facing hints for recordings that come out silent, per OS. Pure (no electron import).

const HINTS = {
  win32: [
    'Allow microphone access: Windows Settings → Privacy & security → Microphone → turn on "Let desktop apps access your microphone".',
    'Check the microphone level: Windows Sound → Recording → your microphone → Properties → Levels, set to 80–100 and unmute.',
    'MeetMind records whatever your default output device plays, so keep the meeting audio on that device.',
  ],
  darwin: [
    'Allow microphone access: System Settings → Privacy & Security → Microphone → turn on MeetMind.',
    'Allow system audio: System Settings → Privacy & Security → Screen & System Audio Recording → turn on MeetMind, so other participants are recorded.',
    'Check the input level: System Settings → Sound → Input.',
  ],
};

const TEST_HINT = 'To test capture, play a video while recording for a few seconds.';

/** Hints for a silent recording on `platform` (defaults to the Windows wording). */
function silenceHints(platform) {
  return [...(HINTS[platform] || HINTS.win32), TEST_HINT];
}

module.exports = { silenceHints };
