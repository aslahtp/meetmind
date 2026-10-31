import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  CHECK_INTERVAL_MS,
  RETRY_DELAYS_MS,
  HIDDEN_RELAUNCH_WINDOW_MS,
  canSelfUpdate,
  nextCheckDelay,
  autoInstallEnabled,
  isIdleForUpdate,
  shouldRelaunchHidden,
} = require('../electron/services/update-policy.js');

const IDLE = { isRecording: false, activePipelines: 0, activeMeeting: null, overlayMode: 'hidden', windowVisible: false };

describe('nextCheckDelay', () => {
  it('waits the full interval after a successful check', () => {
    expect(nextCheckDelay({ ok: true, failures: 0 })).toBe(CHECK_INTERVAL_MS);
  });

  it('retries failed checks soon, backing off, and never gives up', () => {
    const delays = [1, 2, 3, 4, 5, 50].map((failures) => nextCheckDelay({ ok: false, failures }));
    expect(delays.slice(0, 4)).toEqual(RETRY_DELAYS_MS);
    expect(delays[4]).toBe(RETRY_DELAYS_MS.at(-1));
    expect(delays[5]).toBe(RETRY_DELAYS_MS.at(-1));
    expect(delays.every((d) => d < CHECK_INTERVAL_MS)).toBe(true);
  });
});

describe('canSelfUpdate', () => {
  it('is on for Windows and a Linux AppImage, off for unsigned macOS and a Linux .deb', () => {
    expect(canSelfUpdate('win32', {})).toBe(true);
    expect(canSelfUpdate('darwin', {})).toBe(false);
    expect(canSelfUpdate('linux', { APPIMAGE: '/home/me/Apps/MeetMind.AppImage' })).toBe(true);
    expect(canSelfUpdate('linux', {})).toBe(false);
  });
});

describe('autoInstallEnabled', () => {
  it('needs checks on, install on, and an app that can replace itself', () => {
    expect(autoInstallEnabled({ autoCheckUpdates: true, autoInstallUpdates: true }, true)).toBe(true);
    expect(autoInstallEnabled({ autoInstallUpdates: true }, true)).toBe(true);   // checks default on
    expect(autoInstallEnabled({ autoCheckUpdates: false, autoInstallUpdates: true }, true)).toBe(false);
    expect(autoInstallEnabled({ autoCheckUpdates: true, autoInstallUpdates: true }, false)).toBe(false);
  });

  it('is off by default', () => {
    expect(autoInstallEnabled({}, true)).toBe(false);
    expect(autoInstallEnabled(null, true)).toBe(false);
  });
});

describe('isIdleForUpdate', () => {
  it('is idle only with the window hidden and nothing going on', () => {
    expect(isIdleForUpdate(IDLE)).toBe(true);
    expect(isIdleForUpdate({ ...IDLE, windowVisible: true })).toBe(false);
    expect(isIdleForUpdate({ ...IDLE, isRecording: true })).toBe(false);
    expect(isIdleForUpdate({ ...IDLE, activePipelines: 1 })).toBe(false);
    expect(isIdleForUpdate({ ...IDLE, activeMeeting: { key: 'meet|chrome.exe' } })).toBe(false);
    expect(isIdleForUpdate({ ...IDLE, overlayMode: 'prompt' })).toBe(false);
  });
});

describe('shouldRelaunchHidden', () => {
  const now = 1_000_000_000;
  it('honours a recent automatic install only', () => {
    expect(shouldRelaunchHidden(now - 60_000, now)).toBe(true);
    expect(shouldRelaunchHidden(now - HIDDEN_RELAUNCH_WINDOW_MS - 1, now)).toBe(false);
    expect(shouldRelaunchHidden(now + 60_000, now)).toBe(false);
    expect(shouldRelaunchHidden(undefined, now)).toBe(false);
  });
});
