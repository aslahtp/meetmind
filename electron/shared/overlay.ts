// Meeting detection and the meeting overlay. Sources: electron/detection/meeting-rules.js (`toMeeting`),
// and `overlayState` / `setOverlay()` in electron/main.js.

import type { MeetingPlatform } from './session';

/** A window's position and size, in screen pixels. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A meeting the detector sees right now. */
export interface DetectedMeeting {
  /** `<platform>|<app id>`: identifies one meeting, e.g. for "Not now". */
  key: string;
  platform: MeetingPlatform;
  /** 'Google Meet', 'Zoom', 'Teams'. */
  platformLabel: string;
  /** The app it runs in ('Chrome', 'Zoom app', …). */
  appLabel: string;
  title: string;
  /** The meeting's window, used to place the overlay next to it. */
  bounds: Bounds | null;
  /** The meeting's link when the window showed it (a Google Meet code), else ''. */
  url: string;
}

/** What the overlay is showing. */
export type OverlayMode = 'hidden' | 'prompt' | 'recording' | 'ended' | 'processing' | 'complete' | 'error';

export interface OverlayState {
  mode: OverlayMode;
  meeting?: DetectedMeeting | null;
  sessionId?: string;
  /** `Date.now()` when recording started. */
  startedAt?: number;
  /** Processing stage while `mode` is 'processing'. */
  stage?: string;
  percent?: number;
  notionUrl?: string | null;
  error?: string;
}

/** `'light' | 'dark'` once `system` has been resolved. */
export type EffectiveTheme = 'light' | 'dark';
