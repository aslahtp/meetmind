import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseIcs, NOT_A_CALENDAR } = require('../electron/calendar/ics-parse.js');

const ics = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR'].join('\r\n');

const NOV = { from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 11, 1) };

// Shaped like Google Calendar's secret iCal address: own VTIMEZONE, a weekly series with a
// skipped and a moved occurrence, a cancelled event, and a lone invited occurrence.
const GOOGLE = ics(
  'X-WR-CALNAME:Work',
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Kolkata',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'TZNAME:IST',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:standup@google.com',
  'DTSTART;TZID=Asia/Kolkata:20261005T100000',
  'DTEND;TZID=Asia/Kolkata:20261005T101500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Asia/Kolkata:20261109T100000',
  'SUMMARY:Standup',
  'DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:standup@google.com',
  'RECURRENCE-ID;TZID=Asia/Kolkata:20261116T100000',
  'DTSTART;TZID=Asia/Kolkata:20261117T110000',
  'DTEND;TZID=Asia/Kolkata:20261117T111500',
  'SUMMARY:Standup (moved)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:standup@google.com',
  'RECURRENCE-ID;TZID=Asia/Kolkata:20261123T100000',
  'DTSTART;TZID=Asia/Kolkata:20261123T100000',
  'DTEND;TZID=Asia/Kolkata:20261123T101500',
  'STATUS:CANCELLED',
  'SUMMARY:Standup',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:offsite@google.com',
  'DTSTART:20261105T090000Z',
  'DTEND:20261105T100000Z',
  'STATUS:CANCELLED',
  'SUMMARY:Offsite',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:their-series@google.com',
  'RECURRENCE-ID:20261103T150000Z',
  'DTSTART:20261103T150000Z',
  'DTEND:20261103T160000Z',
  'SUMMARY:Guest slot',
  'ATTENDEE:mailto:a@example.com',
  'ATTENDEE:mailto:b@example.com',
  'ORGANIZER:mailto:host@example.com',
  'END:VEVENT',
);

// Outlook / Microsoft 365 publish Windows zone names with a matching VTIMEZONE.
const OUTLOOK = ics(
  'BEGIN:VTIMEZONE',
  'TZID:India Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T000000',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E008',
  'DTSTART;TZID=India Standard Time:20261104T153000',
  'DTEND;TZID=India Standard Time:20261104T163000',
  'SUMMARY:Design review',
  'DESCRIPTION:Join: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=1>',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/direct',
  'END:VEVENT',
);

// Apple iCloud: all-day without DTEND, and a floating time (no zone, no Z).
const APPLE = ics(
  'BEGIN:VEVENT',
  'UID:holiday@icloud.com',
  'DTSTART;VALUE=DATE:20261102',
  'SUMMARY:Holiday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:dentist@icloud.com',
  'DTSTART:20261102T090000',
  'DTEND:20261102T093000',
  'SUMMARY:Dentist',
  'END:VEVENT',
);

// Cal.com style: UTC times and a Cal Video link in LOCATION; plus a TZID the feed never defines.
const CALCOM = ics(
  'BEGIN:VEVENT',
  'UID:booking-1@cal.com',
  'DTSTART:20261106T120000Z',
  'DTEND:20261106T123000Z',
  'SUMMARY:Intro call',
  'LOCATION:https://app.cal.com/video/abc123',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:booking-2@cal.com',
  'DTSTART;TZID=Europe/Berlin:20261104T140000',
  'DTEND;TZID=Europe/Berlin:20261104T143000',
  'SUMMARY:Berlin sync',
  'END:VEVENT',
);

describe('parseIcs', () => {
  it('reads the calendar name', () => {
    expect(parseIcs(GOOGLE, NOV).calendarName).toBe('Work');
    expect(parseIcs(APPLE, NOV).calendarName).toBe('');
  });

  it('expands a weekly series in the window, skipping EXDATEs and cancelled occurrences', () => {
    const standups = parseIcs(GOOGLE, NOV).events.filter((e) => e.uid === 'standup@google.com');
    expect(standups.map((e) => e.start)).toEqual([
      '2026-11-02T04:30:00.000Z',
      // 9 Nov excluded by EXDATE; 16 Nov moved to 17 Nov 11:00 IST; 23 Nov cancelled.
      '2026-11-17T05:30:00.000Z',
      '2026-11-30T04:30:00.000Z',
    ]);
    expect(standups[1].title).toBe('Standup (moved)');
    expect(standups[0].end).toBe('2026-11-02T04:45:00.000Z');
    expect(standups[0].meetingLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(new Set(standups.map((e) => e.id)).size).toBe(3);
  });

  it('drops cancelled events and keeps a lone invited occurrence', () => {
    const { events } = parseIcs(GOOGLE, NOV);
    expect(events.find((e) => e.uid === 'offsite@google.com')).toBeUndefined();
    const guest = events.find((e) => e.uid === 'their-series@google.com');
    expect(guest).toMatchObject({
      title: 'Guest slot',
      start: '2026-11-03T15:00:00.000Z',
      attendeeCount: 2,
      organizer: 'host@example.com',
      status: 'confirmed',
      isAllDay: false,
    });
  });

  it('clips to the window', () => {
    const events = parseIcs(GOOGLE, { from: Date.UTC(2026, 10, 2), to: Date.UTC(2026, 10, 3) }).events;
    expect(events.map((e) => e.title)).toEqual(['Standup']);
  });

  it('uses the feed’s VTIMEZONE for Windows zone names and prefers the Teams property', () => {
    const [event] = parseIcs(OUTLOOK, NOV).events;
    expect(event.start).toBe('2026-11-04T10:00:00.000Z');
    expect(event.meetingLink).toBe('https://teams.microsoft.com/l/meetup-join/direct');
  });

  it('handles all-day events without DTEND and floating times', () => {
    const { events } = parseIcs(APPLE, NOV);
    expect(events.find((e) => e.title === 'Holiday')).toMatchObject({ isAllDay: true, start: '2026-11-02', end: '2026-11-03' });
    expect(events.find((e) => e.title === 'Dentist').start).toBe(new Date(2026, 10, 2, 9, 0, 0).toISOString());
  });

  it('reads UTC times, Cal Video links and undefined IANA zones', () => {
    const { events } = parseIcs(CALCOM, NOV);
    expect(events.find((e) => e.title === 'Intro call')).toMatchObject({
      start: '2026-11-06T12:00:00.000Z',
      meetingLink: 'https://app.cal.com/video/abc123',
    });
    // Berlin is UTC+1 in November.
    expect(events.find((e) => e.title === 'Berlin sync').start).toBe('2026-11-04T13:00:00.000Z');
  });

  it('rejects anything that is not a calendar', () => {
    expect(() => parseIcs('<!doctype html><html></html>', NOV)).toThrow(NOT_A_CALENDAR);
    expect(() => parseIcs('', NOV)).toThrow(NOT_A_CALENDAR);
  });

  it('skips a malformed series without losing the rest', () => {
    const text = ics(
      'BEGIN:VEVENT',
      'UID:bad',
      'DTSTART:not-a-date',
      'SUMMARY:Broken',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:good',
      'DTSTART:20261110T100000Z',
      'DTEND:20261110T110000Z',
      'SUMMARY:Fine',
      'END:VEVENT',
    );
    expect(parseIcs(text, NOV).events.map((e) => e.title)).toEqual(['Fine']);
  });
});
