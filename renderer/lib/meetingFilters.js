// Pure filter/sort logic for the Meetings page.
// Extracted so it stays testable without React or DOM dependencies.

import { sessionDisplayTitle } from './format.js';
import { isProcessing } from './status.js';

// ── Status filters ──────────────────────────────────────────────────────────

export const STATUS_FILTERS = [
  { key: 'all',        label: 'All',             test: () => true },
  { key: 'attention',  label: 'Needs attention', test: (s) => s.status === 'error' },
  { key: 'processing', label: 'Processing',      test: (s) => isProcessing(s.status) },
  { key: 'notion',     label: 'In Notion',       test: (s) => !!s.notion_page_url },
];

// ── Duration buckets ────────────────────────────────────────────────────────

function durationSeconds(session) {
  if (session.duration_seconds != null) return session.duration_seconds;
  if (session.started_at && session.ended_at) {
    return Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 1000);
  }
  return null;
}

export const DURATION_FILTERS = [
  { key: 'any',    label: 'Any length' },
  { key: 'short',  label: '< 15 min',  max: 15 * 60 },
  { key: 'medium', label: '15–60 min', min: 15 * 60, max: 60 * 60 },
  { key: 'long',   label: '> 1 hour',  min: 60 * 60 },
];

function matchesDuration(session, durationKey) {
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

function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('meet.google.com')) return 'meet';
  if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
  return 'other';
}

export const PLATFORM_FILTERS = [
  { key: 'any',   label: 'Any platform' },
  { key: 'meet',  label: 'Google Meet' },
  { key: 'zoom',  label: 'Zoom' },
  { key: 'teams', label: 'Teams' },
];

function matchesPlatform(session, platformKey) {
  if (platformKey === 'any') return true;
  return detectPlatform(session.meeting_url) === platformKey;
}

// ── Date range ──────────────────────────────────────────────────────────────

/**
 * @param {string|null} dateFrom  YYYY-MM-DD string or falsy
 * @param {string|null} dateTo    YYYY-MM-DD string or falsy
 */
function matchesDateRange(session, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  const ts = session.started_at;
  if (!ts) return false;
  // Compare as local-date strings (YYYY-MM-DD) so the filter boundaries
  // align with the user's calendar day regardless of timezone.
  const sessionDate = new Date(ts);
  const yyyy = sessionDate.getFullYear();
  const mm = String(sessionDate.getMonth() + 1).padStart(2, '0');
  const dd = String(sessionDate.getDate()).padStart(2, '0');
  const localDate = `${yyyy}-${mm}-${dd}`;
  if (dateFrom && localDate < dateFrom) return false;
  if (dateTo && localDate > dateTo) return false;
  return true;
}

// ── Content filters ─────────────────────────────────────────────────────────

export const CONTENT_FILTERS = [
  { key: 'hasActions', label: 'Has action items', test: (s) => (s.notes?.action_items?.length || 0) > 0 },
  { key: 'hasNotes',   label: 'Has notes',        test: (s) => !!(s.notes?.summary || s.notes?.meeting_title) },
];

// ── Text search ─────────────────────────────────────────────────────────────

function matchesQuery(session, query) {
  if (!query) return true;
  const haystack = [
    sessionDisplayTitle(session),
    session.notes?.meeting_title,
    session.notes?.summary,
    session.meeting_url,
  ].filter((v) => typeof v === 'string').join(' ').toLowerCase();
  return haystack.includes(query);
}

// ── Sort options ────────────────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { key: 'newest',   label: 'Newest first' },
  { key: 'oldest',   label: 'Oldest first' },
  { key: 'longest',  label: 'Longest first' },
  { key: 'shortest', label: 'Shortest first' },
  { key: 'title',    label: 'Title A–Z' },
];

function sortSessions(sessions, sortKey) {
  const arr = [...sessions];
  switch (sortKey) {
    case 'oldest':
      return arr.sort((a, b) => new Date(a.started_at || 0) - new Date(b.started_at || 0));
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
      return arr.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
  }
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Apply every filter and sort in one pass.
 *
 * @param {Array} sessions
 * @param {object} opts
 * @param {string}   opts.query       lowercased search text
 * @param {string}   opts.status      STATUS_FILTERS key
 * @param {string}   opts.duration    DURATION_FILTERS key
 * @param {string}   opts.platform    PLATFORM_FILTERS key
 * @param {string}   opts.dateFrom    YYYY-MM-DD or ''
 * @param {string}   opts.dateTo      YYYY-MM-DD or ''
 * @param {string[]} opts.content     array of CONTENT_FILTERS keys currently active
 * @param {string}   opts.sort        SORT_OPTIONS key
 * @returns {Array}
 */
export function filterAndSort(sessions, opts) {
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

  const q = query.trim().toLowerCase();
  const statusFilter = STATUS_FILTERS.find((f) => f.key === status) || STATUS_FILTERS[0];

  const filtered = sessions.filter((s) => {
    if (!statusFilter.test(s)) return false;
    if (!matchesQuery(s, q)) return false;
    if (!matchesDuration(s, duration)) return false;
    if (!matchesPlatform(s, platform)) return false;
    if (!matchesDateRange(s, dateFrom, dateTo)) return false;
    for (const ck of content) {
      const cf = CONTENT_FILTERS.find((c) => c.key === ck);
      if (cf && !cf.test(s)) return false;
    }
    return true;
  });

  return sortSessions(filtered, sort);
}

/**
 * Count sessions per status filter key.
 */
export function statusCounts(sessions) {
  const out = {};
  for (const f of STATUS_FILTERS) out[f.key] = sessions.filter(f.test).length;
  return out;
}

/**
 * True when any filter is active beyond the defaults.
 */
export function hasActiveFilters(opts) {
  return (
    (opts.query || '').trim() !== '' ||
    (opts.status || 'all') !== 'all' ||
    (opts.duration || 'any') !== 'any' ||
    (opts.platform || 'any') !== 'any' ||
    (opts.dateFrom || '') !== '' ||
    (opts.dateTo || '') !== '' ||
    (opts.content || []).length > 0 ||
    (opts.sort || 'newest') !== 'newest'
  );
}
