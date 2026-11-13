import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import ErrorBoundary, { AppErrorFallback } from './components/ErrorBoundary';
import { installGlobalErrorReporting } from './lib/errorReport';
import './styles/globals.css';

installGlobalErrorReporting();

// Entry point. Mounting lives here, not in app.tsx, so app.tsx exports only a component and
// React Fast Refresh can hot-swap it during `pnpm run dev` instead of reloading the page.
// The outer boundary is the last resort: if the app itself throws while rendering, React would
// otherwise unmount everything and leave an empty window with no way to close it.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary name="app" fallback={AppErrorFallback}>
    <App />
  </ErrorBoundary>,
);

// The app reports itself ready once it has loaded its state (app.tsx). If that never happens, say
// so anyway rather than have main treat a slow start as a failed load and reload the window.
setTimeout(() => window.meetmind?.window?.ready?.(), 8000);

// Startup splash (index.html). It waits, paused on an empty frame, until the main process reports
// the window visible (the window is created hidden and shown after first paint), then plays once and
// fades after the icon has drawn itself. It belongs to the page load: reopening an already-loaded
// window from the tray shows the app straight away, with no splash.
const SPLASH_PLAY_MS = 1000;
const SPLASH_FALLBACK_MS = 2500; // never leave the splash covering the app if the signal is lost
const splash = document.getElementById('splash');

function playSplash() {
  if (!splash || splash.classList.contains('splash-play')) return;
  window.removeEventListener('meetmind:window-shown', playSplash);
  splash.classList.add('splash-play');
  setTimeout(() => {
    splash.classList.add('splash-out');
    splash.addEventListener('transitionend', (e) => { if (e.target === splash) splash.remove(); });
    setTimeout(() => splash.remove(), 600); // transitionend never fires if the window is hidden mid-fade
  }, SPLASH_PLAY_MS);
}

if (splash) {
  window.addEventListener('meetmind:window-shown', playSplash);
  if (window.meetmind?.window?.wasShown?.()) playSplash();
  setTimeout(playSplash, SPLASH_FALLBACK_MS);
}
