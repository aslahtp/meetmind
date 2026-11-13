/**
 * Lightweight pub/sub for real-time audio levels (~30 fps).
 *
 * AnalyserNodes in app.tsx push RMS levels here so that only components
 * displaying live meters (e.g. RecordingBar) re-render at 30 fps,
 * avoiding expensive full-tree re-renders of App, Dashboard, and note views.
 */

/** Live input levels, 0 to 1. */
export interface AudioLevels {
  mic: number;
  system: number;
}

let currentLevels: AudioLevels = { mic: 0, system: 0 };
const listeners = new Set<(levels: AudioLevels) => void>();

export const audioMeter = {
  getLevels() {
    return currentLevels;
  },

  emit(levels: AudioLevels) {
    currentLevels = levels;
    for (const listener of listeners) {
      listener(currentLevels);
    }
  },

  subscribe(listener: (levels: AudioLevels) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  reset() {
    currentLevels = { mic: 0, system: 0 };
    for (const listener of listeners) {
      listener(currentLevels);
    }
  },
};
