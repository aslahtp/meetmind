// Polls Windows for an active call (see meeting-rules.js) and reports meeting-detected /
// meeting-ended transitions. Only transitions are logged; ticks are silent.

const path = require('path');
const logger = require('../utils/logger');
const win32 = require('./win32');
const { createDetectorState, reduceTick, dismissMeeting } = require('./meeting-rules');

const POLL_MS = 1500;

let timer = null;
let state = createDetectorState();
let handlers = {};

function tick() {
  let result;
  try {
    result = reduceTick(state, {
      micExes: win32.listMicInUseApps(),
      windows: win32.listVisibleWindows(),
      now: Date.now(),
      selfExe: path.basename(process.execPath),
    });
  } catch (err) {
    logger.warn('Meeting detection tick failed', { error: err.message });
    return;
  }
  state = result.state;
  for (const event of result.events) {
    const { key, platform, appLabel, title } = event.meeting;
    if (event.type === 'meeting-detected') {
      logger.info('Meeting detected', { key, platform, app: appLabel, title });
      handlers.onDetected?.(event.meeting);
    } else if (event.type === 'meeting-ended') {
      logger.info('Meeting ended', { key, platform });
      handlers.onEnded?.(event.meeting);
    }
  }
}

function start(nextHandlers = {}) {
  handlers = nextHandlers;
  if (timer) return true;
  if (!win32.isAvailable()) {
    logger.warn('Meeting detection unavailable', { error: win32.getLoadError()?.message });
    return false;
  }
  state = createDetectorState();
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  logger.info('Meeting detection started');
  return true;
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  state = createDetectorState();
  logger.info('Meeting detection stopped');
}

function isRunning() {
  return !!timer;
}

// "Not now": don't prompt for this meeting again until it ends.
function dismiss(key) {
  state = dismissMeeting(state, key);
}

// The meeting currently considered live, if any.
function activeMeeting() {
  if (!state.active) return null;
  const { lastSeenAt: _lastSeenAt, ...meeting } = state.active;
  return meeting;
}

module.exports = { start, stop, isRunning, dismiss, activeMeeting };
