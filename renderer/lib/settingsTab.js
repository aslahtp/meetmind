// The Settings tab that opens next. Settings reads it when it mounts; another screen sends the
// user to a tab with requestSettingsTab('storage') and then navigates to Settings.
export const SETTINGS_TAB_STORAGE_KEY = 'meetmind.settingsTab';

// A tab another screen asked for, which wins over Settings' own choice (e.g. Transcription while
// no API keys are set). Read once.
let requestedTab = null;

export function requestSettingsTab(tab) {
  requestedTab = tab;
  storeSettingsTab(tab);
}

export function takeRequestedSettingsTab() {
  const tab = requestedTab;
  requestedTab = null;
  return tab;
}

export function readSettingsTab() {
  try {
    return localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeSettingsTab(tab) {
  try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab); } catch {}
}
