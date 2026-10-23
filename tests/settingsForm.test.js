import { describe, it, expect } from 'vitest';
import { sameValue, changedFields } from '../renderer/lib/settingsForm.js';

describe('sameValue', () => {
  it('compares objects structurally', () => {
    expect(sameValue({ gemini: 'a' }, { gemini: 'a' })).toBe(true);
    expect(sameValue({ gemini: 'a' }, { gemini: 'b' })).toBe(false);
    expect(sameValue('x', 'x')).toBe(true);
    expect(sameValue(false, undefined)).toBe(false);
  });
});

describe('changedFields', () => {
  it('returns only the fields that differ from the loaded form', () => {
    const initial = { autoLaunch: false, theme: 'light', llmModels: { gemini: 'a' } };
    const form = { autoLaunch: false, theme: 'dark', llmModels: { gemini: 'a' } };
    expect(changedFields(form, initial)).toEqual({ theme: 'dark' });
  });

  it('includes changed object values', () => {
    expect(changedFields({ llmModels: { gemini: 'b' } }, { llmModels: { gemini: 'a' } })).toEqual({ llmModels: { gemini: 'b' } });
  });

  it('returns nothing when nothing changed', () => {
    expect(changedFields({ autoLaunch: true }, { autoLaunch: true })).toEqual({});
  });

  it('returns the whole form when there is no loaded form to compare with', () => {
    expect(changedFields({ autoLaunch: true }, null)).toEqual({ autoLaunch: true });
  });
});
