import { describe, it, expect } from 'vitest';
import {
  formatDurationSeconds,
  formatMinutes,
  formatClock,
  getSessionDuration,
  sessionDisplayTitle,
  initials,
} from '../renderer/lib/format.js';
import { sessionStatus, isProcessing, stageIndex } from '../renderer/lib/status.js';

describe('duration formatting', () => {
  it('formats seconds as s / m s / h m', () => {
    expect(formatDurationSeconds(null)).toBeNull();
    expect(formatDurationSeconds(42)).toBe('42s');
    expect(formatDurationSeconds(75)).toBe('1m 15s');
    expect(formatDurationSeconds(4000)).toBe('1h 6m');
  });

  it('formats minutes', () => {
    expect(formatMinutes(42)).toBe('42m');
    expect(formatMinutes(75)).toBe('1h 15m');
    expect(formatMinutes(undefined)).toBe('0m');
  });

  it('formats a stopwatch clock', () => {
    expect(formatClock(75)).toBe('01:15');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('session helpers', () => {
  it('uses the stored duration, else derives it from start and end', () => {
    expect(getSessionDuration({ duration_seconds: 0 })).toBe(0);
    expect(getSessionDuration({ started_at: '2026-09-25T10:00:00Z', ended_at: '2026-09-25T10:01:30Z' })).toBe(90);
    expect(getSessionDuration({ started_at: '2026-09-25T10:00:00Z' })).toBeNull();
  });

  it('replaces a placeholder title with the meeting date', () => {
    expect(sessionDisplayTitle({ title: '  Planning  ' })).toBe('Planning');
    expect(sessionDisplayTitle({ title: 'Untitled Meeting', started_at: '2026-09-25T12:00:00' })).toBe('Meeting — Sep 25');
    expect(sessionDisplayTitle({})).toBe('Untitled Meeting');
  });

  it('builds initials', () => {
    expect(initials('Asha Menon Nair')).toBe('AN');
    expect(initials('ravi')).toBe('RA');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('status helpers', () => {
  it('maps known statuses and falls back for unknown ones', () => {
    expect(sessionStatus('complete')).toEqual({ label: 'Complete', tone: 'ok' });
    expect(sessionStatus('weird')).toEqual({ label: 'weird', tone: 'neutral' });
    expect(sessionStatus(undefined)).toEqual({ label: 'Unknown', tone: 'neutral' });
  });

  it('knows which statuses are pipeline stages', () => {
    expect(isProcessing('generating')).toBe(true);
    expect(isProcessing('complete')).toBe(false);
    expect(stageIndex('transcribing')).toBe(0);
    expect(stageIndex('uploading')).toBe(2);
    expect(stageIndex('complete')).toBe(3);
    expect(stageIndex('nope')).toBe(-1);
  });
});
