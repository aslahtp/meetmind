import { describe, it, expect } from 'vitest';
import {
  filterAndSort,
  statusCounts,
  hasActiveFilters,
  STATUS_FILTERS,
  DURATION_FILTERS,
  PLATFORM_FILTERS,
  CONTENT_FILTERS,
  SORT_OPTIONS,
} from '../renderer/lib/meetingFilters.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function session(overrides = {}) {
  return {
    id: 'sess-1',
    title: 'Standup',
    started_at: '2026-10-01T09:00:00Z',
    ended_at: '2026-10-01T09:30:00Z',
    duration_seconds: 1800, // 30 min
    status: 'complete',
    meeting_url: null,
    notion_page_url: null,
    notes: null,
    ...overrides,
  };
}

const SESSIONS = [
  session({ id: 's1', title: 'Morning Standup', started_at: '2026-10-05T09:00:00Z', duration_seconds: 600, status: 'complete' }),
  session({ id: 's2', title: 'Sprint Review', started_at: '2026-10-04T14:00:00Z', duration_seconds: 3600, status: 'complete', meeting_url: 'https://meet.google.com/abc' }),
  session({ id: 's3', title: 'One-on-One', started_at: '2026-10-03T11:00:00Z', duration_seconds: 5400, status: 'complete', notion_page_url: 'https://notion.so/123' }),
  session({ id: 's4', title: 'Bug Triage', started_at: '2026-10-02T10:00:00Z', duration_seconds: 120, status: 'error' }),
  session({ id: 's5', title: 'Retro', started_at: '2026-10-01T16:00:00Z', duration_seconds: 2700, status: 'transcribing', meeting_url: 'https://zoom.us/j/123' }),
  session({
    id: 's6', title: 'Planning', started_at: '2026-09-30T10:00:00Z', duration_seconds: 3000,
    status: 'complete', notes: { summary: 'Planned next sprint', action_items: [{ text: 'Do X' }] },
  }),
];

// ── Export sanity ─────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('STATUS_FILTERS has at least "all"', () => {
    expect(STATUS_FILTERS.find((f) => f.key === 'all')).toBeDefined();
  });
  it('DURATION_FILTERS starts with "any"', () => {
    expect(DURATION_FILTERS[0].key).toBe('any');
  });
  it('PLATFORM_FILTERS starts with "any"', () => {
    expect(PLATFORM_FILTERS[0].key).toBe('any');
  });
  it('CONTENT_FILTERS includes hasActions', () => {
    expect(CONTENT_FILTERS.find((f) => f.key === 'hasActions')).toBeDefined();
  });
  it('SORT_OPTIONS starts with "newest"', () => {
    expect(SORT_OPTIONS[0].key).toBe('newest');
  });
});

// ── statusCounts ─────────────────────────────────────────────────────────────

describe('statusCounts', () => {
  it('counts all sessions under "all"', () => {
    expect(statusCounts(SESSIONS).all).toBe(SESSIONS.length);
  });
  it('counts error sessions under "attention"', () => {
    expect(statusCounts(SESSIONS).attention).toBe(1);
  });
  it('counts processing sessions', () => {
    expect(statusCounts(SESSIONS).processing).toBe(1);
  });
  it('counts notion sessions', () => {
    expect(statusCounts(SESSIONS).notion).toBe(1);
  });
});

// ── hasActiveFilters ─────────────────────────────────────────────────────────

describe('hasActiveFilters', () => {
  it('returns false for default options', () => {
    expect(hasActiveFilters({})).toBe(false);
  });
  it('returns true when query is set', () => {
    expect(hasActiveFilters({ query: 'hello' })).toBe(true);
  });
  it('returns true when sort is not newest', () => {
    expect(hasActiveFilters({ sort: 'oldest' })).toBe(true);
  });
  it('returns true when duration is set', () => {
    expect(hasActiveFilters({ duration: 'short' })).toBe(true);
  });
  it('returns true when dateFrom is set', () => {
    expect(hasActiveFilters({ dateFrom: '2026-10-01' })).toBe(true);
  });
  it('returns true when content filters are active', () => {
    expect(hasActiveFilters({ content: ['hasActions'] })).toBe(true);
  });
});

// ── filterAndSort — text search ──────────────────────────────────────────────

describe('filterAndSort — text search', () => {
  it('returns all sessions with empty query', () => {
    expect(filterAndSort(SESSIONS, {}).length).toBe(SESSIONS.length);
  });

  it('filters by title', () => {
    const result = filterAndSort(SESSIONS, { query: 'standup' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s1');
  });

  it('is case-insensitive', () => {
    const result = filterAndSort(SESSIONS, { query: 'SPRINT REVIEW' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s2');
  });

  it('searches notes summary', () => {
    const result = filterAndSort(SESSIONS, { query: 'planned next' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s6');
  });
});

// ── filterAndSort — status ───────────────────────────────────────────────────

describe('filterAndSort — status filter', () => {
  it('filters to error sessions with "attention"', () => {
    const result = filterAndSort(SESSIONS, { status: 'attention' });
    expect(result.every((s) => s.status === 'error')).toBe(true);
  });

  it('filters to notion sessions', () => {
    const result = filterAndSort(SESSIONS, { status: 'notion' });
    expect(result.every((s) => !!s.notion_page_url)).toBe(true);
  });
});

// ── filterAndSort — duration ─────────────────────────────────────────────────

describe('filterAndSort — duration filter', () => {
  it('"short" returns sessions under 15 minutes', () => {
    const result = filterAndSort(SESSIONS, { duration: 'short' });
    expect(result.every((s) => s.duration_seconds < 15 * 60)).toBe(true);
    expect(result.length).toBe(2); // s1=600s (10m), s4=120s (2m)
  });

  it('"medium" returns sessions between 15–60 minutes', () => {
    const result = filterAndSort(SESSIONS, { duration: 'medium' });
    expect(result.every((s) => s.duration_seconds >= 15 * 60 && s.duration_seconds < 60 * 60)).toBe(true);
  });

  it('"long" returns sessions over 60 minutes', () => {
    const result = filterAndSort(SESSIONS, { duration: 'long' });
    expect(result.every((s) => s.duration_seconds >= 60 * 60)).toBe(true);
  });
});

// ── filterAndSort — platform ─────────────────────────────────────────────────

describe('filterAndSort — platform filter', () => {
  it('"meet" returns only Google Meet sessions', () => {
    const result = filterAndSort(SESSIONS, { platform: 'meet' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s2');
  });

  it('"zoom" returns only Zoom sessions', () => {
    const result = filterAndSort(SESSIONS, { platform: 'zoom' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s5');
  });
});

// ── filterAndSort — date range ───────────────────────────────────────────────

describe('filterAndSort — date range', () => {
  it('filters sessions after dateFrom', () => {
    const result = filterAndSort(SESSIONS, { dateFrom: '2026-10-04' });
    expect(result.every((s) => new Date(s.started_at) >= new Date('2026-10-04'))).toBe(true);
  });

  it('filters sessions before dateTo', () => {
    const result = filterAndSort(SESSIONS, { dateTo: '2026-10-02' });
    expect(result.every((s) => new Date(s.started_at) <= new Date('2026-10-03'))).toBe(true);
  });

  it('filters sessions within a date range', () => {
    const result = filterAndSort(SESSIONS, { dateFrom: '2026-10-02', dateTo: '2026-10-04' });
    expect(result.length).toBe(3); // s2, s3, s4
  });
});

// ── filterAndSort — content ──────────────────────────────────────────────────

describe('filterAndSort — content filter', () => {
  it('"hasActions" returns only sessions with action items', () => {
    const result = filterAndSort(SESSIONS, { content: ['hasActions'] });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s6');
  });

  it('"hasNotes" returns sessions with notes summary', () => {
    const result = filterAndSort(SESSIONS, { content: ['hasNotes'] });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s6');
  });
});

// ── filterAndSort — sorting ──────────────────────────────────────────────────

describe('filterAndSort — sorting', () => {
  it('"newest" sorts by started_at descending', () => {
    const result = filterAndSort(SESSIONS, { sort: 'newest' });
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].started_at) >= new Date(result[i].started_at)).toBe(true);
    }
  });

  it('"oldest" sorts by started_at ascending', () => {
    const result = filterAndSort(SESSIONS, { sort: 'oldest' });
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].started_at) <= new Date(result[i].started_at)).toBe(true);
    }
  });

  it('"longest" puts the longest session first', () => {
    const result = filterAndSort(SESSIONS, { sort: 'longest' });
    expect(result[0].id).toBe('s3'); // 5400s
  });

  it('"shortest" puts the shortest session first', () => {
    const result = filterAndSort(SESSIONS, { sort: 'shortest' });
    expect(result[0].id).toBe('s4'); // 120s
  });

  it('"title" sorts alphabetically', () => {
    const result = filterAndSort(SESSIONS, { sort: 'title' });
    expect(result[0].title).toBe('Bug Triage');
    expect(result[result.length - 1].title).toBe('Sprint Review');
  });
});

// ── filterAndSort — combined ─────────────────────────────────────────────────

describe('filterAndSort — combined filters', () => {
  it('combines status + duration + search', () => {
    const result = filterAndSort(SESSIONS, {
      status: 'all',
      duration: 'medium',
      query: 'retro',
    });
    // "Retro" is 2700s (45m) → medium, so it should match.
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s5');
  });

  it('combines date range + platform', () => {
    const result = filterAndSort(SESSIONS, {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-05',
      platform: 'meet',
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('s2');
  });

  it('returns empty when no sessions match all filters', () => {
    const result = filterAndSort(SESSIONS, {
      status: 'attention',
      platform: 'meet',
    });
    expect(result.length).toBe(0);
  });
});
