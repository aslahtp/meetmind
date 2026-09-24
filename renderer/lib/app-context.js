import { createContext, useContext } from 'react';

// App-wide state (config, sessions, processing, toasts…) provided by <App> in app.jsx.
// Kept out of app.jsx so that file exports only components and React Fast Refresh can
// hot-swap it instead of reloading the whole UI on every edit.
export const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

export function hasSttApiKey(cfg) {
  const service = cfg?.sttService || 'google';
  if (service === 'assemblyai') return !!cfg?.assemblyAiApiKey?.trim();
  if (service === 'sarvam') return !!cfg?.sarvamApiKey?.trim();
  return !!cfg?.googleApiKey?.trim();
}
