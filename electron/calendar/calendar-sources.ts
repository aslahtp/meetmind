// Pure rules for the calendar sources saved in config (`calendars`): the limit, ICS URL checks,
// what the renderer may see of a source, and the migration from the single pre-4.15 Google
// Calendar keys. No electron imports, so it's unit-testable.

import type { CalendarSource, CalendarSyncMinutes, CalendarUpdatePatch, StoredCalendarSource } from '../shared';

const MAX_CALENDARS = 5;
// How often calendars are re-read, in minutes (Settings › Integrations › Calendars › Sync every).
const SYNC_INTERVALS: CalendarSyncMinutes[] = [1, 5, 10, 15, 30, 60];
const DEFAULT_SYNC_MINUTES: CalendarSyncMinutes = 5;
const SOURCE_TYPES: string[] = ['google', 'ics'];
const NAME_MAX_LENGTH = 60;

const LEGACY_GOOGLE_KEYS = [
  'googleCalendarClientId',
  'googleCalendarClientSecret',
  'googleCalendarRefreshToken',
  'googleCalendarEnabled',
  'googleCalendarEmail',
];

/**
 * Turn what the user pasted into a fetchable https/http URL. `webcal://` (what Apple and
 * Outlook hand out) is the same feed over https. Throws a message fit for the UI.
 */
function normalizeIcsUrl(input: unknown) {
  let text = String(input || '').trim();
  if (!text) throw new Error('Paste the calendar’s ICS link.');
  text = text.replace(/^webcals?:\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That doesn’t look like a link. Copy the full ICS address from your calendar.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Calendar links must start with https://, http:// or webcal://.');
  }
  if (!url.hostname) throw new Error('That link has no address. Copy the full ICS address from your calendar.');
  return url.toString();
}

function icsHost(url: string | undefined) {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

function cleanName(name: unknown) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

function normalizeSyncMinutes(value: unknown): CalendarSyncMinutes {
  const minutes = Number(value) as CalendarSyncMinutes;
  return SYNC_INTERVALS.includes(minutes) ? minutes : DEFAULT_SYNC_MINUTES;
}

function canAddSource(sources: unknown[] | null | undefined) {
  return (sources || []).length < MAX_CALENDARS;
}

function isGoogleSignedIn(source: StoredCalendarSource | null | undefined) {
  return !!(source && source.type === 'google' && source.refreshToken && source.clientId && source.clientSecret);
}

/**
 * What the renderer sees of a source: never the ICS URL's path or query (the URL is the
 * credential), the OAuth client secret or the refresh token.
 */
function publicSource(source: StoredCalendarSource): CalendarSource {
  const base = {
    id: source.id,
    type: source.type,
    name: source.name,
    enabled: source.enabled !== false,
    reminders: source.reminders !== false,
  };
  if (source.type === 'google') {
    return {
      ...base,
      detail: source.email || '',
      clientId: source.clientId || '',
      signedIn: isGoogleSignedIn(source),
    };
  }
  return { ...base, detail: icsHost(source.url) };
}

/** Only the fields a user may change on an existing source; anything else is dropped. */
/** What `pickSourceUpdate` lets through (the input is the renderer's, so every value is checked). */
interface SourceUpdate {
  name?: string;
  enabled?: boolean;
  reminders?: boolean;
  url?: string;
}

function pickSourceUpdate(patch: CalendarUpdatePatch = {}): SourceUpdate {
  const out: SourceUpdate = {};
  if ('name' in patch) {
    const name = cleanName(patch.name);
    if (!name) throw new Error('Give the calendar a name.');
    out.name = name;
  }
  if ('enabled' in patch) out.enabled = patch.enabled !== false;
  if ('reminders' in patch) out.reminders = patch.reminders !== false;
  if ('url' in patch) out.url = normalizeIcsUrl(patch.url);
  return out;
}

/**
 * OAuth client for a new Google account. A blank secret reuses the one saved with the same
 * client ID, so a second account from the same Google Cloud project needs no copy-paste.
 */
function resolveGoogleClient(
  sources: StoredCalendarSource[] | null | undefined,
  { clientId, clientSecret }: { clientId?: unknown; clientSecret?: unknown } = {}
) {
  const id = String(clientId || '').trim();
  let secret = String(clientSecret || '').trim();
  if (!id) throw new Error('Enter your OAuth Client ID.');
  if (!secret) {
    const match = (sources || []).find((s) => s.type === 'google' && s.clientId === id && s.clientSecret);
    if (match) secret = match.clientSecret!;
  }
  if (!secret) throw new Error('Enter your OAuth Client Secret.');
  return { clientId: id, clientSecret: secret };
}

/**
 * Pre-4.15 configs had one Google Calendar in five top-level keys. Turn them into the first
 * entry of `calendars`, then drop them. Returns { set, remove }, both empty when there is
 * nothing to migrate, so it is cheap to call on every config read.
 */
function migrateLegacyCalendar(raw: Record<string, unknown>, makeId: () => string) {
  const set: { calendars?: StoredCalendarSource[] } = {};
  const remove = LEGACY_GOOGLE_KEYS.filter((key) => raw[key] !== undefined);
  if (!remove.length) return { set, remove };

  const clientId = String(raw.googleCalendarClientId || '');
  const clientSecret = String(raw.googleCalendarClientSecret || '');
  const refreshToken = String(raw.googleCalendarRefreshToken || '');
  const email = String(raw.googleCalendarEmail || '');

  if (!Array.isArray(raw.calendars) && (clientId || clientSecret || refreshToken)) {
    set.calendars = [{
      id: makeId(),
      type: 'google',
      name: email || 'Google Calendar',
      enabled: true,
      reminders: true,
      clientId,
      clientSecret,
      refreshToken,
      email,
    }];
  }
  return { set, remove };
}

/** Drop malformed entries and anything past the limit, e.g. from a hand-edited config file. */
function sanitizeSources(list: unknown): StoredCalendarSource[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && SOURCE_TYPES.includes(s.type))
    .slice(0, MAX_CALENDARS);
}

export {
  MAX_CALENDARS,
  SYNC_INTERVALS,
  DEFAULT_SYNC_MINUTES,
  normalizeSyncMinutes,
  LEGACY_GOOGLE_KEYS,
  normalizeIcsUrl,
  icsHost,
  cleanName,
  canAddSource,
  isGoogleSignedIn,
  publicSource,
  pickSourceUpdate,
  resolveGoogleClient,
  migrateLegacyCalendar,
  sanitizeSources,
};
