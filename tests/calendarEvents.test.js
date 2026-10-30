import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  isMeetingUrl,
  extractMeetingLink,
  eventTimeMs,
  eventKey,
  mergeEvents,
  dueToStart,
  pruneNotified,
} = require('../electron/calendar/calendar-events.js');

const NOW = Date.UTC(2026, 10, 2, 10, 0, 0);
const at = (minutes) => new Date(NOW + minutes * 60_000).toISOString();
const ev = (fields) => ({ id: fields.uid, isAllDay: false, sourceType: 'ics', ...fields });

describe('extractMeetingLink', () => {
  it('prefers conference fields over text', () => {
    expect(extractMeetingLink({
      conferenceUrls: ['', 'https://meet.google.com/aaa-bbbb-ccc'],
      description: 'https://zoom.us/j/1',
    })).toBe('https://meet.google.com/aaa-bbbb-ccc');
  });

  it('finds a known video host in the URL, description, then location', () => {
    expect(extractMeetingLink({ url: 'https://example.com/event', description: 'Dial in: https://us02web.zoom.us/j/123?pwd=x.' }))
      .toBe('https://us02web.zoom.us/j/123?pwd=x');
    expect(extractMeetingLink({ location: 'Room 4 / https://acme.webex.com/meet/jo' })).toBe('https://acme.webex.com/meet/jo');
    expect(extractMeetingLink({ description: '<a href="https://teams.microsoft.com/l/meetup-join/x">Join</a>' }))
      .toBe('https://teams.microsoft.com/l/meetup-join/x');
  });

  it('ignores links that merely contain "meet" or "zoom"', () => {
    expect(extractMeetingLink({ description: 'Agenda: https://docs.example.com/meeting-notes and https://meetup.com/x' })).toBe('');
    expect(isMeetingUrl('https://zoom.us.evil.com/j/1')).toBe(false);
    expect(isMeetingUrl('https://app.cal.com/video/abc')).toBe(true);
    expect(isMeetingUrl('https://cal.com/alex/intro')).toBe(false);
  });
});

describe('eventTimeMs', () => {
  it('reads all-day dates as local midnight', () => {
    expect(eventTimeMs('2026-11-02')).toBe(new Date(2026, 10, 2).getTime());
    expect(eventTimeMs('2026-11-02T10:00:00.000Z')).toBe(NOW);
    expect(Number.isNaN(eventTimeMs(''))).toBe(true);
  });
});

describe('mergeEvents', () => {
  it('keeps meetings in progress and drops finished ones', () => {
    const merged = mergeEvents([[
      ev({ uid: 'done', title: 'Done', start: at(-60), end: at(-1) }),
      ev({ uid: 'live', title: 'Live', start: at(-10), end: at(20) }),
      ev({ uid: 'next', title: 'Next', start: at(30), end: at(60) }),
    ]], { now: NOW });
    expect(merged.map((e) => e.title)).toEqual(['Live', 'Next']);
  });

  it('shows a meeting found in two calendars once, preferring the Google copy', () => {
    const ics = ev({ uid: 'shared@x', title: 'Sync', start: at(5), end: at(35), sourceId: 'b', sourceType: 'ics' });
    const google = ev({ uid: 'shared@x', title: 'Sync', start: at(5), end: at(35), sourceId: 'a', sourceType: 'google' });
    expect(mergeEvents([[ics], [google]], { now: NOW })).toEqual([google]);
    expect(mergeEvents([[google], [ics]], { now: NOW })).toEqual([google]);
  });

  it('keeps separate occurrences of one series', () => {
    const merged = mergeEvents([[
      ev({ uid: 's', id: 's_1', title: 'S', start: at(60), end: at(90) }),
      ev({ uid: 's', id: 's_2', title: 'S', start: at(60 * 24), end: at(60 * 24 + 30) }),
    ]], { now: NOW });
    expect(merged).toHaveLength(2);
  });

  it('sorts across sources and caps the list', () => {
    const merged = mergeEvents([
      [ev({ uid: 'b', title: 'B', start: at(20), end: at(30) })],
      [ev({ uid: 'a', title: 'A', start: at(10), end: at(30) }), ev({ uid: 'c', title: 'C', start: at(40), end: at(50) })],
    ], { now: NOW, limit: 2 });
    expect(merged.map((e) => e.title)).toEqual(['A', 'B']);
  });

  it('keeps an all-day event for the whole day', () => {
    const today = new Date(NOW);
    const pad = (n) => String(n).padStart(2, '0');
    const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const merged = mergeEvents([[ev({ uid: 'h', title: 'Holiday', isAllDay: true, start: day(today), end: day(tomorrow) })]], { now: NOW });
    expect(merged).toHaveLength(1);
  });
});

describe('dueToStart', () => {
  const events = [
    ev({ uid: 'now', start: at(0.5), end: at(30) }),
    ev({ uid: 'late', start: at(-0.9), end: at(30) }),
    ev({ uid: 'later', start: at(5), end: at(30) }),
    ev({ uid: 'old', start: at(-3), end: at(30) }),
    ev({ uid: 'allday', isAllDay: true, start: '2026-11-02', end: '2026-11-03' }),
  ];

  it('returns timed events starting within a minute either side', () => {
    expect(dueToStart(events, NOW, new Map()).map((e) => e.uid)).toEqual(['now', 'late']);
  });

  it('skips events already announced', () => {
    const notified = new Map([[eventKey(events[0]), NOW]]);
    expect(dueToStart(events, NOW, notified).map((e) => e.uid)).toEqual(['late']);
  });

  it('forgets announcements two hours after the meeting ends', () => {
    const notified = new Map([['a', NOW - 3 * 60 * 60_000], ['b', NOW - 60 * 60_000]]);
    pruneNotified(notified, NOW);
    expect([...notified.keys()]).toEqual(['b']);
  });
});
