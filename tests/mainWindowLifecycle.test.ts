import { describe, it, expect } from 'vitest';

import {
  MAX_RECOVERIES, RECOVERY_WINDOW_MS, createLifecycle, reduceMainWindow, healthVerdict, isBlankCapture,
} from '../electron/window/main-window-lifecycle';

// Feeds events in order; returns the final state and every action, flattened.
function play(events: any, start = createLifecycle()) {
  let state = start;
  const actions = [];
  for (const event of events) {
    const result = reduceMainWindow(state, event);
    state = result.state;
    actions.push(...result.actions);
  }
  return { state, actions };
}

const types = (actions: any) => actions.map((a: any) => a.type);

// A window that was opened, loaded and passed its first health check.
function healthyWindow() {
  return play([
    { type: 'open' },
    { type: 'ready', gen: 1 },
    { type: 'health', gen: 1, ok: true, now: 0 },
  ]).state;
}

describe('main window lifecycle', () => {
  it('has no window until it is opened, then creates one and checks it once ready', () => {
    expect(createLifecycle().phase).toBe('none');
    const { state, actions } = play([{ type: 'open' }, { type: 'ready', gen: 1 }]);
    expect(types(actions)).toEqual(['disarm-retire', 'create', 'check']);
    expect(actions[1]).toMatchObject({ gen: 1, reveal: true });
    expect(state).toMatchObject({ phase: 'ready', shown: true, gen: 1 });
  });

  it('reveals and re-checks an existing window instead of creating another', () => {
    const { state, actions } = play([{ type: 'open' }], healthyWindow());
    expect(types(actions)).toEqual(['disarm-retire', 'reveal', 'check']);
    expect(state.gen).toBe(1);
  });

  it('hides to the tray and retires the window when the timer runs out', () => {
    const hidden = play([{ type: 'hide' }], healthyWindow());
    expect(types(hidden.actions)).toEqual(['hide', 'arm-retire']);
    expect(hidden.state).toMatchObject({ phase: 'ready', shown: false });

    const retired = play([{ type: 'retire' }], hidden.state);
    expect(types(retired.actions)).toEqual(['retired', 'destroy']);
    expect(retired.state.phase).toBe('none');
  });

  it('makes a new window when opened again after retiring', () => {
    const { state, actions } = play([{ type: 'hide' }, { type: 'retire' }, { type: 'open' }], healthyWindow());
    expect(types(actions).slice(-2)).toEqual(['disarm-retire', 'create']);
    expect(state).toMatchObject({ phase: 'loading', gen: 2, shown: true });
  });

  it('keeps a hidden window that holds unsaved edits, and retires it once they are saved', () => {
    const dirty = play([{ type: 'dirty', value: true }, { type: 'hide' }, { type: 'retire' }], healthyWindow());
    expect(types(dirty.actions)).toEqual(['hide', 'arm-retire', 'arm-retire']);
    expect(dirty.state.phase).toBe('ready');

    const saved = play([{ type: 'dirty', value: false }, { type: 'retire' }], dirty.state);
    expect(saved.state.phase).toBe('none');
  });

  it('does not retire a window that was opened again before the timer ran out', () => {
    const { state, actions } = play([{ type: 'hide' }, { type: 'open' }, { type: 'retire' }], healthyWindow());
    expect(types(actions)).toEqual(['hide', 'arm-retire', 'disarm-retire', 'reveal', 'check']);
    expect(state.phase).toBe('ready');
  });

  it('reloads a shown window that fails its health check, and logs the recovery', () => {
    const failed = play([{ type: 'health', gen: 1, ok: false, reason: 'blank', now: 1000 }], healthyWindow());
    expect(types(failed.actions)).toEqual(['failed', 'reload']);
    expect(failed.actions[0]).toMatchObject({ reason: 'blank', final: false, next: 'reload' });
    expect(failed.state).toMatchObject({ phase: 'loading', gen: 2, step: 1 });

    const recovered = play([{ type: 'ready', gen: 2 }, { type: 'health', gen: 2, ok: true, now: 2000 }], failed.state);
    expect(types(recovered.actions)).toEqual(['check', 'recovered']);
    expect(recovered.state).toMatchObject({ phase: 'ready', step: 0 });
  });

  it('replaces the window when the reload did not help, then gives up', () => {
    const { state, actions } = play([
      { type: 'gone', gen: 1, reason: 'render-process-gone', now: 1000 },   // → reload (gen 2)
      { type: 'timeout', gen: 2, now: 2000 },                               // → new window (gen 3)
      { type: 'ready', gen: 3 },
      { type: 'health', gen: 3, ok: false, reason: 'blank', now: 3000 },    // → give up
    ], healthyWindow());
    expect(types(actions)).toEqual(['failed', 'reload', 'failed', 'destroy', 'create', 'check', 'failed']);
    expect(actions[2]).toMatchObject({ reason: 'timeout', next: 'replace' });
    expect(actions[6]).toMatchObject({ reason: 'blank', final: true });
    expect(state.phase).toBe('failed');
  });

  it('tries once more with a new window when the user opens a failed one', () => {
    const failed = { ...healthyWindow(), phase: 'failed', step: 2, recoveries: [1, 2] };
    const { state, actions } = play([{ type: 'open' }], failed);
    expect(types(actions)).toEqual(['disarm-retire', 'destroy', 'create']);
    expect(state).toMatchObject({ phase: 'loading', step: 0, recoveries: [] });
  });

  it('stops repairing a window that keeps failing between healthy checks', () => {
    let state = healthyWindow();
    let gen = 1;
    for (let i = 0; i < MAX_RECOVERIES; i++) {
      // Fails, is reloaded, comes back healthy: each round costs one recovery.
      const round = play([
        { type: 'gone', gen, reason: 'render-process-gone', now: i * 1000 },
        { type: 'ready', gen: gen + 1 },
        { type: 'health', gen: gen + 1, ok: true, now: i * 1000 + 500 },
      ], state);
      expect(types(round.actions)).toContain('reload');
      state = round.state;
      gen += 1;
    }
    const last = play([{ type: 'gone', gen, reason: 'render-process-gone', now: MAX_RECOVERIES * 1000 }], state);
    expect(last.actions).toEqual([expect.objectContaining({ type: 'failed', final: true })]);

    // Long after, the count has run out and a failure is repaired again.
    const later = play([{ type: 'gone', gen, reason: 'render-process-gone', now: RECOVERY_WINDOW_MS * 2 }], state);
    expect(types(later.actions)).toEqual(['failed', 'reload']);
  });

  it('just drops a window that fails while hidden in the tray', () => {
    const hidden = play([{ type: 'hide' }], healthyWindow()).state;
    const { state, actions } = play([{ type: 'gone', gen: 1, reason: 'render-process-gone', now: 0 }], hidden);
    expect(types(actions)).toEqual(['failed', 'destroy']);
    expect(state.phase).toBe('none');
  });

  it('ignores late events from an earlier load', () => {
    const reloaded = play([{ type: 'health', gen: 1, ok: false, reason: 'blank', now: 0 }], healthyWindow()).state;
    const { state, actions } = play([
      { type: 'health', gen: 1, ok: false, reason: 'blank', now: 10 },
      { type: 'gone', gen: 1, reason: 'unresponsive', now: 20 },
      { type: 'ready', gen: 1 },
    ], reloaded);
    expect(actions).toEqual([]);
    expect(state).toEqual(reloaded);
  });

  it('re-checks only a window that is on screen', () => {
    expect(types(play([{ type: 'recheck' }], healthyWindow()).actions)).toEqual(['check']);
    expect(play([{ type: 'recheck' }]).actions).toEqual([]);
    const hidden = play([{ type: 'hide' }], healthyWindow()).state;
    expect(play([{ type: 'recheck' }], hidden).actions).toEqual([]);
  });

  it('forgets the window when it is destroyed from outside', () => {
    const { state } = play([{ type: 'closed', gen: 1 }], healthyWindow());
    expect(state).toMatchObject({ phase: 'none', shown: false });
  });
});

describe('healthVerdict', () => {
  const pong = { mounted: true, splash: false, frame: true };

  it('passes a mounted window that drew a frame and painted its top bar', () => {
    expect(healthVerdict({ pong, focused: true, blank: false })).toEqual({ ok: true });
    // A capture that could not be taken is not held against the window.
    expect(healthVerdict({ pong, focused: true, blank: null })).toEqual({ ok: true });
  });

  it('fails a renderer that does not answer or has nothing mounted', () => {
    expect(healthVerdict({ pong: null, focused: true, blank: null })).toEqual({ ok: false, reason: 'no-answer' });
    expect(healthVerdict({ pong: { ...pong, mounted: false }, focused: true, blank: null }))
      .toEqual({ ok: false, reason: 'unmounted' });
  });

  it('asks again later while the startup splash covers the page', () => {
    expect(healthVerdict({ pong: { ...pong, splash: true, frame: false }, focused: true, blank: null }))
      .toEqual({ ok: true, again: true });
  });

  it('counts a missing frame only for the window in front', () => {
    const noFrame = { ...pong, frame: false };
    expect(healthVerdict({ pong: noFrame, focused: true, blank: false })).toEqual({ ok: false, reason: 'no-frame' });
    expect(healthVerdict({ pong: noFrame, focused: false, blank: false })).toEqual({ ok: true });
  });

  it('fails a window whose top bar is one flat colour', () => {
    expect(healthVerdict({ pong, focused: false, blank: true })).toEqual({ ok: false, reason: 'blank' });
  });
});

describe('isBlankCapture', () => {
  const pixels = (...colours: any[]) => Uint8Array.from(colours.flatMap(([b, g, r]) => [b, g, r, 255]));
  const paper = [237, 245, 248];

  it('is true for one flat colour, allowing for dithering', () => {
    expect(isBlankCapture(pixels(paper, paper, paper, paper))).toBe(true);
    expect(isBlankCapture(pixels(paper, [238, 244, 249], paper))).toBe(true);
  });

  it('is false as soon as something else was painted', () => {
    expect(isBlankCapture(pixels(paper, paper, [0, 0, 0], paper))).toBe(false);
  });

  it('is false for an empty capture, which says nothing', () => {
    expect(isBlankCapture(new Uint8Array(0))).toBe(false);
    expect(isBlankCapture(null)).toBe(false);
  });
});
