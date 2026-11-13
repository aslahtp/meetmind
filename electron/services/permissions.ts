// macOS privacy (TCC) permissions MeetMind needs: the microphone, and Screen & System Audio
// Recording for meeting audio. Backs the `permissions:*` IPC channels and the Settings ›
// System › Permissions card. On other platforms everything reports 'not-applicable'.
//
// Unsigned (ad-hoc) builds have no stable code identity, so macOS forgets these grants after
// every update; the card says so and links to System Settings.

import { systemPreferences, shell } from 'electron';
import type { PermissionKind, PermissionState, PermissionStatus } from '../shared';
import logger from '../utils/logger';
import { errorMessage } from '../utils/errors';

const isMac = process.platform === 'darwin';

const SETTINGS_URLS: Record<string, string | undefined> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  audio: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
};

// CoreGraphics screen-capture preflight/request, via koffi (loaded lazily; macOS only). The
// request call shows the system prompt once; after that the user has to use System Settings.
interface CoreGraphicsApi {
  preflight: () => boolean;
  request: () => boolean;
}

let cg: CoreGraphicsApi | false | null = null;
function coreGraphics() {
  if (cg !== null) return cg;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    cg = {
      preflight: lib.func('bool CGPreflightScreenCaptureAccess()'),
      request: lib.func('bool CGRequestScreenCaptureAccess()'),
    };
  } catch (err) {
    logger.warn('CoreGraphics screen-capture API unavailable', { error: errorMessage(err) });
    cg = false;
  }
  return cg;
}

function screenStatus(): PermissionState {
  const status = systemPreferences.getMediaAccessStatus('screen');
  // getMediaAccessStatus can lag a fresh grant; CoreGraphics' preflight is authoritative for "granted".
  const api = coreGraphics();
  if (status !== 'granted' && api && api.preflight()) return 'granted';
  return status;
}

/** { microphone, screen } as 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'not-applicable'. */
function getPermissionStatus(): PermissionStatus {
  if (!isMac) return { microphone: 'not-applicable', screen: 'not-applicable' };
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: screenStatus(),
  };
}

/** Shows the system prompt for `kind` ('microphone' | 'screen') if macOS still allows one. */
async function requestPermission(kind: PermissionKind | string) {
  if (!isMac) return { granted: true };
  if (kind === 'microphone') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return { granted };
  }
  if (kind === 'screen') {
    const api = coreGraphics();
    const granted = api ? api.request() : false;
    return { granted };
  }
  throw new Error(`Unknown permission: ${kind}`);
}

/** Opens the matching pane of System Settings › Privacy & Security. */
async function openPermissionSettings(kind: string) {
  const url = SETTINGS_URLS[kind];
  if (!isMac || !url) return false;
  await shell.openExternal(url);
  return true;
}

export { getPermissionStatus, requestPermission, openPermissionSettings };
