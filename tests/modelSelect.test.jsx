import { describe, it, expect } from 'vitest';
import { modelMode } from '../renderer/components/settings/providers/ModelSelect.jsx';

const gemini = {
  models: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.7-flash' }],
  latestModels: [{ id: 'gemini-flash-latest' }, { id: 'gemini-pro-latest' }],
  allowCustomModel: true,
};

describe('modelMode', () => {
  it('puts a saved model under the picker it came from', () => {
    expect(modelMode(gemini, 'gemini-3.7-flash')).toBe('pinned');
    expect(modelMode(gemini, 'gemini-pro-latest')).toBe('latest');
    expect(modelMode(gemini, 'gemini-exp-1234')).toBe('custom');
  });

  it('treats an unset model as pinned (the default)', () => {
    expect(modelMode(gemini, '')).toBe('pinned');
    expect(modelMode(gemini, undefined)).toBe('pinned');
  });

  it('never reports custom for a provider that does not allow it', () => {
    expect(modelMode({ ...gemini, allowCustomModel: false }, 'gemini-exp-1234')).toBe('pinned');
  });
});
