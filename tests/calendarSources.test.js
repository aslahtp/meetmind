import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  MAX_CALENDARS,
  normalizeIcsUrl,
  canAddSource,
  publicSource,
  pickSourceUpdate,
  resolveGoogleClient,
  migrateLegacyCalendar,
  sanitizeSources,
} = require('../electron/calendar/calendar-sources.js');

const makeId = () => 'new-id';

describe('normalizeIcsUrl', () => {
  it('turns webcal links into https', () => {
    expect(normalizeIcsUrl(' webcal://p01-caldav.icloud.com/published/2/abc ')).toBe('https://p01-caldav.icloud.com/published/2/abc');
    expect(normalizeIcsUrl('webcals://example.com/a.ics')).toBe('https://example.com/a.ics');
  });

  it('adds a missing scheme and keeps http/https', () => {
    expect(normalizeIcsUrl('calendar.google.com/calendar/ical/x/basic.ics')).toBe('https://calendar.google.com/calendar/ical/x/basic.ics');
    expect(normalizeIcsUrl('http://localhost:8080/cal.ics')).toBe('http://localhost:8080/cal.ics');
  });

  it('rejects empty input and other schemes', () => {
    expect(() => normalizeIcsUrl('')).toThrow(/Paste/);
    expect(() => normalizeIcsUrl('file:///C:/cal.ics')).toThrow(/https/);
    expect(() => normalizeIcsUrl('javascript://alert(1)')).toThrow(/https/);
  });
});

describe('limit', () => {
  it(`allows up to ${MAX_CALENDARS} calendars`, () => {
    expect(canAddSource([])).toBe(true);
    expect(canAddSource(Array.from({ length: MAX_CALENDARS - 1 }, (_, i) => ({ id: String(i) })))).toBe(true);
    expect(canAddSource(Array.from({ length: MAX_CALENDARS }, (_, i) => ({ id: String(i) })))).toBe(false);
  });

  it('drops malformed entries and anything past the limit', () => {
    const list = [null, { id: 'x', type: 'caldav' }, ...Array.from({ length: 7 }, (_, i) => ({ id: String(i), type: 'ics' }))];
    expect(sanitizeSources(list).map((s) => s.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(sanitizeSources(undefined)).toEqual([]);
  });
});

describe('publicSource', () => {
  it('shows only the host of an ICS link', () => {
    const out = publicSource({ id: 'a', type: 'ics', name: 'Personal', url: 'https://calendar.google.com/calendar/ical/me%40x.com/private-SECRET/basic.ics?token=T' });
    expect(out).toEqual({ id: 'a', type: 'ics', name: 'Personal', enabled: true, reminders: true, detail: 'calendar.google.com' });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|token/);
  });

  it('never exposes Google secrets', () => {
    const out = publicSource({
      id: 'g', type: 'google', name: 'Work', enabled: false, reminders: false,
      clientId: 'cid', clientSecret: 'SECRET', refreshToken: 'REFRESH', email: 'me@x.com',
    });
    expect(out).toEqual({ id: 'g', type: 'google', name: 'Work', enabled: false, reminders: false, detail: 'me@x.com', clientId: 'cid', signedIn: true });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|REFRESH/);
    expect(publicSource({ id: 'g', type: 'google', name: 'W', clientId: 'cid' }).signedIn).toBe(false);
  });
});

describe('pickSourceUpdate', () => {
  it('keeps only editable fields', () => {
    expect(pickSourceUpdate({ name: '  Team   cal ', enabled: false, refreshToken: 'x', type: 'google' }))
      .toEqual({ name: 'Team cal', enabled: false });
    expect(pickSourceUpdate({ url: 'webcal://a.com/x.ics' })).toEqual({ url: 'https://a.com/x.ics' });
  });

  it('refuses an empty name', () => {
    expect(() => pickSourceUpdate({ name: '  ' })).toThrow(/name/);
  });
});

describe('resolveGoogleClient', () => {
  const sources = [{ id: 'g', type: 'google', clientId: 'cid', clientSecret: 'saved' }];

  it('reuses the saved secret for the same client ID', () => {
    expect(resolveGoogleClient(sources, { clientId: ' cid ', clientSecret: '' })).toEqual({ clientId: 'cid', clientSecret: 'saved' });
    expect(resolveGoogleClient(sources, { clientId: 'cid', clientSecret: 'typed' })).toEqual({ clientId: 'cid', clientSecret: 'typed' });
  });

  it('asks for whatever is missing', () => {
    expect(() => resolveGoogleClient(sources, { clientId: '' })).toThrow(/Client ID/);
    expect(() => resolveGoogleClient(sources, { clientId: 'other' })).toThrow(/Client Secret/);
  });
});

describe('migrateLegacyCalendar', () => {
  it('moves a connected Google Calendar into the list', () => {
    const raw = {
      googleCalendarClientId: 'cid',
      googleCalendarClientSecret: 'sec',
      googleCalendarRefreshToken: 'tok',
      googleCalendarEnabled: true,
      googleCalendarEmail: 'me@x.com',
    };
    expect(migrateLegacyCalendar(raw, makeId)).toEqual({
      set: {
        calendars: [{
          id: 'new-id', type: 'google', name: 'me@x.com', enabled: true, reminders: true,
          clientId: 'cid', clientSecret: 'sec', refreshToken: 'tok', email: 'me@x.com',
        }],
      },
      remove: Object.keys(raw),
    });
  });

  it('keeps entered credentials that were never signed in', () => {
    const { set } = migrateLegacyCalendar({ googleCalendarClientId: 'cid', googleCalendarClientSecret: 'sec', googleCalendarRefreshToken: '' }, makeId);
    expect(set.calendars[0]).toMatchObject({ name: 'Google Calendar', clientId: 'cid', refreshToken: '' });
  });

  it('only removes empty legacy keys', () => {
    expect(migrateLegacyCalendar({ googleCalendarClientId: '', googleCalendarEnabled: false }, makeId))
      .toEqual({ set: {}, remove: ['googleCalendarClientId', 'googleCalendarEnabled'] });
  });

  it('does nothing once migrated', () => {
    expect(migrateLegacyCalendar({ calendars: [] }, makeId)).toEqual({ set: {}, remove: [] });
  });

  it('never overwrites an existing list', () => {
    const { set } = migrateLegacyCalendar({ calendars: [], googleCalendarRefreshToken: 'tok' }, makeId);
    expect(set).toEqual({});
  });
});
