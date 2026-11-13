// Pure filter/sort logic for the Meetings page.
// Extracted so it stays testable without React or DOM dependencies.

import { sessionDisplayTitle } from './format';
import { isProcessing } from './status';
import { searchSessions } from './meetingSearch';
import type { SearchableSession } from './meetingSearch';
import { sessionPlatform } from './platform';

/** The session fields the Meetings page filters and sorts on. A `Session` fits. */
export interface FilterableSession extends SearchableSession {
  status?: string;
  duration_seconds?: number | null;
  ended_at?: string | null;
  notion_page_url?: string | null;
}

/** searchSessions() results by session id; only the score is read here. */
export type SearchScores = ReadonlyMap<string, { score: number }>;

export interface StatusFilter {
  key: string;
  label: string;
  /** Which icon the Meetings page shows for it. */
  icon: string;
  test: (session: FilterableSession) => boolean;
}

// ── Status filters ──────────────────────────────────────────────────────────

export const STATUS_FILTERS: StatusFilter[] = [
  { key: 'all',        label: 'All',             icon: 'layers',      test: () => true },
  { key: 'attention',  label: 'Needs attention', icon: 'alert',       test: (s) => s.status === 'error' },
  { key: 'processing', label: 'Processing',      icon: 'loader',      test: (s) => isProcessing(s.status) },
  { key: 'notion',     label: 'In Notion',       icon: 'bookmark',    test: (s) => !!s.notion_page_url },
];

// ── Duration buckets ────────────────────────────────────────────────────────

function durationSeconds(session: FilterableSession) {
  if (session.duration_seconds != null) return session.duration_seconds;
  if (session.started_at && session.ended_at) {
    return Math.round((+new Date(session.ended_at) - +new Date(session.started_at)) / 1000);
  }
  return null;
}

export interface DurationFilter {
  key: string;
  label: string;
  /** Seconds; a session matches from `min` up to (not including) `max`. */
  min?: number;
  max?: number;
}

export const DURATION_FILTERS: DurationFilter[] = [
  { key: 'any',    label: 'Any length' },
  { key: 'short',  label: 'Under 15 min', max: 15 * 60 },
  { key: 'medium', label: '15–60 min',    min: 15 * 60, max: 60 * 60 },
  { key: 'long',   label: 'Over 1 hour',  min: 60 * 60 },
];

function matchesDuration(session: FilterableSession, durationKey: string) {
  if (durationKey === 'any') return true;
  const secs = durationSeconds(session);
  if (secs == null) return false;
  const bucket = DURATION_FILTERS.find((d) => d.key === durationKey);
  if (!bucket) return true;
  if (bucket.min != null && secs < bucket.min) return false;
  if (bucket.max != null && secs >= bucket.max) return false;
  return true;
}

// ── Platform filter ─────────────────────────────────────────────────────────

export const PLATFORM_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'any',   label: 'Any platform' },
  { key: 'meet',  label: 'Google Meet' },
  { key: 'zoom',  label: 'Zoom' },
  { key: 'teams', label: 'Teams' },
];

function matchesPlatform(session: FilterableSession, platformKey: string) {
  if (platformKey === 'any') return true;
  return sessionPlatform(session)?.key === platformKey;
}

// ── Date range ──────────────────────────────────────────────────────────────

function localIsoDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Relative presets are stored by key, not as dates, so "Last 7 days" stays relative to today
// when the remembered filter is restored later. `days` counts today as the first day.
export const DATE_PRESETS: Array<{ key: string; label: string; days?: number }> = [
  { key: 'any',    label: 'Any time' },
  { key: 'today',  label: 'Today',        days: 1 },
  { key: '7d',     label: 'Last 7 days',  days: 7 },
  { key: '30d',    label: 'Last 30 days', days: 30 },
  { key: 'custom', label: 'Custom' },
];

/**
 * Resolve a date preset (plus the custom range, used only for 'custom') to
 * inclusive YYYY-MM-DD bounds. Either bound may be '' (open-ended).
 */
export function resolveDateRange(preset: string, dateFrom = '', dateTo = '', now = new Date()) {
  if (preset === 'custom') return { dateFrom: dateFrom || '', dateTo: dateTo || '' };
  const p = DATE_PRESETS.find((d) => d.key === preset);
  if (!p?.days) return { dateFrom: '', dateTo: '' };
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (p.days - 1));
  return { dateFrom: localIsoDate(from), dateTo: localIsoDate(now) };
}

/**
 * @param {string|null} dateFrom  YYYY-MM-DD string or falsy
 * @param {string|null} dateTo    YYYY-MM-DD string or falsy
 */
function matchesDateRange(session: FilterableSession, dateFrom: string | null | undefined, dateTo: string | null | undefined) {
  if (!dateFrom && !dateTo) return true;
  const ts = session.started_at;
  if (!ts) return false;
  // Compare as local-date strings (YYYY-MM-DD) so the filter boundaries
  // align with the user's calendar day regardless of timezone.
  const localDate = localIsoDate(new Date(ts));
  if (dateFrom && localDate < dateFrom) return false;
  if (dateTo && localDate > dateTo) return false;
  return true;
}

// ── Content filters ─────────────────────────────────────────────────────────

function lengthOf(value: unknown): number {
  return typeof value === 'string' || Array.isArray(value) ? value.length : 0;
}

function hasNotes(notes: FilterableSession['notes']) {
  if (!notes || typeof notes !== 'object') return false;
  if (typeof notes._rawMarkdown === 'string' && notes._rawMarkdown.trim()) return true;
  if (typeof notes.summary === 'string' && notes.summary.trim()) return true;
  return (['sections', 'topics', 'key_points', 'action_items'] as const).some((k) => lengthOf(notes[k]) > 0);
}

export const CONTENT_FILTERS: Array<{ key: string; label: string; test: (session: FilterableSession) => boolean }> = [
  { key: 'hasActions', label: 'Has action items', test: (s) => lengthOf(s.notes?.action_items) > 0 },
  { key: 'hasNotes',   label: 'Has notes',        test: (s) => hasNotes(s.notes) },
];

// ── Sort options ────────────────────────────────────────────────────────────

export const SORT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'newest',   label: 'Newest first' },
  { key: 'oldest',   label: 'Oldest first' },
  { key: 'longest',  label: 'Longest first' },
  { key: 'shortest', label: 'Shortest first' },
  { key: 'title',    label: 'Title A–Z' },
  // Only offered while searching; ranks by searchSessions() score.
  { key: 'relevance', label: 'Best match' },
];

const newestFirst = (a: FilterableSession, b: FilterableSession) => +new Date(b.started_at || 0) - +new Date(a.started_at || 0);

function sortSessions<S extends FilterableSession>(sessions: S[], sortKey: string, searchResults: SearchScores | null): S[] {
  const arr = [...sessions];
  switch (sortKey) {
    case 'relevance':
      if (!searchResults) return arr.sort(newestFirst);
      return arr.sort((a, b) =>
        (searchResults.get(b.id)?.score || 0) - (searchResults.get(a.id)?.score || 0) || newestFirst(a, b),
      );
    case 'oldest':
      return arr.sort((a, b) => +new Date(a.started_at || 0) - +new Date(b.started_at || 0));
    case 'longest':
      return arr.sort((a, b) => (durationSeconds(b) || 0) - (durationSeconds(a) || 0));
    case 'shortest':
      return arr.sort((a, b) => (durationSeconds(a) || 0) - (durationSeconds(b) || 0));
    case 'title':
      return arr.sort((a, b) =>
        sessionDisplayTitle(a).localeCompare(sessionDisplayTitle(b), undefined, { sensitivity: 'base' }),
      );
    case 'newest':
    default:
      return arr.sort(newestFirst);
  }
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/** What the Meetings page narrows and orders the list by. Anything left out means "no filter". */
export interface FilterOptions {
  /** Search text (see meetingSearch.ts). */
  query?: string;
  /** searchSessions(sessions, query), if already computed. */
  searchResults?: SearchScores | null;
  /** STATUS_FILTERS key. */
  status?: string;
  /** DURATION_FILTERS key. */
  duration?: string;
  /** PLATFORM_FILTERS key. */
  platform?: string;
  /** YYYY-MM-DD or ''. */
  dateFrom?: string;
  /** YYYY-MM-DD or ''. */
  dateTo?: string;
  /** CONTENT_FILTERS keys currently active. */
  content?: string[];
  /** SORT_OPTIONS key. */
  sort?: string;
}

/** Apply every filter and sort in one pass. */
export function filterAndSort<S extends FilterableSession>(sessions: S[], opts: FilterOptions): S[] {
  const {
    query = '',
    status = 'all',
    duration = 'any',
    platform = 'any',
    dateFrom = '',
    dateTo = '',
    content = [],
    sort = 'newest',
  } = opts;

  const searchResults = opts.searchResults !== undefined ? opts.searchResults : searchSessions(sessions, query);
  const statusFilter = STATUS_FILTERS.find((f) => f.key === status) || STATUS_FILTERS[0];

  const filtered = sessions.filter((s) => {
    if (!statusFilter.test(s)) return false;
    if (searchResults && !searchResults.has(s.id)) return false;
    if (!matchesDuration(s, duration)) return false;
    if (!matchesPlatform(s, platform)) return false;
    if (!matchesDateRange(s, dateFrom, dateTo)) return false;
    for (const ck of content) {
      const cf = CONTENT_FILTERS.find((c) => c.key === ck);
      if (cf && !cf.test(s)) return false;
    }
    return true;
  });

  return sortSessions(filtered, sort, searchResults);
}

/**
 * Count sessions per status filter key.
 */
export function statusCounts(sessions: FilterableSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of STATUS_FILTERS) out[f.key] = sessions.filter(f.test).length;
  return out;
}

/**
 * Number of filters set in the Filters panel (date, length, platform, content).
 * Search, status and sort have their own always-visible controls, so they don't count.
 */
export function activeFilterCount(opts: FilterOptions) {
  return (
    ((opts.dateFrom || '') !== '' || (opts.dateTo || '') !== '' ? 1 : 0) +
    ((opts.duration || 'any') !== 'any' ? 1 : 0) +
    ((opts.platform || 'any') !== 'any' ? 1 : 0) +
    (opts.content || []).length
  );
}

/**
 * True when anything narrows the list. Sort only reorders it, so it never counts.
 */
export function hasActiveFilters(opts: FilterOptions) {
  return (
    (opts.query || '').trim() !== '' ||
    (opts.status || 'all') !== 'all' ||
    activeFilterCount(opts) > 0
  );
}
