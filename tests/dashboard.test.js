import { describe, it, expect, vi } from 'vitest';
import { greeting } from '../renderer/lib/greeting.js';
import { audioMeter } from '../renderer/lib/audioMeter.js';

describe('greeting', () => {
  it('returns a non-empty greeting string', () => {
    const text = greeting();
    expect(typeof text).toBe('string');
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe('audioMeter', () => {
  it('defaults to 0 for mic and system', () => {
    audioMeter.reset();
    expect(audioMeter.getLevels()).toEqual({ mic: 0, system: 0 });
  });

  it('notifies subscribers when levels are emitted', () => {
    const listener = vi.fn();
    const unsubscribe = audioMeter.subscribe(listener);

    audioMeter.emit({ mic: 0.42, system: 0.88 });

    expect(listener).toHaveBeenCalledWith({ mic: 0.42, system: 0.88 });
    expect(audioMeter.getLevels()).toEqual({ mic: 0.42, system: 0.88 });

    unsubscribe();
  });

  it('stops notifying unsubscribed listeners', () => {
    const listener = vi.fn();
    const unsubscribe = audioMeter.subscribe(listener);

    unsubscribe();
    audioMeter.emit({ mic: 0.1, system: 0.2 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('resets levels back to 0 and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = audioMeter.subscribe(listener);

    audioMeter.emit({ mic: 0.75, system: 0.5 });
    expect(audioMeter.getLevels()).toEqual({ mic: 0.75, system: 0.5 });

    audioMeter.reset();
    expect(audioMeter.getLevels()).toEqual({ mic: 0, system: 0 });
    expect(listener).toHaveBeenLastCalledWith({ mic: 0, system: 0 });

    unsubscribe();
  });
});
