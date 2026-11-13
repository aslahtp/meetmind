// How the macOS display-media handler supplies the video source that getDisplayMedia() requires
// alongside loopback (system) audio. Electron's macOS loopback is new (CoreAudio Tap, Electron
// 39+, macOS 14.2+) and its behaviour differs by source, so MeetMind supports three, testable
// from Settings › System › "Test system audio", and saved as config.macCaptureStrategy:
//
//   screen — a screen from desktopCapturer, auto-approved. The documented approach; needs the
//            Screen & System Audio Recording permission.
//   frame  — MeetMind's own window frame as the video. May avoid the Screen Recording prompt
//            (untested on real hardware).
//   picker — the macOS system picker; the user chooses each time.
//
// Pure: no electron import.

import type { MacCaptureStrategy } from '../shared/config';

const MAC_CAPTURE_STRATEGIES: readonly MacCaptureStrategy[] = ['screen', 'frame', 'picker'];
const DEFAULT_MAC_CAPTURE_STRATEGY: MacCaptureStrategy = 'screen';

function normalizeMacCaptureStrategy(value: unknown): MacCaptureStrategy {
  return MAC_CAPTURE_STRATEGIES.includes(value as MacCaptureStrategy) ? (value as MacCaptureStrategy) : DEFAULT_MAC_CAPTURE_STRATEGY;
}

export { MAC_CAPTURE_STRATEGIES, DEFAULT_MAC_CAPTURE_STRATEGY, normalizeMacCaptureStrategy };
