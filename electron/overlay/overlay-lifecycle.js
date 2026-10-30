// Pure lifecycle of the floating meeting overlay window; overlay-window.js runs the actions it
// returns. There is one window per show: it is created when a visible state arrives and destroyed
// once it has closed, so no hidden window is kept for days (a long-lived hidden, transparent
// window can stop painting after sleep, and then shows as nothing at all).
//
// A window counts as up only once its renderer has asked for the state (`ready`), acknowledged
// rendering it (`ack`) and a capture shows it painted something (`verified`). A window that dies,
// fails to load, times out or paints nothing is replaced once; if the replacement fails too, a
// `failed` action with `final: true` tells main to prompt some other way. Each window has a
// generation number, so late events from a window already replaced are ignored.
// No electron imports, so it's unit-testable.

const MAX_RETRIES = 1;

// phase: idle | loading (created, waiting for ready) | revealed (shown, waiting for ack)
//        | shown | closing (hidden state sent, waiting for the close animation) | failed
function createLifecycle() {
  return { phase: 'idle', gen: 0, attempt: 0, wanted: false, mode: null, failedMode: null };
}

function create(state, attempt, actions) {
  const gen = state.gen + 1;
  actions.push({ type: 'create', gen });
  return { ...state, phase: 'loading', gen, attempt, failedMode: null };
}

function fail(state, reason, actions) {
  actions.push({ type: 'destroy', gen: state.gen });
  if (!state.wanted) return { ...state, phase: 'idle' };
  if (state.attempt < MAX_RETRIES) {
    actions.push({ type: 'failed', reason, attempt: state.attempt, final: false });
    return create(state, state.attempt + 1, actions);
  }
  actions.push({ type: 'failed', reason, attempt: state.attempt, final: true });
  return { ...state, phase: 'failed', failedMode: state.mode };
}

// Events:
//   { type: 'show', mode }   a visible state should be on screen (sent on every update)
//   { type: 'hide' }         the overlay should go away
//   { type: 'ready', gen }   the renderer loaded and asked for the state
//   { type: 'ack', gen }     the renderer rendered a visible state
//   { type: 'verified', gen, ok }   capture check: ok = something was painted
//   { type: 'timeout', gen } the window didn't get to `ack` in time
//   { type: 'gone', gen, reason }   renderer crashed, load failed, hung, or the window closed
//   { type: 'closed', gen }  the close animation finished (or its fallback fired)
//   { type: 'recheck' }      verify the shown window again (after sleep or a display change)
// Returns { state, actions }.
function reduceOverlay(prev, event) {
  const actions = [];
  let state = prev;
  const current = event.gen === undefined || event.gen === prev.gen;

  switch (event.type) {
    case 'show':
      state = { ...state, wanted: true, mode: event.mode };
      if (state.phase === 'idle') {
        state = create(state, 0, actions);
      } else if (state.phase === 'failed') {
        // Don't keep rebuilding a window that just failed twice for every progress update;
        // try again only when the overlay moves on to another mode.
        if (event.mode !== prev.failedMode) state = create(state, 0, actions);
      } else if (state.phase === 'closing') {
        actions.push({ type: 'disarm-close' }, { type: 'send' });
        state = { ...state, phase: 'shown' };
      } else if (state.phase === 'revealed' || state.phase === 'shown') {
        actions.push({ type: 'send' });
      }
      // loading: the state goes out when the renderer reports ready.
      break;

    case 'hide':
      state = { ...state, wanted: false };
      if (state.phase === 'shown') {
        actions.push({ type: 'send' }, { type: 'arm-close' });
        state = { ...state, phase: 'closing' };
      } else if (state.phase === 'loading' || state.phase === 'revealed') {
        actions.push({ type: 'destroy', gen: state.gen });
        state = { ...state, phase: 'idle' };
      } else if (state.phase === 'failed') {
        state = { ...state, phase: 'idle', failedMode: null };
      }
      break;

    case 'ready':
      if (current && state.phase === 'loading') {
        actions.push({ type: 'reveal', gen: state.gen });
        state = { ...state, phase: 'revealed' };
      }
      break;

    case 'ack':
      if (current && state.phase === 'revealed') {
        actions.push({ type: 'verify', gen: state.gen });
        if (state.attempt > 0) actions.push({ type: 'recovered', attempt: state.attempt });
        state = { ...state, phase: 'shown' };
      }
      break;

    case 'verified':
      if (current && state.phase === 'shown' && !event.ok) state = fail(state, 'blank', actions);
      break;

    case 'timeout':
      if (current && (state.phase === 'loading' || state.phase === 'revealed')) {
        state = fail(state, 'timeout', actions);
      }
      break;

    case 'gone':
      if (!current || state.phase === 'idle' || state.phase === 'failed') break;
      if (state.phase === 'closing') {
        actions.push({ type: 'destroy', gen: state.gen });
        state = { ...state, phase: 'idle' };
      } else {
        state = fail(state, event.reason || 'gone', actions);
      }
      break;

    case 'closed':
      if (current && state.phase === 'closing') {
        actions.push({ type: 'destroy', gen: state.gen });
        state = { ...state, phase: 'idle' };
      }
      break;

    case 'recheck':
      if (state.phase === 'shown') actions.push({ type: 'verify', gen: state.gen });
      break;

    default:
      break;
  }
  return { state, actions };
}

module.exports = { MAX_RETRIES, createLifecycle, reduceOverlay };
