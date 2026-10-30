// Pure rules for the calendar sources saved in config (`calendars`): the limit, ICS URL checks,
// what the renderer may see of a source, and the migration from the single pre-4.15 Google
// Calendar keys. No electron imports, so it's unit-testable.

const MAX_CALENDARS = 5;
const SOURCE_TYPES = ['google', 'ics'];
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
function normalizeIcsUrl(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('Paste the calendar’s ICS link.');
  text = text.replace(/^webcals?:\/\//i, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url;
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

function icsHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

function canAddSource(sources) {
  return (sources || []).length < MAX_CALENDARS;
}

function isGoogleSignedIn(source) {
  return !!(source && source.type === 'google' && source.refreshToken && source.clientId && source.clientSecret);
}

/**
 * What the renderer sees of a source: never the ICS URL's path or query (the URL is the
 * credential), the OAuth client secret or the refresh token.
 */
function publicSource(source) {
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
function pickSourceUpdate(patch = {}) {
  const out = {};
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
function resolveGoogleClient(sources, { clientId, clientSecret } = {}) {
  const id = String(clientId || '').trim();
  let secret = String(clientSecret || '').trim();
  if (!id) throw new Error('Enter your OAuth Client ID.');
  if (!secret) {
    const match = (sources || []).find((s) => s.type === 'google' && s.clientId === id && s.clientSecret);
    if (match) secret = match.clientSecret;
  }
  if (!secret) throw new Error('Enter your OAuth Client Secret.');
  return { clientId: id, clientSecret: secret };
}

/**
 * Pre-4.15 configs had one Google Calendar in five top-level keys. Turn them into the first
 * entry of `calendars`, then drop them. Returns { set, remove }, both empty when there is
 * nothing to migrate, so it is cheap to call on every config read.
 */
function migrateLegacyCalendar(raw, makeId) {
  const set = {};
  const remove = LEGACY_GOOGLE_KEYS.filter((key) => raw[key] !== undefined);
  if (!remove.length) return { set, remove };

  const clientId = raw.googleCalendarClientId || '';
  const clientSecret = raw.googleCalendarClientSecret || '';
  const refreshToken = raw.googleCalendarRefreshToken || '';
  const email = raw.googleCalendarEmail || '';

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
function sanitizeSources(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && SOURCE_TYPES.includes(s.type))
    .slice(0, MAX_CALENDARS);
}

module.exports = {
  MAX_CALENDARS,
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
