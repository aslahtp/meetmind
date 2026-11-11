// Globals the renderer relies on. Types only.
//
// `window.meetmind` is optional on purpose: the renderer guards every use (`window.meetmind?.…`,
// `if (!window.meetmind) return`) so the pages still render in a plain browser (e.g. `vite` alone).
// Asset imports (`*.svg`, `*.png`) come from `vite/client` (see tsconfig.json `types`).

import type { Meetmind, MeetmindOverlay } from '../electron/shared';

declare global {
  interface Window {
    /** The main window's bridge to the main process (electron/preload.js). */
    meetmind?: Meetmind;
    /** The meeting overlay window's bridge (electron/overlay-preload.js). */
    meetmindOverlay?: MeetmindOverlay;
  }

  /** The app version, injected by Vite's `define` (vite.config.js) from package.json. */
  const __APP_VERSION__: string;
}

export {};
