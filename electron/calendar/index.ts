// Calendar manager: the user's calendar sources (up to 5 Google accounts and ICS links, saved in
// config as `calendars`), their events merged into one list, and the poller behind the
// "meeting starting" prompt. Per-source caching means the poller and the Dashboard share
// fetches, and one failing calendar never hides the others.

// uuid is ESM-only in its types but loads fine through require(); keep it a plain synchronous require.
const { v4: uuidv4 } = require('uuid');
import type {
  CalendarAddInput,
  CalendarEvent,
  CalendarEventsResult,
  CalendarList,
  CalendarSyncError,
  CalendarSyncStatus,
  CalendarUpdatePatch,
  StoredCalendarSource,
} from '../shared';
import { getConfig, setConfig } from '../utils/config';
import logger from '../utils/logger';
import { errorMessage } from '../utils/errors';
import type { CalendarFetchError } from './google';
import { fetchIcs } from './ics';
import { parseIcs } from './ics-parse';

// The Google client libraries load only once a Google calendar is synced or signed in to, so
// startup doesn't pay for them when no Google account is connected.
type GoogleCalendar = typeof import('./google');
let googleModule: GoogleCalendar | null = null;
function google(): GoogleCalendar {
  googleModule ??= require('./google') as GoogleCalendar;
  return googleModule;
}
import { mergeEvents, dueToStart, pruneNotified, eventKey, eventTimeMs, type SourceEvent } from './calendar-events';
import { MAX_CALENDARS, SYNC_INTERVALS, normalizeIcsUrl, icsHost, cleanName, canAddSource, isGoogleSignedIn, publicSource, pickSourceUpdate, resolveGoogleClient } from './calendar-sources';

// A source's events are reused for the user's sync interval (`calendarSyncMinutes`). The poller
// ticks every minute, so allow a little slack or a 1-minute interval would re-read every 2.
const SYNC_SLACK_MS = 5_000;
// Fetch a little into the past so a meeting in progress is listed, and 36 h ahead (today + tomorrow).
const LOOKBACK_MS = 12 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

// What is kept of a source's last fetch. ICS sources also keep the feed text and its validators,
// so an unchanged feed answers 304 and is re-read for the window as it is now.
interface CacheEntry {
  key?: string;
  at?: number;
  events: SourceEvent[];
  calendarName?: string;
  text?: string;
  etag?: string;
  lastModified?: string;
}

// What the cache key is made of.
type KeyedSource = Pick<StoredCalendarSource, 'type' | 'url' | 'clientId' | 'refreshToken'>;

const cache = new Map<string, CacheEntry>();
// sourceId → Promise of events, so concurrent fetches share one request.
const inflight = new Map<string, Promise<CalendarEvent[]>>();
const status = new Map<string, CalendarSyncStatus>();

let onChanged: () => void = () => {};
let pollTimer: ReturnType<typeof setInterval> | null = null;
// eventKey → end time (ms) of the meetings already announced.
const notified = new Map<string, number>();

function init(options: { onChanged?: () => void } = {}) {
  if (options.onChanged) onChanged = options.onChanged;
}

function sources() {
  return getConfig().calendars;
}

function syncIntervalMs() {
  return getConfig().calendarSyncMinutes * 60_000;
}

function saveSources(list: StoredCalendarSource[]) {
  setConfig('calendars', list);
  onChanged();
}

function findSource(id: string) {
  const source = sources().find((s) => s.id === id);
  if (!source) throw new Error('That calendar no longer exists.');
  return source;
}

// Identity of what a cache entry was fetched with; a new URL or token invalidates it.
function cacheKey(source: KeyedSource) {
  return source.type === 'ics' ? source.url : `${source.clientId}\n${source.refreshToken}`;
}

function forget(id: string) {
  cache.delete(id);
  inflight.delete(id);
  status.delete(id);
  googleModule?.forgetSource(id); // nothing to forget if Google was never loaded
}

function fetchWindow() {
  const now = Date.now();
  return { from: now - LOOKBACK_MS, to: now + LOOKAHEAD_MS };
}

function tagEvents(events: SourceEvent[], source: StoredCalendarSource): CalendarEvent[] {
  return events.map((e) => ({ ...e, sourceId: source.id, sourceName: source.name, sourceType: source.type }));
}

async function loadIcs(source: Pick<StoredCalendarSource, 'type' | 'url'>, previous: CacheEntry | null | undefined) {
  const window = fetchWindow();
  const sameFeed = previous && previous.key === cacheKey(source);
  const result = await fetchIcs(source.url!, sameFeed ? previous : {});
  // Unchanged feed: re-read the text we have, for the window as it is now.
  const text = result.notModified ? previous!.text : result.text;
  const { events, calendarName } = parseIcs(text, window);
  return {
    events,
    calendarName,
    text,
    etag: result.notModified ? previous!.etag : result.etag,
    lastModified: result.notModified ? previous!.lastModified : result.lastModified,
  };
}

function setStatus(source: Pick<StoredCalendarSource, 'id' | 'name' | 'type'>, next: CalendarSyncStatus) {
  const before = status.get(source.id);
  status.set(source.id, next);
  if (next.state === 'error' && before?.error !== next.error) {
    logger.warn('Calendar sync failed', { calendar: source.name, type: source.type, error: next.error });
  } else if (next.state === 'ok' && before?.state === 'error') {
    logger.info('Calendar sync works again', { calendar: source.name });
  }
}

/** One source's events (tagged with the source), from cache while younger than `maxAgeMs`. */
async function fetchSource(
  source: StoredCalendarSource,
  { force = false, maxAgeMs = syncIntervalMs() }: { force?: boolean; maxAgeMs?: number } = {}
): Promise<CalendarEvent[]> {
  const key = cacheKey(source);
  const cached = cache.get(source.id);
  const fresh = cached && cached.key === key && Date.now() - cached.at! < maxAgeMs - SYNC_SLACK_MS;
  if (fresh && !force) return tagEvents(cached.events, source);
  if (inflight.has(source.id)) return inflight.get(source.id)!;

  const request = (async () => {
    try {
      let entry: CacheEntry;
      if (source.type === 'google') {
        entry = { events: await google().fetchEvents(source, fetchWindow()) };
      } else {
        entry = await loadIcs(source, cached);
      }
      cache.set(source.id, { ...entry, key, at: Date.now() });
      setStatus(source, { state: 'ok', lastSyncAt: Date.now(), eventCount: countUpcoming(entry.events) });
      return tagEvents(entry.events, source);
    } catch (thrown) {
      const err = thrown as CalendarFetchError;
      setStatus(source, {
        state: 'error',
        error: errorMessage(err),
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

function countUpcoming(events: Array<Pick<SourceEvent, 'end'>>) {
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
async function fetchEvents({ force = false }: { force?: boolean } = {}): Promise<CalendarEventsResult> {
  const list = activeSources();
  const maxAgeMs = syncIntervalMs();
  const results = await Promise.allSettled(list.map((s) => fetchSource(s, { force, maxAgeMs })));
  const lists: CalendarEvent[][] = [];
  const errors: CalendarSyncError[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') lists.push(result.value);
    else {
      const s: Partial<CalendarSyncStatus> = status.get(list[i].id) || {};
      errors.push({
        sourceId: list[i].id,
        name: list[i].name,
        message: errorMessage(result.reason) || String(result.reason),
        actionUrl: s.actionUrl || '',
        actionLabel: s.actionLabel || '',
        needsSignIn: !!s.needsSignIn,
      });
    }
  });
  return { events: mergeEvents(lists), errors };
}

/** Sources as the renderer may see them, each with its sync status. */
function list(): CalendarList {
  return {
    max: MAX_CALENDARS,
    syncMinutes: getConfig().calendarSyncMinutes,
    syncIntervals: SYNC_INTERVALS,
    sources: sources().map((source) => {
      const pub = publicSource(source);
      let sync: CalendarSyncStatus = status.get(source.id) || { state: 'pending' };
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

async function validateIcs(url: string) {
  const { events, calendarName, text, etag, lastModified } = await loadIcs({ type: 'ics', url }, null);
  const cacheEntry: CacheEntry = { events, text, etag, lastModified, key: url, at: Date.now() };
  return { events, calendarName, cacheEntry };
}

async function addIcs({ name, url: rawUrl }: Extract<CalendarAddInput, { type: 'ics' }>) {
  assertRoom();
  const url = normalizeIcsUrl(rawUrl);
  if (sources().some((s) => s.type === 'ics' && s.url === url)) throw new Error('That calendar link is already added.');

  const { events, calendarName, cacheEntry } = await validateIcs(url);
  assertRoom();
  const source: StoredCalendarSource = {
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

async function addGoogle({ name, clientId, clientSecret }: Extract<CalendarAddInput, { type: 'google' }>) {
  assertRoom();
  const client = resolveGoogleClient(sources(), { clientId, clientSecret });
  const { refreshToken, email } = await google().startAuthFlow(client);

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
  const source: StoredCalendarSource = {
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

function addSource(input?: CalendarAddInput) {
  if (input?.type === 'ics') return addIcs(input);
  if (input?.type === 'google') return addGoogle(input);
  throw new Error('Unknown calendar type.');
}

async function updateSource(id: string, patch: CalendarUpdatePatch) {
  const source = findSource(id);
  const changes = pickSourceUpdate(patch);
  if ('url' in changes && source.type !== 'ics') delete changes.url;

  let cacheEntry: CacheEntry | null = null;
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

function removeSource(id: string): { removed: true } {
  const source = findSource(id);
  forget(id);
  saveSources(sources().filter((s) => s.id !== id));
  logger.info('Calendar removed', { type: source.type });
  return { removed: true };
}

/** Sign a Google account in again with the OAuth client it already has. */
async function reconnect(id: string) {
  const source = findSource(id);
  if (source.type !== 'google') throw new Error('Only Google accounts sign in.');
  const { refreshToken, email } = await google().startAuthFlow({ clientId: source.clientId, clientSecret: source.clientSecret });
  const updated = { ...findSource(id), refreshToken, email: email || source.email };
  forget(id);
  saveSources(sources().map((s) => (s.id === id ? updated : s)));
  return { source: publicSource(updated) };
}

function cancelAuth() {
  googleModule?.cancelAuthFlow(); // no sign-in can be waiting if Google was never loaded
}

// ── "Meeting starting" poller ─────────────────────────────────────────────────

// Syncs every enabled calendar whose cache is older than the sync interval, then announces
// meetings starting now on the calendars with reminders on.
async function pollOnce(onMeetingStart: (event: CalendarEvent) => void) {
  const list = activeSources();
  if (!list.length) return;

  const maxAgeMs = syncIntervalMs();
  const results = await Promise.allSettled(list.map((s) => fetchSource(s, { maxAgeMs })));
  const lists: CalendarEvent[][] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && list[i].reminders !== false) lists.push(r.value);
  });
  const now = Date.now();
  for (const event of dueToStart(mergeEvents(lists, { now }), now, notified)) {
    notified.set(eventKey(event), eventTimeMs(event.end));
    onMeetingStart(event);
  }
  pruneNotified(notified, now);
}

/**
 * Every minute (and once now): sync calendars that are due, and check for a meeting starting
 * within a minute on the calendars with reminders on. Reads the saved calendars and sync
 * interval on every tick, so changes apply at once.
 */
function startPoller(onMeetingStart: (event: CalendarEvent) => void) {
  stopPoller();
  const tick = () => pollOnce(onMeetingStart).catch((err) => logger.warn('Calendar poll failed', { error: errorMessage(err) }));
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

export {
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
