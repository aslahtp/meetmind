// Calendar manager: the user's calendar sources (up to 5 Google accounts and ICS links, saved in
// config as `calendars`), their events merged into one list, and the poller behind the
// "meeting starting" prompt. Per-source caching means the poller and the Dashboard share
// fetches, and one failing calendar never hides the others.

const { v4: uuidv4 } = require('uuid');
const { getConfig, setConfig } = require('../utils/config');
const logger = require('../utils/logger');
const google = require('./google');
const { fetchIcs } = require('./ics');
const { parseIcs } = require('./ics-parse');
const { mergeEvents, dueToStart, pruneNotified, eventKey, eventTimeMs } = require('./calendar-events');
const {
  MAX_CALENDARS,
  normalizeIcsUrl,
  icsHost,
  cleanName,
  canAddSource,
  isGoogleSignedIn,
  publicSource,
  pickSourceUpdate,
  resolveGoogleClient,
} = require('./calendar-sources');

// How long a source's events are reused. ICS servers regenerate feeds slowly (Google every few
// hours), so polling them harder buys nothing.
const CACHE_TTL_MS = { google: 2 * 60 * 1000, ics: 10 * 60 * 1000 };
// Fetch a little into the past so a meeting in progress is listed, and 36 h ahead (today + tomorrow).
const LOOKBACK_MS = 12 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

// sourceId → { key, at, events, text?, etag?, lastModified? }
const cache = new Map();
// sourceId → Promise of events, so concurrent fetches share one request.
const inflight = new Map();
// sourceId → { state: 'ok'|'error', error, actionUrl, actionLabel, needsSignIn, lastSyncAt, eventCount }
const status = new Map();

let onChanged = () => {};
let pollTimer = null;
const notified = new Map();

function init(options = {}) {
  if (options.onChanged) onChanged = options.onChanged;
}

function sources() {
  return getConfig().calendars;
}

function saveSources(list) {
  setConfig('calendars', list);
  onChanged();
}

function findSource(id) {
  const source = sources().find((s) => s.id === id);
  if (!source) throw new Error('That calendar no longer exists.');
  return source;
}

// Identity of what a cache entry was fetched with; a new URL or token invalidates it.
function cacheKey(source) {
  return source.type === 'ics' ? source.url : `${source.clientId}\n${source.refreshToken}`;
}

function forget(id) {
  cache.delete(id);
  inflight.delete(id);
  status.delete(id);
  google.forgetSource(id);
}

function fetchWindow() {
  const now = Date.now();
  return { from: now - LOOKBACK_MS, to: now + LOOKAHEAD_MS };
}

function tagEvents(events, source) {
  return events.map((e) => ({ ...e, sourceId: source.id, sourceName: source.name, sourceType: source.type }));
}

async function loadIcs(source, previous) {
  const window = fetchWindow();
  const sameFeed = previous && previous.key === cacheKey(source);
  const result = await fetchIcs(source.url, sameFeed ? previous : {});
  // Unchanged feed: re-read the text we have, for the window as it is now.
  const text = result.notModified ? previous.text : result.text;
  const { events, calendarName } = parseIcs(text, window);
  return {
    events,
    calendarName,
    text,
    etag: result.notModified ? previous.etag : result.etag,
    lastModified: result.notModified ? previous.lastModified : result.lastModified,
  };
}

function setStatus(source, next) {
  const before = status.get(source.id);
  status.set(source.id, next);
  if (next.state === 'error' && before?.error !== next.error) {
    logger.warn('Calendar sync failed', { calendar: source.name, type: source.type, error: next.error });
  } else if (next.state === 'ok' && before?.state === 'error') {
    logger.info('Calendar sync works again', { calendar: source.name });
  }
}

/** One source's events (tagged with the source), from cache while fresh. */
async function fetchSource(source, { force = false } = {}) {
  const key = cacheKey(source);
  const cached = cache.get(source.id);
  const fresh = cached && cached.key === key && Date.now() - cached.at < CACHE_TTL_MS[source.type];
  if (fresh && !force) return tagEvents(cached.events, source);
  if (inflight.has(source.id)) return inflight.get(source.id);

  const request = (async () => {
    try {
      let entry;
      if (source.type === 'google') {
        entry = { events: await google.fetchEvents(source, fetchWindow()) };
      } else {
        entry = await loadIcs(source, cached);
      }
      cache.set(source.id, { ...entry, key, at: Date.now() });
      setStatus(source, { state: 'ok', lastSyncAt: Date.now(), eventCount: countUpcoming(entry.events) });
      return tagEvents(entry.events, source);
    } catch (err) {
      setStatus(source, {
        state: 'error',
        error: err.message,
        actionUrl: err.actionUrl || '',
        actionLabel: err.actionLabel || '',
        needsSignIn: !!err.needsSignIn,
        lastSyncAt: status.get(source.id)?.lastSyncAt || 0,
      });
      throw err;
    } finally {
      inflight.delete(source.id);
    }
  })();
  inflight.set(source.id, request);
  return request;
}

function countUpcoming(events) {
  const now = Date.now();
  return events.filter((e) => eventTimeMs(e.end) > now).length;
}

function activeSources(list = sources()) {
  return list.filter((s) => s.enabled !== false && (s.type !== 'google' || isGoogleSignedIn(s)));
}

/**
 * Every enabled calendar's upcoming events, merged. Resolves { events, errors } where errors
 * lists the calendars that failed ({ sourceId, name, message, actionUrl, actionLabel, needsSignIn }).
 */
async function fetchEvents({ force = false } = {}) {
  const list = activeSources();
  const results = await Promise.allSettled(list.map((s) => fetchSource(s, { force })));
  const lists = [];
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') lists.push(result.value);
    else {
      const s = status.get(list[i].id) || {};
      errors.push({
        sourceId: list[i].id,
        name: list[i].name,
        message: result.reason?.message || String(result.reason),
        actionUrl: s.actionUrl || '',
        actionLabel: s.actionLabel || '',
        needsSignIn: !!s.needsSignIn,
      });
    }
  });
  return { events: mergeEvents(lists), errors };
}

/** Sources as the renderer may see them, each with its sync status. */
function list() {
  return {
    max: MAX_CALENDARS,
    sources: sources().map((source) => {
      const pub = publicSource(source);
      let sync = status.get(source.id) || { state: 'pending' };
      if (source.type === 'google' && !isGoogleSignedIn(source)) sync = { state: 'error', error: 'Not signed in.', needsSignIn: true };
      if (source.enabled === false) sync = { ...sync, state: 'off' };
      return { ...pub, status: sync };
    }),
  };
}

// ── Adding, editing and removing ──────────────────────────────────────────────

function assertRoom() {
  if (!canAddSource(sources())) throw new Error(`You can add up to ${MAX_CALENDARS} calendars. Remove one to add another.`);
}

async function validateIcs(url) {
  const { events, calendarName, text, etag, lastModified } = await loadIcs({ type: 'ics', url }, null);
  return { events, calendarName, cacheEntry: { events, text, etag, lastModified, key: url, at: Date.now() } };
}

async function addIcs({ name, url: rawUrl }) {
  assertRoom();
  const url = normalizeIcsUrl(rawUrl);
  if (sources().some((s) => s.type === 'ics' && s.url === url)) throw new Error('That calendar link is already added.');

  const { events, calendarName, cacheEntry } = await validateIcs(url);
  assertRoom();
  const source = {
    id: uuidv4(),
    type: 'ics',
    name: cleanName(name) || cleanName(calendarName) || icsHost(url),
    enabled: true,
    reminders: true,
    url,
  };
  cache.set(source.id, cacheEntry);
  setStatus(source, { state: 'ok', lastSyncAt: Date.now(), eventCount: countUpcoming(events) });
  saveSources([...sources(), source]);
  logger.info('Calendar added', { type: 'ics', host: icsHost(url) });
  return { source: publicSource(source), eventCount: countUpcoming(events) };
}

async function addGoogle({ name, clientId, clientSecret }) {
  assertRoom();
  const client = resolveGoogleClient(sources(), { clientId, clientSecret });
  const { refreshToken, email } = await google.startAuthFlow(client);

  // The same account signed in again: refresh that entry instead of adding a duplicate.
  const current = sources();
  const existing = email && current.find((s) => s.type === 'google' && s.email === email);
  if (existing) {
    const updated = { ...existing, ...client, refreshToken, email };
    forget(existing.id);
    saveSources(current.map((s) => (s.id === existing.id ? updated : s)));
    logger.info('Google Calendar signed in again', { calendar: updated.name });
    return { source: publicSource(updated), existing: true };
  }

  assertRoom();
  const source = {
    id: uuidv4(),
    type: 'google',
    name: cleanName(name) || email || 'Google Calendar',
    enabled: true,
    reminders: true,
    ...client,
    refreshToken,
    email,
  };
  saveSources([...current, source]);
  logger.info('Calendar added', { type: 'google' });
  return { source: publicSource(source) };
}

function addSource(input = {}) {
  if (input.type === 'ics') return addIcs(input);
  if (input.type === 'google') return addGoogle(input);
  throw new Error('Unknown calendar type.');
}

async function updateSource(id, patch) {
  const source = findSource(id);
  const changes = pickSourceUpdate(patch);
  if ('url' in changes && source.type !== 'ics') delete changes.url;

  let cacheEntry = null;
  if (changes.url && changes.url !== source.url) {
    if (sources().some((s) => s.id !== id && s.type === 'ics' && s.url === changes.url)) {
      throw new Error('That calendar link is already added.');
    }
    ({ cacheEntry } = await validateIcs(changes.url));
  }

  const updated = { ...source, ...changes };
  if (cacheEntry) {
    forget(id);
    cache.set(id, cacheEntry);
    setStatus(updated, { state: 'ok', lastSyncAt: Date.now(), eventCount: countUpcoming(cacheEntry.events) });
  }
  saveSources(sources().map((s) => (s.id === id ? updated : s)));
  return { source: publicSource(updated) };
}

function removeSource(id) {
  const source = findSource(id);
  forget(id);
  saveSources(sources().filter((s) => s.id !== id));
  logger.info('Calendar removed', { type: source.type });
  return { removed: true };
}

/** Sign a Google account in again with the OAuth client it already has. */
async function reconnect(id) {
  const source = findSource(id);
  if (source.type !== 'google') throw new Error('Only Google accounts sign in.');
  const { refreshToken, email } = await google.startAuthFlow({ clientId: source.clientId, clientSecret: source.clientSecret });
  const updated = { ...findSource(id), refreshToken, email: email || source.email };
  forget(id);
  saveSources(sources().map((s) => (s.id === id ? updated : s)));
  return { source: publicSource(updated) };
}

function cancelAuth() {
  google.cancelAuthFlow();
}

// ── "Meeting starting" poller ─────────────────────────────────────────────────

async function pollOnce(onMeetingStart) {
  const list = activeSources().filter((s) => s.reminders !== false);
  if (!list.length) return;

  const results = await Promise.allSettled(list.map((s) => fetchSource(s)));
  const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const now = Date.now();
  for (const event of dueToStart(mergeEvents(lists, { now }), now, notified)) {
    notified.set(eventKey(event), eventTimeMs(event.end));
    onMeetingStart(event);
  }
  pruneNotified(notified, now);
}

/**
 * Check every minute (and once now) for a meeting starting within a minute, on the calendars
 * with reminders on. Reads the saved calendars on every tick, so changes apply at once.
 */
function startPoller(onMeetingStart) {
  stopPoller();
  const tick = () => pollOnce(onMeetingStart).catch((err) => logger.warn('Calendar poll failed', { error: err.message }));
  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  pollTimer.unref?.();
  logger.info('Calendar event poller started');
}

function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  init,
  list,
  fetchEvents,
  addSource,
  updateSource,
  removeSource,
  reconnect,
  cancelAuth,
  startPoller,
  stopPoller,
};
