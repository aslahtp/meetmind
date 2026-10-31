// Polls the OS for an active call (see meeting-rules.js) and reports meeting-detected /
// meeting-ended transitions. Ticks are silent; transitions, mic-source problems and a heartbeat
// every 10 minutes are logged, so a detector that has gone quiet can be told from one that broke.

const path = require('path');
const logger = require('../utils/logger');
// Who is on the mic and which windows are open: Win32 APIs on Windows, PulseAudio/PipeWire and
// Electron's window list on Linux (detection/linux.js). macOS has no backend yet.
const backend = process.platform === 'linux' ? require('./linux') : require('./win32');
const { createDetectorState, reduceTick, dismissMeeting, mergeMicUsers, browsersMissingFromRegistry } = require('./meeting-rules');

const POLL_MS = 1500;
const HEARTBEAT_MS = 10 * 60 * 1000;

let timer = null;
let state = createDetectorState();
let handlers = {};
let health = null;

// Counters for one heartbeat period; `prev` carries over what is logged once per run.
function createHealth(now, prev = null) {
  return {
    since: now,
    ticks: 0,
    failedTicks: 0,
    lastTickAt: prev?.lastTickAt ?? 0,
    maxGapMs: 0,                 // longest wait between ticks: shows whether Windows throttles an idle app
    micApps: new Set(),          // every app seen on the mic since the last heartbeat
    sessionsError: prev?.sessionsError ?? null,
    registryGapLogged: prev?.registryGapLogged ?? false,
  };
}

// Logs when the audio-session source fails or recovers, and once per run when it sees a browser on
// the mic that the consent registry doesn't (Windows has stopped updating the registry).
function noteMicSources(mic) {
  if (mic.sessionsError !== health.sessionsError) {
    if (mic.sessionsError) {
      logger.warn(process.platform === 'win32'
        ? 'Audio sessions unreadable; meeting detection is using the consent registry only'
        : 'Audio server unreadable; meeting detection cannot see which apps use the microphone', { error: mic.sessionsError });
    } else {
      logger.info('Audio sessions readable again');
    }
    health.sessionsError = mic.sessionsError;
  }
  // Only Windows has a consent registry to fall behind.
  if (!health.registryGapLogged && process.platform === 'win32') {
    const missing = browsersMissingFromRegistry(mic.sessions, mic.registry);
    if (missing.length) {
      logger.info('Microphone consent registry is not reporting a browser on the mic; using audio sessions', { browsers: missing });
      health.registryGapLogged = true;
    }
  }
}

function logHeartbeat(now) {
  logger.info('Meeting detection heartbeat', {
    minutes: Math.round((now - health.since) / 60000),
    ticks: health.ticks,
    failedTicks: health.failedTicks,
    maxGapMs: health.maxGapMs,
    micApps: [...health.micApps],
    audioSessions: health.sessionsError ? 'failing' : 'ok',
    active: state.active ? state.active.key : null,
  });
  health = createHealth(now, health);
}

function tick() {
  const now = Date.now();
  if (health.lastTickAt) health.maxGapMs = Math.max(health.maxGapMs, now - health.lastTickAt);
  health.lastTickAt = now;
  health.ticks += 1;

  let result;
  try {
    const mic = backend.readMicUsers();
    noteMicSources(mic);
    const micExes = mergeMicUsers(mic.sessions, mic.registry);
    for (const id of micExes) health.micApps.add(id);
    result = reduceTick(state, {
      micExes,
      windows: backend.listVisibleWindows(),
      now,
      selfExe: path.basename(process.execPath),
    });
  } catch (err) {
    health.failedTicks += 1;
    logger.warn('Meeting detection tick failed', { error: err.message });
    return;
  } finally {
    if (now - health.since >= HEARTBEAT_MS) logHeartbeat(now);
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
  if (!backend.isAvailable()) {
    logger.warn('Meeting detection unavailable', { error: backend.getLoadError()?.message });
    return false;
  }
  state = createDetectorState();
  health = createHealth(Date.now());
  const mic = backend.readMicUsers();
  health.sessionsError = mic.sessionsError;
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  logger.info('Meeting detection started', {
    audioSessions: mic.sessionsError ? `failing: ${mic.sessionsError}` : 'ok',
    micApps: mergeMicUsers(mic.sessions, mic.registry),
  });
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

// After sleep: poll at once instead of waiting for the next tick, and don't count the time asleep
// as a gap between ticks. The state machine is time-based, so a meeting that ended while asleep
// ends on this tick and one still running carries on.
function handleResume() {
  if (!timer) return;
  logger.info('Meeting detection resumed after sleep');
  health.lastTickAt = 0;
  tick();
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

module.exports = { start, stop, isRunning, handleResume, dismiss, activeMeeting };
