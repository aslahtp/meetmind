import { describe, it, expect } from 'vitest';
import { RETENTION_OPTIONS, retentionPeriod, describeRecordings, deletionToast } from '../renderer/lib/storage';

import {
  RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  normalizeRetentionDays,
  isRecordingId,
  groupRecordingFiles,
  planCleanup,
  planDeleteAll,
  summarize,
} from '../electron/services/storage-rules';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const daysAgo = (n: any) => new Date(NOW - n * DAY).toISOString();

describe('retention setting', () => {
  it('defaults to keeping recordings forever', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(0);
    expect(normalizeRetentionDays(undefined)).toBe(0);
  });

  it('keeps known periods and drops anything else', () => {
    expect(normalizeRetentionDays(30)).toBe(30);
    expect(normalizeRetentionDays('7')).toBe(7);
    expect(normalizeRetentionDays(14)).toBe(0);
    expect(normalizeRetentionDays(-1)).toBe(0);
    expect(normalizeRetentionDays('abc')).toBe(0);
  });

  it('offers the same periods in Settings as the main process accepts', () => {
    expect(RETENTION_OPTIONS.map((o) => o.value)).toEqual(RETENTION_DAYS);
  });
});

describe('isRecordingId', () => {
  it('accepts meeting ids', () => {
    expect(isRecordingId('3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b')).toBe(true);
    expect(isRecordingId('demo-1')).toBe(true);
  });

  it('rejects anything that could name a file outside the recordings folder', () => {
    for (const id of ['', '.', '..', '../x', '..\\x', 'a\u0000b', 'a/b', 'C:x', 'a b', 'x'.repeat(129), null, undefined, 42]) {
      expect(isRecordingId(id)).toBe(false);
    }
  });
});

describe('groupRecordingFiles', () => {
  it('groups .wav and .webm by meeting id and ignores other files', () => {
    const groups = groupRecordingFiles([
      { name: 'a.wav', size: 100, mtimeMs: 1 },
      { name: 'a.webm', size: 50, mtimeMs: 5 },
      { name: 'b.WAV', size: 10, mtimeMs: 2 },
      { name: 'notes.txt', size: 999, mtimeMs: 3 },
      { name: '.wav', size: 1, mtimeMs: 3 },
      { name: 'desktop.ini', size: 1, mtimeMs: 3 },
    ]);
    expect(groups).toEqual([
      { id: 'a', files: ['a.wav', 'a.webm'], bytes: 150, mtimeMs: 5 },
      { id: 'b', files: ['b.WAV'], bytes: 10, mtimeMs: 2 },
    ]);
  });

  it('handles an empty or missing folder', () => {
    expect(groupRecordingFiles([])).toEqual([]);
    expect(groupRecordingFiles(undefined)).toEqual([]);
  });
});

describe('planCleanup', () => {
  const recordings = [
    { id: 'old', files: ['old.wav'], bytes: 300, mtimeMs: NOW },
    { id: 'recent', files: ['recent.wav'], bytes: 200, mtimeMs: NOW - 40 * DAY },
    { id: 'stray-old', files: ['stray-old.wav'], bytes: 50, mtimeMs: NOW - 10 * DAY },
    { id: 'stray-new', files: ['stray-new.wav'], bytes: 5, mtimeMs: NOW - 1 * DAY },
  ];
  const startedAtById = { old: daysAgo(10), recent: daysAgo(2) };

  it('deletes nothing when recordings are kept forever', () => {
    expect(planCleanup({ recordings, startedAtById, retentionDays: 0, now: NOW }))
      .toEqual({ ids: [], count: 0, bytes: 0 });
  });

  it('ages a meeting by its date and a stray file by its modified time', () => {
    const plan = planCleanup({ recordings, startedAtById, retentionDays: 7, now: NOW });
    // "recent" has an old file but a 2-day-old meeting, so it stays.
    expect(plan.ids).toEqual(['old', 'stray-old']);
    expect(plan.count).toBe(2);
    expect(plan.bytes).toBe(350);
  });

  it('keeps a recording exactly at the limit', () => {
    const plan = planCleanup({
      recordings: [{ id: 'edge', files: ['edge.wav'], bytes: 1, mtimeMs: 0 }],
      startedAtById: { edge: daysAgo(7) },
      retentionDays: 7,
      now: NOW,
    });
    expect(plan.count).toBe(0);
  });

  it('never touches a meeting being recorded or processed', () => {
    const plan = planCleanup({ recordings, startedAtById, retentionDays: 1, now: NOW, busyIds: new Set(['old']) });
    expect(plan.ids).toEqual(['recent', 'stray-old']);
    expect(planCleanup({ recordings, startedAtById, retentionDays: 1, now: NOW, busyIds: ['recent'] }).ids)
      .toEqual(['old', 'stray-old']);
  });

  it('falls back to the file time when a meeting date is unreadable', () => {
    const plan = planCleanup({
      recordings: [{ id: 'x', files: ['x.wav'], bytes: 1, mtimeMs: NOW - 100 * DAY }],
      startedAtById: { x: 'not a date' },
      retentionDays: 30,
      now: NOW,
    });
    expect(plan.ids).toEqual(['x']);
  });
});

describe('planDeleteAll', () => {
  it('deletes everything except busy meetings and counts what it kept', () => {
    const recordings = [
      { id: 'a', files: ['a.wav'], bytes: 10, mtimeMs: 0 },
      { id: 'b', files: ['b.wav'], bytes: 20, mtimeMs: 0 },
    ];
    expect(planDeleteAll({ recordings, busyIds: new Set(['b']) }))
      .toEqual({ ids: ['a'], count: 1, bytes: 10, skipped: 1 });
    expect(planDeleteAll({ recordings: [] })).toEqual({ ids: [], count: 0, bytes: 0, skipped: 0 });
  });
});

describe('summarize', () => {
  it('totals every recording and previews what the period would delete', () => {
    const recordings = [
      { id: 'a', files: ['a.wav'], bytes: 1000, mtimeMs: 0 },
      { id: 'b', files: ['b.wav', 'b.webm'], bytes: 500, mtimeMs: 0 },
    ];
    const summary = summarize({
      recordings,
      startedAtById: { a: daysAgo(100), b: daysAgo(1) },
      retentionDays: 90,
      now: NOW,
    });
    expect(summary).toEqual({ count: 2, bytes: 1500, retentionDays: 90, expiring: { count: 1, bytes: 1000 } });
  });
});

describe('Settings › Storage copy', () => {
  it('names retention periods', () => {
    expect(retentionPeriod(1)).toBe('1 day');
    expect(retentionPeriod(30)).toBe('30 days');
    expect(retentionPeriod(365)).toBe('1 year');
    expect(retentionPeriod(14)).toBe('14 days');
  });

  it('describes a set of recordings', () => {
    expect(describeRecordings(1, 2048)).toBe('1 recording (2.0 KB)');
    expect(describeRecordings(3, 440401920)).toBe('3 recordings (420 MB)');
  });

  it('reports what a deletion did', () => {
    expect(deletionToast({ success: true, count: 2, bytes: 1048576, failed: 0 }))
      .toEqual({ message: 'Deleted 2 recordings, freed 1.0 MB.', type: 'success' });
    expect(deletionToast({ success: true, count: 0, bytes: 0, failed: 0 }))
      .toEqual({ message: 'No recordings to delete.', type: 'info' });
    expect(deletionToast({ success: true, count: 1, bytes: 10, failed: 1, skipped: 1 }).type).toBe('warning');
    expect(deletionToast({ success: true, count: 0, bytes: 0, failed: 0, skipped: 1 }).message)
      .toBe('Kept 1 recording that MeetMind is recording or processing.');
    expect(deletionToast({ success: false, error: 'EPERM' }))
      .toEqual({ message: 'Couldn’t delete recordings: EPERM', type: 'error' });
  });
});
