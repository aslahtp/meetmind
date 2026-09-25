import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// CommonJS main-process module; outside Electron, require('electron') is just a path string,
// which is fine because the helpers under test never touch the Electron API.
const require = createRequire(import.meta.url);
const { sanitizeFileNamePart, buildPdfFileName } = require('../electron/services/pdf-export.js');

describe('sanitizeFileNamePart', () => {
  it('strips Windows-reserved characters and hyphenates whitespace', () => {
    expect(sanitizeFileNamePart('Q4: roadmap / sync?')).toBe('Q4-roadmap-sync');
    expect(sanitizeFileNamePart('a<b>c|d*e"f')).toBe('a-b-c-d-e-f');
  });

  it('trims leading/trailing dots and hyphens', () => {
    expect(sanitizeFileNamePart('...hidden - ')).toBe('hidden');
  });

  it('falls back to "Meeting" when nothing is left', () => {
    expect(sanitizeFileNamePart('???')).toBe('Meeting');
    expect(sanitizeFileNamePart(null)).toBe('Meeting');
  });

  it('caps the length at 80 characters without a trailing hyphen', () => {
    const out = sanitizeFileNamePart(`${'a'.repeat(79)} bcd`);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('buildPdfFileName', () => {
  it('prefixes a local date-time stamp', () => {
    const local = new Date(2026, 8, 25, 14, 30);
    expect(buildPdfFileName(local.toISOString(), 'Q4: roadmap')).toBe('2026-09-25-1430-Q4-roadmap.pdf');
  });

  it('uses the current time for a missing or invalid start date', () => {
    expect(buildPdfFileName('not a date', 'x')).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-x\.pdf$/);
    expect(buildPdfFileName(null, '')).toMatch(/-Meeting\.pdf$/);
  });
});
