import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { RefreshCw, Upload, ClipboardList, Search, X, Mic } from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import PasteTranscriptModal from './PasteTranscriptModal.jsx';
import { SessionList, SessionListSkeleton } from './SessionCard.jsx';
import { PageHeader, IconButton, EmptyState, Skeleton, StatusDot } from './ui/index.jsx';
import { sessionDisplayTitle } from '../lib/format.js';
import { isProcessing } from '../lib/status.js';
import { useDelayedFlag, useSessionActions, SKELETON_DELAY_MS } from '../lib/hooks.js';

const FILTERS = [
  { key: 'all',       label: 'All',             test: () => true },
  { key: 'attention', label: 'Needs attention', test: (s) => s.status === 'error' },
  { key: 'processing',label: 'Processing',      test: (s) => isProcessing(s.status) },
  { key: 'notion',    label: 'In Notion',       test: (s) => !!s.notion_page_url },
];

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

export default function Meetings({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording, sessionsLoading, sessionsError } = useApp();
  const { handleUploadAudio } = useSessionActions();
  const showSkeleton = useDelayedFlag(sessionsLoading, SKELETON_DELAY_MS);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshSessions();
  }, []);

  const counts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) out[f.key] = sessions.filter(f.test).length;
    return out;
  }, [sessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    return sessions.filter((s) => active.test(s) && matchesQuery(s, q));
  }, [sessions, query, filter]);

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

  const clearFilters = () => {
    setQuery('');
    setFilter('all');
  };

  if (sessionsLoading) {
    return showSkeleton ? <MeetingsSkeleton /> : <div className="h-full" />;
  }

  const attention = counts.attention;
  const subtitle = sessions.length === 0
    ? 'Recorded, imported and pasted meetings live here.'
    : `${sessions.length} meeting${sessions.length !== 1 ? 's' : ''}${attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}`;

  return (
    <>
      <div className="h-full overflow-y-auto">
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
                  <button type="button" onClick={startRecording} disabled={isRecording} className="btn-sunshine">
                    <span className="dot dot-sm dot-ink" aria-hidden="true" />
                    Start recording
                  </button>
                }
              />
            )
          ) : (
            <>
              {/* Search + filters */}
              <div className="flex flex-wrap items-center gap-16 mb-32">
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
                <div role="group" aria-label="Filter meetings" className="flex flex-wrap items-center gap-8">
                  {FILTERS.map((f) => {
                    const active = filter === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilter(active && f.key !== 'all' ? 'all' : f.key)}
                        className={active ? 'chip-dark' : 'pill'}
                      >
                        {f.label}
                        <span className={`tabular ${active ? 'text-paper/70' : 'text-graphite'}`}>{counts[f.key]}</span>
                        {active && f.key !== 'all' && <X size={14} strokeWidth={2} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {visible.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Search size={24} strokeWidth={1.5} />}
                  title="No meetings match"
                  message="Try a different search, or clear the filters to see everything."
                  action={
                    <button type="button" onClick={clearFilters} className="btn-ghost btn-sm">
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
