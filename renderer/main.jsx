import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import './styles/globals.css';

// Entry point. Mounting lives here, not in app.jsx, so app.jsx exports only a component and
// React Fast Refresh can hot-swap it during `pnpm run dev` instead of reloading the page.
createRoot(document.getElementById('root')).render(<App />);

// Startup splash (index.html). It waits, paused on an empty frame, until the main process reports
// the window visible (the window is created hidden and shown after first paint), then plays and
// fades once the icon has drawn itself. Reopening a hidden window (desktop shortcut, tray) replays it.
const SPLASH_PLAY_MS = 1000;
const SPLASH_FALLBACK_MS = 2500; // never leave the splash covering the app if the signal is lost
const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let splash = document.getElementById('splash');
let splashPlaying = false;
let splashPlayed = false;

function hideSplash(el) {
  el.classList.add('splash-out');
  const done = () => { el.hidden = true; splashPlaying = false; };
  el.addEventListener('transitionend', (e) => { if (e.target === el) done(); }, { once: true });
  setTimeout(done, 600); // transitionend never fires if the window is hidden mid-fade
}

function playSplash() {
  if (!splash || splashPlaying) return;
  if (splashPlayed && reducedMotion) return; // a replay without motion would only be a delay
  // A fresh copy restarts the CSS animations from their first frame.
  const fresh = splash.cloneNode(true);
  fresh.hidden = false;
  fresh.classList.remove('splash-out');
  fresh.classList.add('splash-play');
  splash.replaceWith(fresh);
  splash = fresh;
  splashPlaying = true;
  splashPlayed = true;
  setTimeout(() => hideSplash(fresh), SPLASH_PLAY_MS);
}

if (splash) {
  window.addEventListener('meetmind:window-shown', playSplash);
  if (window.meetmind?.window?.wasShown?.()) playSplash();
  setTimeout(() => { if (!splashPlayed) playSplash(); }, SPLASH_FALLBACK_MS);
}
