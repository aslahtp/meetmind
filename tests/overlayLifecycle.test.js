import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { MAX_RETRIES, createLifecycle, reduceOverlay } = require('../electron/overlay/overlay-lifecycle.js');

// Feeds events in order; returns the final state and every action, flattened.
function play(events, start = createLifecycle()) {
  let state = start;
  const actions = [];
  for (const event of events) {
    const result = reduceOverlay(state, event);
    state = result.state;
    actions.push(...result.actions);
  }
  return { state, actions };
}

const types = (actions) => actions.map((a) => a.type);

// A prompt that loads, is acknowledged and verified.
function shownPrompt() {
  return play([
    { type: 'show', mode: 'prompt' },
    { type: 'ready', gen: 1 },
    { type: 'ack', gen: 1 },
    { type: 'verified', gen: 1, ok: true },
  ]).state;
}

describe('overlay lifecycle', () => {
  it('creates a window, reveals it on ready and verifies it after the ack', () => {
    const { state, actions } = play([
      { type: 'show', mode: 'prompt' },
      { type: 'ready', gen: 1 },
      { type: 'ack', gen: 1 },
      { type: 'verified', gen: 1, ok: true },
    ]);
    expect(types(actions)).toEqual(['create', 'reveal', 'verify']);
    expect(state.phase).toBe('shown');
  });

  it('waits for ready before sending state to a window still loading', () => {
    const { actions } = play([{ type: 'show', mode: 'prompt' }, { type: 'show', mode: 'prompt' }]);
    expect(types(actions)).toEqual(['create']);
  });

  it('sends later updates to the shown window without recreating it', () => {
    const { state, actions } = play([{ type: 'show', mode: 'recording' }], shownPrompt());
    expect(types(actions)).toEqual(['send']);
    expect(state.gen).toBe(1);
  });

  it('replaces a window whose renderer died, then logs the recovery', () => {
    const { state, actions } = play([
      { type: 'gone', gen: 1, reason: 'render-process-gone' },
      { type: 'ready', gen: 2 },
      { type: 'ack', gen: 2 },
    ], shownPrompt());
    expect(types(actions)).toEqual(['destroy', 'failed', 'create', 'reveal', 'verify', 'recovered']);
    expect(actions.find((a) => a.type === 'failed')).toMatchObject({ reason: 'render-process-gone', final: false });
    expect(state).toMatchObject({ phase: 'shown', gen: 2 });
  });

  it('replaces a window that painted nothing', () => {
    const { actions } = play([
      { type: 'show', mode: 'prompt' },
      { type: 'ready', gen: 1 },
      { type: 'ack', gen: 1 },
      { type: 'verified', gen: 1, ok: false },
    ]);
    expect(actions.find((a) => a.type === 'failed')).toMatchObject({ reason: 'blank', final: false });
    expect(types(actions).at(-1)).toBe('create');
  });

  it(`gives up after ${MAX_RETRIES} retry with a final failure`, () => {
    const { state, actions } = play([
      { type: 'show', mode: 'prompt' },
      { type: 'timeout', gen: 1 },
      { type: 'ready', gen: 2 },
      { type: 'timeout', gen: 2 },
    ]);
    const failures = actions.filter((a) => a.type === 'failed');
    expect(failures.map((f) => f.final)).toEqual([false, true]);
    expect(state.phase).toBe('failed');
    expect(types(actions).at(-1)).toBe('failed');
  });

  it('does not rebuild a failed window for every update of the same mode, only for a new mode', () => {
    const failed = play([
      { type: 'show', mode: 'processing' },
      { type: 'timeout', gen: 1 },
      { type: 'timeout', gen: 2 },
    ]).state;
    expect(types(play([{ type: 'show', mode: 'processing' }], failed).actions)).toEqual([]);
    expect(types(play([{ type: 'show', mode: 'complete' }], failed).actions)).toEqual(['create']);
  });

  it('ignores late events from a window that was already replaced', () => {
    const replaced = play([{ type: 'timeout', gen: 1 }], play([{ type: 'show', mode: 'prompt' }]).state).state;
    const { state, actions } = play([
      { type: 'ack', gen: 1 },
      { type: 'gone', gen: 1, reason: 'window-closed' },
      { type: 'timeout', gen: 1 },
    ], replaced);
    expect(actions).toEqual([]);
    expect(state).toMatchObject({ phase: 'loading', gen: 2 });
  });

  it('closes a shown window through its animation, then destroys it', () => {
    const { state, actions } = play([{ type: 'hide' }, { type: 'closed', gen: 1 }], shownPrompt());
    expect(types(actions)).toEqual(['send', 'arm-close', 'destroy']);
    expect(state.phase).toBe('idle');
  });

  it('destroys a window that is hidden before it was acknowledged', () => {
    const { state, actions } = play([
      { type: 'show', mode: 'prompt' },
      { type: 'ready', gen: 1 },
      { type: 'hide' },
    ]);
    expect(types(actions)).toEqual(['create', 'reveal', 'destroy']);
    expect(state.phase).toBe('idle');
  });

  it('reopens a closing window when a visible state arrives', () => {
    const { state, actions } = play([{ type: 'hide' }, { type: 'show', mode: 'prompt' }, { type: 'closed', gen: 1 }], shownPrompt());
    expect(types(actions)).toEqual(['send', 'arm-close', 'disarm-close', 'send']);
    expect(state.phase).toBe('shown');
  });

  it('does not recreate a window that dies while closing or after being hidden', () => {
    const closing = play([{ type: 'hide' }], shownPrompt()).state;
    const { state, actions } = play([{ type: 'gone', gen: 1, reason: 'render-process-gone' }], closing);
    expect(types(actions)).toEqual(['destroy']);
    expect(state.phase).toBe('idle');

    const hiddenWhileRetrying = play([{ type: 'show', mode: 'prompt' }, { type: 'timeout', gen: 1 }, { type: 'hide' }]);
    expect(hiddenWhileRetrying.state.phase).toBe('idle');
    expect(types(play([{ type: 'timeout', gen: 2 }], hiddenWhileRetrying.state).actions)).toEqual([]);
  });

  it('re-verifies only a shown window', () => {
    expect(types(play([{ type: 'recheck' }], shownPrompt()).actions)).toEqual(['verify']);
    expect(types(play([{ type: 'recheck' }]).actions)).toEqual([]);
  });
});
