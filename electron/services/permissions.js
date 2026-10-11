// macOS privacy (TCC) permissions MeetMind needs: the microphone, and Screen & System Audio
// Recording for meeting audio. Backs the `permissions:*` IPC channels and the Settings ›
// System › Permissions card. On other platforms everything reports 'not-applicable'.
//
// Unsigned (ad-hoc) builds have no stable code identity, so macOS forgets these grants after
// every update; the card says so and links to System Settings.

const { systemPreferences, shell } = require('electron');
const logger = require('../utils/logger');

const isMac = process.platform === 'darwin';

const SETTINGS_URLS = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  audio: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
};

// CoreGraphics screen-capture preflight/request, via koffi (loaded lazily; macOS only). The
// request call shows the system prompt once; after that the user has to use System Settings.
let cg = null;
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
    logger.warn('CoreGraphics screen-capture API unavailable', { error: err.message });
    cg = false;
  }
  return cg;
}

function screenStatus() {
  const status = systemPreferences.getMediaAccessStatus('screen');
  // getMediaAccessStatus can lag a fresh grant; CoreGraphics' preflight is authoritative for "granted".
  if (status !== 'granted' && coreGraphics() && cg.preflight()) return 'granted';
  return status;
}

/** { microphone, screen } as 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'not-applicable'. */
function getPermissionStatus() {
  if (!isMac) return { microphone: 'not-applicable', screen: 'not-applicable' };
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: screenStatus(),
  };
}

/** Shows the system prompt for `kind` ('microphone' | 'screen') if macOS still allows one. */
async function requestPermission(kind) {
  if (!isMac) return { granted: true };
  if (kind === 'microphone') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return { granted };
  }
  if (kind === 'screen') {
    const granted = coreGraphics() ? cg.request() : false;
    return { granted };
  }
  throw new Error(`Unknown permission: ${kind}`);
}

/** Opens the matching pane of System Settings › Privacy & Security. */
async function openPermissionSettings(kind) {
  const url = SETTINGS_URLS[kind];
  if (!isMac || !url) return false;
  await shell.openExternal(url);
  return true;
}

module.exports = { getPermissionStatus, requestPermission, openPermissionSettings };
