// Globals the renderer relies on. Types only.
//
// `window.meetmind` and `window.meetmindOverlay` are declared always present, because the preload
// scripts set them before any renderer code runs inside Electron, and that is where nearly every
// call is made unguarded. A few places still check (`window.meetmind?.…`, `if (!window.meetmind) return`)
// so the pages render in a plain browser (e.g. `vite` alone); those checks stay valid.
// Asset imports (`*.svg`, `*.png`) come from `vite/client` (see tsconfig.json `types`).

import type { Meetmind, MeetmindCapture, MeetmindOverlay } from '../electron/shared';

declare global {
  interface Window {
    /** The main window's bridge to the main process (electron/preload.ts). */
    meetmind: Meetmind;
    /** The meeting overlay window's bridge (electron/overlay-preload.ts). */
    meetmindOverlay: MeetmindOverlay;
    /** The hidden capture window's bridge (electron/capture-preload.ts); only that window has it. */
    meetmindCapture: MeetmindCapture;
  }
}

// React 18's types don't know the HTML `inert` attribute yet (the renderer sets it to '' or undefined).
// Type only; React already renders it as an attribute.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must repeat the original type parameter to merge
  interface HTMLAttributes<T> {
    inert?: string;
  }
}

declare global {
  /** The app version, injected by Vite's `define` (vite.config.ts) from package.json. */
  const __APP_VERSION__: string;
}

export {};
