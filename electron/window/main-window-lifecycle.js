// Pure lifecycle of the main (UI) window; main-window.js runs the actions it returns.
//
// The window used to be created once and kept, hidden in the tray, for as long as the app ran.
// A window hidden for hours can come back blank on Windows with its renderer still alive, which
// no crash handler sees. So the window is now disposable:
//   - it is created only when the user opens it (a login launch creates none);
//   - once hidden to the tray it is destroyed after RETIRE_AFTER_MS, unless it holds unsaved
//     edits, and the next open makes a fresh one;
//   - each time it is shown, a health check confirms the renderer answers, React is mounted and
//     something was painted. A failed check, a crashed or hung renderer or a failed load is
//     repaired by a reload, then by replacing the window, then given up on (`failed`, final).
// Recording lives in its own window (audio/capture-window.js), so none of this interrupts one.
// Each load has a generation number; events from an earlier load are ignored.
// No electron imports, so it's unit-testable.

const RETIRE_AFTER_MS = 10 * 60 * 1000;
// At most this many repairs within the window, so a window that keeps failing can't loop.
const MAX_RECOVERIES = 3;
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;

// phase: none (no window) | loading (created or reloading, waiting for `ready`) | ready | failed
// shown: the user wants the window on screen (false = in the tray)
// step:  repairs since the window was last healthy (0 none, 1 reloaded, 2 replaced)
function createLifecycle() {
  return { phase: 'none', gen: 0, shown: false, dirty: false, step: 0, recoveries: [] };
}

function create(state, actions) {
  const gen = state.gen + 1;
  actions.push({ type: 'create', gen, reveal: state.shown });
  return { ...state, phase: 'loading', gen };
}

function fail(state, reason, now, actions) {
  // In the tray nobody is looking: drop the window, the next open makes a new one.
  if (!state.shown) {
    actions.push({ type: 'failed', reason, step: state.step, final: false, next: 'destroy' }, { type: 'destroy' });
    return { ...state, phase: 'none', step: 0 };
  }

  const recoveries = state.recoveries.filter((at) => now - at < RECOVERY_WINDOW_MS);
  if (state.step >= 2 || recoveries.length >= MAX_RECOVERIES) {
    actions.push({ type: 'failed', reason, step: state.step, final: true });
    return { ...state, phase: 'failed', recoveries };
  }

  recoveries.push(now);
  if (state.step === 0) {
    const gen = state.gen + 1;
    actions.push({ type: 'failed', reason, step: 0, final: false, next: 'reload' }, { type: 'reload', gen });
    return { ...state, phase: 'loading', gen, step: 1, recoveries };
  }
  actions.push({ type: 'failed', reason, step: 1, final: false, next: 'replace' }, { type: 'destroy' });
  return create({ ...state, step: 2, recoveries }, actions);
}

// Events (`now` is a timestamp in ms, needed by the ones that can fail):
//   { type: 'open' }                 show and focus the window, creating it if needed
//   { type: 'hide' }                 the window was closed to the tray
//   { type: 'retire' }               the retire timer ran out
//   { type: 'dirty', value }         the renderer holds unsaved edits (or no longer does)
//   { type: 'ready', gen }           the renderer loaded and mounted
//   { type: 'health', gen, ok, reason, now }   result of a health check
//   { type: 'gone', gen, reason, now }   renderer crashed or hung, or the load failed
//   { type: 'timeout', gen, now }    the load never reached `ready`
//   { type: 'closed', gen }          the window was destroyed from outside (quitting)
//   { type: 'recheck' }              check a shown window again (restore, wake, display change)
// Returns { state, actions }.
function reduceMainWindow(prev, event) {
  const actions = [];
  let state = prev;
  const current = event.gen === undefined || event.gen === prev.gen;
  const now = event.now ?? 0;

  switch (event.type) {
    case 'open':
      state = { ...state, shown: true };
      actions.push({ type: 'disarm-retire' });
      if (state.phase === 'none') {
        state = create({ ...state, step: 0 }, actions);
      } else if (state.phase === 'failed') {
        // The user asked again: one fresh attempt with a new window.
        actions.push({ type: 'destroy' });
        state = create({ ...state, step: 0, recoveries: [] }, actions);
      } else {
        actions.push({ type: 'reveal' });
        if (state.phase === 'ready') actions.push({ type: 'check', gen: state.gen });
      }
      break;

    case 'hide':
      if (state.phase === 'none') break;
      state = { ...state, shown: false };
      actions.push({ type: 'hide' });
      if (state.phase === 'failed') {
        actions.push({ type: 'destroy' });
        state = { ...state, phase: 'none', step: 0 };
      } else {
        actions.push({ type: 'arm-retire' });
      }
      break;

    case 'retire':
      if (state.shown || state.phase === 'none') break;
      if (state.dirty) {
        actions.push({ type: 'arm-retire' });   // unsaved edits: keep it, ask again later
      } else {
        actions.push({ type: 'retired' }, { type: 'destroy' });
        state = { ...state, phase: 'none', step: 0 };
      }
      break;

    case 'dirty':
      state = { ...state, dirty: !!event.value };
      break;

    case 'ready':
      if (current && state.phase === 'loading') {
        state = { ...state, phase: 'ready', dirty: false };
        if (state.shown) actions.push({ type: 'check', gen: state.gen });
      }
      break;

    case 'health':
      if (!current || state.phase !== 'ready') break;
      if (event.ok) {
        if (state.step > 0) actions.push({ type: 'recovered', step: state.step });
        state = { ...state, step: 0 };
      } else {
        state = fail(state, event.reason || 'unhealthy', now, actions);
      }
      break;

    case 'gone':
      if (current && (state.phase === 'loading' || state.phase === 'ready')) {
        state = fail(state, event.reason || 'gone', now, actions);
      }
      break;

    case 'timeout':
      if (current && state.phase === 'loading') state = fail(state, 'timeout', now, actions);
      break;

    case 'closed':
      if (current && state.phase !== 'none') {
        actions.push({ type: 'disarm-retire' });
        state = { ...state, phase: 'none', shown: false, step: 0 };
      }
      break;

    case 'recheck':
      if (state.shown && state.phase === 'ready') actions.push({ type: 'check', gen: state.gen });
      break;

    default:
      break;
  }
  return { state, actions };
}

// What a health check found, as a verdict.
//   pong:    the renderer's answer to the ping, or null if none came. { mounted, splash, frame }:
//            React has rendered into #root; the startup splash still covers the page; a frame was
//            produced (requestAnimationFrame fired) while answering.
//   focused: the window has the focus. A window behind others may legitimately draw no frames,
//            so a missing frame only counts when it is in front.
//   blank:   a capture of the top bar was one flat colour (null when no capture was taken).
// Returns { ok, reason?, again? }; `again` asks for one more check once the splash is gone.
function healthVerdict({ pong, focused, blank }) {
  if (!pong) return { ok: false, reason: 'no-answer' };
  if (!pong.mounted) return { ok: false, reason: 'unmounted' };
  if (pong.splash) return { ok: true, again: true };
  if (!pong.frame && focused) return { ok: false, reason: 'no-frame' };
  if (blank) return { ok: false, reason: 'blank' };
  return { ok: true };
}

// True when a BGRA bitmap is one flat colour (within a small tolerance for dithering): nothing
// but the window background was painted. The strip checked always holds the top bar's border.
function isBlankCapture(bitmap, tolerance = 3) {
  if (!bitmap || bitmap.length < 8) return false;
  const [b, g, r] = bitmap;
  for (let i = 4; i + 2 < bitmap.length; i += 4) {
    if (Math.abs(bitmap[i] - b) > tolerance || Math.abs(bitmap[i + 1] - g) > tolerance || Math.abs(bitmap[i + 2] - r) > tolerance) {
      return false;
    }
  }
  return true;
}

module.exports = {
  RETIRE_AFTER_MS, MAX_RECOVERIES, RECOVERY_WINDOW_MS,
  createLifecycle, reduceMainWindow, healthVerdict, isBlankCapture,
};
