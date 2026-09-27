import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';
import './styles/globals.css';

// Entry point. Mounting lives here, not in app.jsx, so app.jsx exports only a component and
// React Fast Refresh can hot-swap it during `pnpm run dev` instead of reloading the page.
createRoot(document.getElementById('root')).render(<App />);

// Fade out the startup splash (index.html) once React has painted, but not before the icon
// has finished drawing itself, so a fast start doesn't cut the animation off mid-stroke.
const SPLASH_MIN_MS = 1000;
const splash = document.getElementById('splash');
if (splash) {
  const remove = () => splash.remove();
  setTimeout(() => {
    requestAnimationFrame(() => {
      splash.classList.add('splash-out');
      splash.addEventListener('transitionend', (e) => { if (e.target === splash) remove(); });
      setTimeout(remove, 600); // transitionend never fires if the page is hidden
    });
  }, Math.max(0, SPLASH_MIN_MS - performance.now()));
}
