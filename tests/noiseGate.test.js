import { describe, it, expect } from 'vitest';
import { createNoiseGate } from '../renderer/lib/noiseGate.js';

describe('microphone meter noise gate', () => {
  it('shows nothing for a steady background level', () => {
    const gate = createNoiseGate();
    const shown = Array.from({ length: 200 }, () => gate(0.038));
    expect(Math.max(...shown)).toBe(0);
  });

  it('ignores the background wobbling a little', () => {
    const gate = createNoiseGate();
    const shown = Array.from({ length: 200 }, (_, i) => gate(0.03 + (i % 5) * 0.003));
    expect(Math.max(...shown)).toBe(0);
  });

  it('shows speech above the background', () => {
    const gate = createNoiseGate();
    for (let i = 0; i < 50; i++) gate(0.03);
    expect(gate(0.2)).toBeGreaterThan(0.14);
  });

  it('keeps showing speech through a long stretch of talking', () => {
    const gate = createNoiseGate();
    for (let i = 0; i < 50; i++) gate(0.03);
    let last = 0;
    for (let i = 0; i < 15 * 60; i++) last = gate(0.2);   // a minute without a pause
    expect(last).toBeGreaterThan(0.05);
  });

  it('settles on a quieter background as soon as it hears one', () => {
    const gate = createNoiseGate();
    gate(0.2);                       // the recording started mid-sentence
    expect(gate(0.03)).toBe(0);      // first pause: that is the background
    expect(gate(0.2)).toBeGreaterThan(0.14);
  });
});
