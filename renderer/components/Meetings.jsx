import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  RefreshCw, Upload, ClipboardList, Search, X, Mic, Check,
  ArrowUpDown, ChevronDown, SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import PasteTranscriptModal from './PasteTranscriptModal.jsx';
import { SessionList, SessionListSkeleton } from './SessionCard.jsx';
import {
  PageHeader, IconButton, EmptyState, Skeleton, StatusDot, SegmentedControl,
  Menu, MenuRadioItem, MenuLabel,
} from './ui/index.jsx';
import { useDelayedFlag, useSessionActions, SKELETON_DELAY_MS } from '../lib/hooks.js';
import { useScrollMemory, useRememberedState } from '../lib/scrollMemory.js';
import {
  STATUS_FILTERS,
  DATE_PRESETS,
  DURATION_FILTERS,
  PLATFORM_FILTERS,
  CONTENT_FILTERS,
  SORT_OPTIONS,
  filterAndSort,
  statusCounts,
  hasActiveFilters,
  activeFilterCount,
  resolveDateRange,
} from '../lib/meetingFilters.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const asOptions = (list) => list.map((f) => ({ value: f.key, label: f.label }));
const DATE_OPTIONS = asOptions(DATE_PRESETS);
const DURATION_OPTIONS = asOptions(DURATION_FILTERS);
const PLATFORM_OPTIONS = asOptions(PLATFORM_FILTERS);

/** Format a YYYY-MM-DD input value for display, dropping the year when it's this year. */
function friendlyDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00'); // local midnight
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function customRangeLabel(from, to) {
  if (from && to) return from === to ? friendlyDate(from) : `${friendlyDate(from)} – ${friendlyDate(to)}`;
  if (from) return `Since ${friendlyDate(from)}`;
  return `Until ${friendlyDate(to)}`;
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

/** Sort dropdown: a ghost pill naming the current order, opening a checked radio menu. */
function SortMenu({ value, onChange }) {
  const current = SORT_OPTIONS.find((o) => o.key === value) || SORT_OPTIONS[0];
  return (
    <Menu
      label="Sort meetings"
      minWidth={208}
      className="flex"
      trigger={({ open, ...props }) => (
        <button
          type="button"
          {...props}
          aria-label={`Sort: ${current.label}`}
          title="Sort meetings"
          className={`btn-ghost btn-sm ${open ? 'bg-ink/[0.06]' : ''}`}
        >
          <ArrowUpDown size={14} strokeWidth={1.75} aria-hidden="true" />
          {current.label}
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    >
      <MenuLabel>Sort by</MenuLabel>
      {SORT_OPTIONS.map((o) => (
        <MenuRadioItem key={o.key} checked={o.key === current.key} onSelect={() => onChange(o.key)}>
          {o.label}
        </MenuRadioItem>
      ))}
    </Menu>
  );
}

/**
 * One labelled row of the Filters panel. On wide windows the label sits beside the control,
 * padded to line up with the centre of a small pill control.
 */
function FilterField({ label, id, aside, children }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-24">
      <span id={id} className="eyebrow lg:w-[128px] lg:flex-shrink-0 lg:pt-8">{label}</span>
      <div className="min-w-0 flex-1 flex flex-col items-start gap-16">{children}</div>
      {aside && <div className="lg:flex-shrink-0">{aside}</div>}
    </div>
  );
}

/** From/to date inputs, shown under the "Custom" date preset. */
function CustomDateRange({ dateFrom, dateTo, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-8 fade-in">
      <label className="flex items-center gap-8 text-caption text-graphite">
        From
        <input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => onChange({ dateFrom: e.target.value, dateTo })}
          className="input input-date"
        />
      </label>
      <label className="flex items-center gap-8 text-caption text-graphite">
        to
        <input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => onChange({ dateFrom, dateTo: e.target.value })}
          className="input input-date"
        />
      </label>
    </div>
  );
}

/** Multi-select toggle pills for the content filters. */
function ContentToggles({ active, onChange, labelledBy }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap items-center gap-8">
      {CONTENT_FILTERS.map((cf) => {
        const on = active.includes(cf.key);
        return (
          <button
            key={cf.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? active.filter((k) => k !== cf.key) : [...active, cf.key])}
            className={on ? 'chip-dark' : 'pill'}
          >
            {on && <Check size={14} strokeWidth={2} aria-hidden="true" />}
            {cf.label}
          </button>
        );
      })}
    </div>
  );
}

/** Applied panel filters as dismissible Dark Filter Chips. */
function AppliedFilters({ chips }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Applied filters" className="contents">
      {chips.map((c) => (
        <li key={c.key} className="fade-in">
          <button
            type="button"
            onClick={c.clear}
            className="chip-dark hover:bg-ink/80 transition-colors duration-150"
            aria-label={`Remove filter: ${c.label}`}
            title="Remove filter"
          >
            {c.label}
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
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
  const [datePreset, setDatePreset] = useRememberedState('meetings:datePreset', 'any');
  const [customFrom, setCustomFrom] = useRememberedState('meetings:dateFrom', '');
  const [customTo, setCustomTo] = useRememberedState('meetings:dateTo', '');
  const [duration, setDuration] = useRememberedState('meetings:duration', 'any');
  const [platform, setPlatform] = useRememberedState('meetings:platform', 'any');
  const [content, setContent] = useRememberedState('meetings:content', []);
  const [sort, setSort] = useRememberedState('meetings:sort', 'newest');
  const [filtersOpen, setFiltersOpen] = useRememberedState('meetings:filtersOpen', false);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const counts = useMemo(() => statusCounts(sessions), [sessions]);

  const filterOpts = useMemo(() => {
    const { dateFrom, dateTo } = resolveDateRange(datePreset, customFrom, customTo);
    return { query, status, duration, platform, dateFrom, dateTo, content, sort };
  }, [query, status, datePreset, customFrom, customTo, duration, platform, content, sort]);

  const visible = useMemo(() => filterAndSort(sessions, filterOpts), [sessions, filterOpts]);
  const isFiltered = hasActiveFilters(filterOpts);
  const panelCount = activeFilterCount(filterOpts);

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

  const clearDates = () => {
    setDatePreset('any');
    setCustomFrom('');
    setCustomTo('');
  };

  // Panel filters only; search, status and sort keep their own controls.
  const resetPanelFilters = () => {
    clearDates();
    setDuration('any');
    setPlatform('any');
    setContent([]);
  };

  // Everything that narrows the list. Sort only orders it, so it stays.
  const clearAllFilters = () => {
    setQuery('');
    setStatus('all');
    resetPanelFilters();
  };

  const appliedChips = [];
  if (filterOpts.dateFrom || filterOpts.dateTo) {
    appliedChips.push({
      key: 'dates',
      label: datePreset === 'custom'
        ? customRangeLabel(filterOpts.dateFrom, filterOpts.dateTo)
        : DATE_PRESETS.find((p) => p.key === datePreset)?.label,
      clear: clearDates,
    });
  }
  if (duration !== 'any') {
    const d = DURATION_FILTERS.find((f) => f.key === duration);
    appliedChips.push({ key: 'duration', label: d?.label || duration, clear: () => setDuration('any') });
  }
  if (platform !== 'any') {
    const p = PLATFORM_FILTERS.find((f) => f.key === platform);
    appliedChips.push({ key: 'platform', label: p?.label || platform, clear: () => setPlatform('any') });
  }
  for (const cf of CONTENT_FILTERS) {
    if (content.includes(cf.key)) {
      appliedChips.push({
        key: cf.key,
        label: cf.label,
        clear: () => setContent((prev) => prev.filter((k) => k !== cf.key)),
      });
    }
  }

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
              {/* ── Toolbar: search · sort · filters, all stretched to the search field's height. */}
              <div className="flex flex-wrap items-stretch gap-8 mb-16">
                <div className="relative flex-1 min-w-[240px]">
                  <Search
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="absolute left-16 top-1/2 -translate-y-1/2 text-graphite pointer-events-none"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search meetings"
                    aria-label="Search meetings"
                    className="input pl-48"
                  />
                </div>

                <SortMenu value={sort} onChange={setSort} />

                <button
                  type="button"
                  onClick={() => setFiltersOpen((prev) => !prev)}
                  className={`btn-ghost btn-sm ${filtersOpen ? 'bg-ink/[0.06]' : ''}`}
                  aria-expanded={filtersOpen}
                  aria-controls="meetings-filters"
                  aria-label={panelCount > 0 ? `Filters, ${panelCount} applied` : 'Filters'}
                >
                  <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
                  Filters
                  {panelCount > 0 && <span className="count-badge" aria-hidden="true">{panelCount}</span>}
                  <ChevronDown
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={`transition-transform duration-150 ${filtersOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {/* ── Filters panel, directly under the button that opens it. */}
              {filtersOpen && (
                <section
                  id="meetings-filters"
                  aria-label="Filters"
                  className="card-compact mb-16 flex flex-col gap-24 fade-in"
                >
                  <FilterField label="Date">
                    <SegmentedControl
                      role="radiogroup"
                      size="sm"
                      label="Date"
                      options={DATE_OPTIONS}
                      value={datePreset}
                      onChange={setDatePreset}
                    />
                    {datePreset === 'custom' && (
                      <CustomDateRange
                        dateFrom={customFrom}
                        dateTo={customTo}
                        onChange={({ dateFrom, dateTo }) => {
                          setCustomFrom(dateFrom);
                          setCustomTo(dateTo);
                        }}
                      />
                    )}
                  </FilterField>

                  <FilterField label="Length">
                    <SegmentedControl
                      role="radiogroup"
                      size="sm"
                      label="Length"
                      options={DURATION_OPTIONS}
                      value={duration}
                      onChange={setDuration}
                    />
                  </FilterField>

                  <FilterField label="Platform">
                    <SegmentedControl
                      role="radiogroup"
                      size="sm"
                      label="Platform"
                      options={PLATFORM_OPTIONS}
                      value={platform}
                      onChange={setPlatform}
                    />
                  </FilterField>

                  <FilterField
                    label="Content"
                    id="meetings-filter-content"
                    aside={
                      <button
                        type="button"
                        onClick={resetPanelFilters}
                        disabled={panelCount === 0}
                        className="btn-quiet btn-sm"
                      >
                        Reset filters
                      </button>
                    }
                  >
                    <ContentToggles active={content} onChange={setContent} labelledBy="meetings-filter-content" />
                  </FilterField>
                </section>
              )}

              {/* ── Status quick filters, then a results line when anything narrows the list. */}
              <div className="flex flex-col gap-16 mb-24">
                <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-8">
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
                      </button>
                    );
                  })}
                </div>

                {isFiltered && (
                  <div className="flex flex-wrap items-center gap-8 fade-in">
                    <p role="status" className="text-caption text-graphite tabular mr-8">
                      {visible.length} of {sessions.length} {sessions.length === 1 ? 'meeting' : 'meetings'}
                    </p>
                    {/* While the panel is open its own controls show what's applied. */}
                    {!filtersOpen && <AppliedFilters chips={appliedChips} />}
                    <button type="button" onClick={clearAllFilters} className="btn-quiet btn-sm">
                      Clear all
                    </button>
                  </div>
                )}
              </div>

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
