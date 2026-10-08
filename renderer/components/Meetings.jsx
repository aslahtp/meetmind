import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  RefreshCw, Upload, ClipboardList, Search, X, Mic,
  ArrowUpDown, Calendar, ChevronDown, ChevronUp, SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import PasteTranscriptModal from './PasteTranscriptModal.jsx';
import { SessionList, SessionListSkeleton } from './SessionCard.jsx';
import { PageHeader, IconButton, EmptyState, Skeleton, StatusDot } from './ui/index.jsx';
import { useDelayedFlag, useSessionActions, SKELETON_DELAY_MS } from '../lib/hooks.js';
import { useScrollMemory, useRememberedState } from '../lib/scrollMemory.js';
import {
  STATUS_FILTERS,
  DURATION_FILTERS,
  PLATFORM_FILTERS,
  CONTENT_FILTERS,
  SORT_OPTIONS,
  filterAndSort,
  statusCounts,
  hasActiveFilters,
} from '../lib/meetingFilters.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a native input date value for display. */
function friendlyDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00'); // local midnight
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MeetingsSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="page" aria-busy="true" aria-label="Loading meetings">
        <div className="mb-48">
          <Skeleton className="h-32 w-[200px]" />
          <Skeleton className="h-16 w-[140px] mt-8" />
        </div>
        <Skeleton className="h-48 w-full mb-32" />
        <SessionListSkeleton />
      </div>
    </div>
  );
}

/** Inline date range picker — two native date inputs with clear. */
function DateRangePicker({ dateFrom, dateTo, onChange }) {
  const hasDates = dateFrom || dateTo;

  return (
    <div className="flex flex-wrap items-center gap-8">
      <Calendar size={16} strokeWidth={1.75} className="text-graphite flex-shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-4">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value, dateTo })}
          aria-label="From date"
          className="input py-4 px-8 text-caption w-[140px]"
        />
        <span className="text-caption text-graphite">–</span>
        <input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => onChange({ dateFrom, dateTo: e.target.value })}
          aria-label="To date"
          className="input py-4 px-8 text-caption w-[140px]"
        />
      </div>
      {hasDates && (
        <button
          type="button"
          onClick={() => onChange({ dateFrom: '', dateTo: '' })}
          className="icon-btn w-24 h-24"
          aria-label="Clear date range"
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** A select-style dropdown built from pills so it matches the design system. */
function FilterSelect({ value, options, onChange, label }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="text-caption text-graphite sr-only">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="input py-4 px-8 text-caption pr-32 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23707070%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-no-repeat bg-[right_8px_center]"
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Toggleable content-filter chips. */
function ContentChips({ active, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-8">
      {CONTENT_FILTERS.map((cf) => {
        const isActive = active.includes(cf.key);
        return (
          <button
            key={cf.key}
            type="button"
            aria-pressed={isActive}
            onClick={() =>
              onChange(isActive ? active.filter((k) => k !== cf.key) : [...active, cf.key])
            }
            className={isActive ? 'chip-dark' : 'pill'}
          >
            {cf.label}
            {isActive && <X size={14} strokeWidth={2} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** Active-filter summary strip shown when the "More filters" panel is collapsed. */
function ActiveFilterSummary({ opts, onClear }) {
  const tags = [];
  if (opts.dateFrom || opts.dateTo) {
    const parts = [];
    if (opts.dateFrom) parts.push(`from ${friendlyDate(opts.dateFrom)}`);
    if (opts.dateTo) parts.push(`to ${friendlyDate(opts.dateTo)}`);
    tags.push({ key: 'dates', label: parts.join(' '), clear: () => onClear('dates') });
  }
  if (opts.duration !== 'any') {
    const d = DURATION_FILTERS.find((f) => f.key === opts.duration);
    tags.push({ key: 'duration', label: d?.label || opts.duration, clear: () => onClear('duration') });
  }
  if (opts.platform !== 'any') {
    const p = PLATFORM_FILTERS.find((f) => f.key === opts.platform);
    tags.push({ key: 'platform', label: p?.label || opts.platform, clear: () => onClear('platform') });
  }
  for (const ck of (opts.content || [])) {
    const cf = CONTENT_FILTERS.find((c) => c.key === ck);
    if (cf) tags.push({ key: ck, label: cf.label, clear: () => onClear(ck) });
  }
  if (opts.sort !== 'newest') {
    const s = SORT_OPTIONS.find((o) => o.key === opts.sort);
    tags.push({ key: 'sort', label: s?.label || opts.sort, clear: () => onClear('sort') });
  }

  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-8" aria-label="Active filters">
      {tags.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.clear}
          className="chip-dark"
          aria-label={`Remove ${t.label} filter`}
        >
          {t.label}
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Meetings({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording, sessionsLoading, sessionsError } = useApp();
  const { handleUploadAudio } = useSessionActions();
  const showSkeleton = useDelayedFlag(sessionsLoading, SKELETON_DELAY_MS);
  const scrollRef = useScrollMemory('meetings');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Remembered so Back from a meeting returns to the same filtered list.
  const [query, setQuery] = useRememberedState('meetings:query', '');
  const [status, setStatus] = useRememberedState('meetings:filter', 'all');
  const [duration, setDuration] = useRememberedState('meetings:duration', 'any');
  const [platform, setPlatform] = useRememberedState('meetings:platform', 'any');
  const [dateFrom, setDateFrom] = useRememberedState('meetings:dateFrom', '');
  const [dateTo, setDateTo] = useRememberedState('meetings:dateTo', '');
  const [content, setContent] = useRememberedState('meetings:content', []);
  const [sort, setSort] = useRememberedState('meetings:sort', 'newest');
  const [filtersOpen, setFiltersOpen] = useRememberedState('meetings:filtersOpen', false);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const counts = useMemo(() => statusCounts(sessions), [sessions]);

  const filterOpts = useMemo(
    () => ({ query, status, duration, platform, dateFrom, dateTo, content, sort }),
    [query, status, duration, platform, dateFrom, dateTo, content, sort],
  );

  const visible = useMemo(() => filterAndSort(sessions, filterOpts), [sessions, filterOpts]);

  const isFiltered = useMemo(() => hasActiveFilters(filterOpts), [filterOpts]);

  const openPaste = useCallback(() => setShowPasteModal(true), []);
  const closePaste = useCallback(() => setShowPasteModal(false), []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessions();
    } finally {
      setRefreshing(false);
    }
  };

  const clearAllFilters = () => {
    setQuery('');
    setStatus('all');
    setDuration('any');
    setPlatform('any');
    setDateFrom('');
    setDateTo('');
    setContent([]);
    setSort('newest');
  };

  const clearSingleFilter = (key) => {
    if (key === 'dates') { setDateFrom(''); setDateTo(''); }
    else if (key === 'duration') setDuration('any');
    else if (key === 'platform') setPlatform('any');
    else if (key === 'sort') setSort('newest');
    else if (CONTENT_FILTERS.some((c) => c.key === key)) {
      setContent((prev) => prev.filter((k) => k !== key));
    }
  };

  // How many extra filters are active beyond search + status.
  const extraFilterCount = [
    duration !== 'any',
    platform !== 'any',
    dateFrom !== '',
    dateTo !== '',
    sort !== 'newest',
    ...content.map(() => true),
  ].filter(Boolean).length;

  if (sessionsLoading) {
    return showSkeleton ? <MeetingsSkeleton /> : <div className="h-full" />;
  }

  const attention = counts.attention;
  const subtitle = sessions.length === 0
    ? 'Recorded, imported and pasted meetings live here.'
    : `${sessions.length} meeting${sessions.length !== 1 ? 's' : ''}${attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}`;

  return (
    <>
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div className="page fade-in">
          <PageHeader
            title="Meetings"
            subtitle={subtitle}
            actions={
              <>
                <button type="button" onClick={openPaste} className="btn-ghost btn-sm">
                  <ClipboardList size={16} strokeWidth={1.75} />
                  Paste transcript
                </button>
                <button type="button" onClick={handleUploadAudio} className="btn-ghost btn-sm">
                  <Upload size={16} strokeWidth={1.75} />
                  Import audio
                </button>
                <IconButton label="Refresh meetings" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw size={16} strokeWidth={1.75} className={refreshing ? 'spinner' : ''} />
                </IconButton>
              </>
            }
          />

          {sessionsError && (
            <div className="card-compact flex flex-wrap items-center justify-between gap-16 mb-32" role="alert">
              <p className="flex items-center gap-8 text-body-sm text-ink">
                <StatusDot tone="error" />
                Couldn't load your meetings: {sessionsError}
              </p>
              <button type="button" onClick={handleRefresh} className="btn-ghost btn-sm">
                <RefreshCw size={14} strokeWidth={1.75} />
                Retry
              </button>
            </div>
          )}

          {sessions.length === 0 ? (
            sessionsError ? null : (
              <EmptyState
                icon={<Mic size={28} strokeWidth={1.5} />}
                title="No meetings yet"
                message="Record a meeting, import an audio file or paste a transcript to get started."
                action={
                  <button type="button" onClick={startRecording} disabled={isRecording} className="btn-ink">
                    <span className="dot dot-sm dot-signal" aria-hidden="true" />
                    Start recording
                  </button>
                }
              />
            )
          ) : (
            <>
              {/* ── Search + status filters + controls ─────────────────────── */}
              <div className="flex flex-wrap items-center gap-16 mb-16">
                {/* Search bar */}
                <div className="relative flex-1 min-w-[240px]">
                  <Search size={16} strokeWidth={1.75} className="absolute left-16 top-1/2 -translate-y-1/2 text-graphite pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search meetings"
                    aria-label="Search meetings"
                    className="input pl-48"
                  />
                </div>

                {/* Sort selector */}
                <div className="flex items-center gap-4">
                  <ArrowUpDown size={14} strokeWidth={1.75} className="text-graphite flex-shrink-0" aria-hidden="true" />
                  <FilterSelect
                    value={sort}
                    options={SORT_OPTIONS}
                    onChange={setSort}
                    label="Sort meetings"
                  />
                </div>

                {/* Toggle extra filters */}
                <button
                  type="button"
                  onClick={() => setFiltersOpen((prev) => !prev)}
                  className={`btn-ghost btn-sm ${extraFilterCount > 0 ? 'border-ink' : ''}`}
                  aria-expanded={filtersOpen}
                  aria-controls="meetings-extra-filters"
                >
                  <SlidersHorizontal size={14} strokeWidth={1.75} />
                  Filters
                  {extraFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-ink text-paper text-caption font-medium">
                      {extraFilterCount}
                    </span>
                  )}
                  {filtersOpen
                    ? <ChevronUp size={14} strokeWidth={1.75} />
                    : <ChevronDown size={14} strokeWidth={1.75} />}
                </button>
              </div>

              {/* Status filter chips */}
              <div role="group" aria-label="Filter meetings" className="flex flex-wrap items-center gap-8 mb-16">
                {STATUS_FILTERS.map((f) => {
                  const active = status === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatus(active && f.key !== 'all' ? 'all' : f.key)}
                      className={active ? 'chip-dark' : 'pill'}
                    >
                      {f.label}
                      <span className={`tabular ${active ? 'text-paper/70' : 'text-graphite'}`}>{counts[f.key]}</span>
                      {active && f.key !== 'all' && <X size={14} strokeWidth={2} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              {/* ── Extended filters panel ──────────────────────────────────── */}
              {filtersOpen && (
                <div
                  id="meetings-extra-filters"
                  className="card-compact mb-16 flex flex-col gap-24 fade-in"
                  aria-label="Extended filters"
                >
                  {/* Row 1: Date range */}
                  <div className="flex flex-wrap items-center gap-16">
                    <span className="text-caption font-medium text-ink w-[80px] flex-shrink-0">Date</span>
                    <DateRangePicker
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      onChange={({ dateFrom: df, dateTo: dt }) => {
                        setDateFrom(df);
                        setDateTo(dt);
                      }}
                    />
                  </div>

                  {/* Row 2: Duration + Platform */}
                  <div className="flex flex-wrap items-center gap-16">
                    <span className="text-caption font-medium text-ink w-[80px] flex-shrink-0">Duration</span>
                    <FilterSelect
                      value={duration}
                      options={DURATION_FILTERS}
                      onChange={setDuration}
                      label="Filter by duration"
                    />

                    <span className="text-caption font-medium text-ink w-[80px] flex-shrink-0 ml-16">Platform</span>
                    <FilterSelect
                      value={platform}
                      options={PLATFORM_FILTERS}
                      onChange={setPlatform}
                      label="Filter by platform"
                    />
                  </div>

                  {/* Row 3: Content chips */}
                  <div className="flex flex-wrap items-center gap-16">
                    <span className="text-caption font-medium text-ink w-[80px] flex-shrink-0">Content</span>
                    <ContentChips active={content} onChange={setContent} />
                  </div>
                </div>
              )}

              {/* Active-filter summary (visible when panel is closed) */}
              {!filtersOpen && (
                <div className="mb-16">
                  <ActiveFilterSummary opts={filterOpts} onClear={clearSingleFilter} />
                </div>
              )}

              {/* ── Results ────────────────────────────────────────────────── */}
              {isFiltered && (
                <div className="flex items-center justify-between mb-16">
                  <p className="text-caption text-graphite">
                    {visible.length} {visible.length === 1 ? 'meeting' : 'meetings'} found
                  </p>
                  <button type="button" onClick={clearAllFilters} className="btn-quiet btn-sm text-caption">
                    Clear all filters
                  </button>
                </div>
              )}

              {visible.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Search size={24} strokeWidth={1.5} />}
                  title="No meetings match"
                  message="Try a different search, or clear the filters to see everything."
                  action={
                    <button type="button" onClick={clearAllFilters} className="btn-ghost btn-sm">
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <SessionList sessions={visible} onOpenSession={onOpenSession} />
              )}
            </>
          )}
        </div>
      </div>

      {showPasteModal && <PasteTranscriptModal onClose={closePaste} />}
    </>
  );
}
