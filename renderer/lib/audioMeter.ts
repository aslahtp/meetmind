/**
 * Lightweight pub/sub for real-time audio levels (~30 fps).
 *
 * AnalyserNodes in app.jsx push RMS levels here so that only components
 * displaying live meters (e.g. RecordingBar) re-render at 30 fps,
 * avoiding expensive full-tree re-renders of App, Dashboard, and note views.
 */

let currentLevels = { mic: 0, system: 0 };
const listeners = new Set<(levels: any) => void>();

export const audioMeter = {
  getLevels() {
    return currentLevels;
  },

  emit(levels: any) {
    currentLevels = levels;
    for (const listener of listeners) {
      listener(currentLevels);
    }
  },

  subscribe(listener: any) {
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
