import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Mic,
  RefreshCw,
  Upload,
  X,
  ArrowRight,
  ClipboardList,
} from 'lucide-react';
import { useApp, hasSttApiKey } from '../app.jsx';
import PasteTranscriptModal from './PasteTranscriptModal.jsx';
import UpcomingMeetings from './UpcomingMeetings.jsx';
import { SessionList, SessionListSkeleton } from './SessionCard.jsx';
import {
  PageHeader,
  IconButton,
  StepBadge,
  EmptyState,
  Skeleton,
  StatusDot,
} from './ui/index.jsx';
import { getSessionDuration, formatMinutes } from '../lib/format.js';
import { useDelayedFlag, useSessionActions, SKELETON_DELAY_MS } from '../lib/hooks.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatTile({ label, value, caption }) {
  return (
    <div className="card-compact">
      <p className="eyebrow">{label}</p>
      <p className="text-heading font-medium text-ink mt-8 tabular">{value}</p>
      <p className="text-caption text-graphite mt-4">{caption}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="page" aria-busy="true" aria-label="Loading dashboard">
        <div className="mb-48">
          <Skeleton className="h-32 w-[240px]" />
          <Skeleton className="h-16 w-[160px] mt-8" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-16 mb-64">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card-compact">
              <Skeleton className="h-16 w-[60%]" />
              <Skeleton className="h-32 w-[40%] mt-8" />
            </div>
          ))}
        </div>
        <SessionListSkeleton />
      </div>
    </div>
  );
}

function SetupCard({ config, onSetup }) {
  const sttDone = hasSttApiKey(config);
  const geminiDone = !!config?.geminiApiKey?.trim();
  const notionDone = !!(config?.notionToken?.trim() && config?.notionPageId?.trim());

  return (
    <section className="card mb-48" aria-labelledby="setup-heading">
      <p className="eyebrow">Getting started</p>
      <h2 id="setup-heading" className="text-heading-sm font-medium text-ink mt-8">Finish setting up MeetMind</h2>
      <p className="text-body-sm text-graphite mt-8 max-w-[640px]">
        Add your API keys so recordings can be transcribed and turned into notes. Notion is optional.
      </p>
      <div className="flex flex-wrap items-center gap-8 mt-24">
        <StepBadge n={1} done={sttDone}>Speech-to-text</StepBadge>
        <StepBadge n={2} done={geminiDone}>Gemini</StepBadge>
        <StepBadge n={3} done={notionDone}>Notion (optional)</StepBadge>
      </div>
      <button type="button" onClick={onSetup} className="btn-sunshine mt-32">
        Set up keys
        <ArrowRight size={16} strokeWidth={1.75} />
      </button>
    </section>
  );
}

function MeetingStartingCallout({ event, onRecord, onDismiss }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-16 rounded-card border border-ink bg-sunshine text-on-sunshine px-24 py-16 mb-48 fade-in" role="status">
      <div className="flex items-center gap-16 min-w-0">
        <Mic size={18} strokeWidth={1.75} className="flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-body-sm font-medium truncate">“{event.title}” is starting now</p>
          <p className="text-caption">Want to record it?</p>
        </div>
      </div>
      <div className="flex items-center gap-8 flex-shrink-0">
        <button type="button" onClick={onRecord} className="btn-ink btn-sm">
          <span className="dot dot-sm dot-signal" aria-hidden="true" />
          Record
        </button>
        <IconButton label="Dismiss" onClick={onDismiss} className="text-on-sunshine hover:text-on-sunshine">
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}

export default function Dashboard({ onOpenSession, onNavigateToSettings, onNavigateToMeetings }) {
  const {
    sessions, refreshSessions, startRecording, isRecording, sessionsLoading, sessionsError,
    config, keysNotSet,
  } = useApp();
  const { handleUploadAudio } = useSessionActions();
  const showSkeleton = useDelayedFlag(sessionsLoading, SKELETON_DELAY_MS);
  const [meetingToast, setMeetingToast] = useState(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const toastTimersRef = useRef([]);

  const recentLimit = config?.dashboardRecentLimit || 5;

  const metrics = useMemo(() => {
    const totalSecs = sessions.reduce((acc, s) => acc + (getSessionDuration(s) || 0), 0);
    const notionCount = sessions.filter((s) => s.notion_page_url).length;

    // This week: Monday 00:00 → Sunday 23:59
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekSecs = sessions
      .filter((s) => s.started_at && new Date(s.started_at) >= monday)
      .reduce((acc, s) => acc + (getSessionDuration(s) || 0), 0);

    return {
      totalMeetings: sessions.length,
      totalMinutes: totalSecs / 60,
      weekMinutes: weekSecs / 60,
      notionSynced: notionCount,
    };
  }, [sessions]);

  const recentSessions = sessions.slice(0, recentLimit);

  useEffect(() => {
    refreshSessions();
  }, []);

  // Listen for calendar meeting-starting events
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsub = window.meetmind.on('calendar:meeting-starting', (event) => {
      setMeetingToast(event);
      // Auto-dismiss after 30 seconds
      const t = setTimeout(() => setMeetingToast((prev) => (prev?.id === event.id ? null : prev)), 30_000);
      toastTimersRef.current.push(t);
    });
    return () => {
      unsub?.();
      toastTimersRef.current.forEach(clearTimeout);
      toastTimersRef.current = [];
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessions();
    } finally {
      setRefreshing(false);
    }
  };

  const handleRecordFromCalendar = (event) => {
    if (event.meetingLink) {
      window.meetmind.shell.openExternal(event.meetingLink);
    }
    startRecording();
  };

  const openPaste = useCallback(() => setShowPasteModal(true), []);
  const closePaste = useCallback(() => setShowPasteModal(false), []);

  // While loading, render the skeleton only once it's been slow enough to warrant
  // one; before that show nothing, so a fast load goes straight to real content.
  if (sessionsLoading) {
    return showSkeleton ? <DashboardSkeleton /> : <div className="h-full" />;
  }

  const hasSessions = sessions.length > 0;

  const headerActions = (
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
  );

  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="page fade-in">
          <PageHeader
            title={greeting()}
            subtitle={
              hasSessions
                ? `${sessions.length} meeting${sessions.length !== 1 ? 's' : ''} recorded`
                : 'Your meeting notes will appear here.'
            }
            actions={headerActions}
          />

          {keysNotSet && <SetupCard config={config} onSetup={onNavigateToSettings} />}

          {meetingToast && !isRecording && (
            <MeetingStartingCallout
              event={meetingToast}
              onRecord={() => {
                handleRecordFromCalendar(meetingToast);
                setMeetingToast(null);
              }}
              onDismiss={() => setMeetingToast(null)}
            />
          )}

          {sessionsError && (
            <div className="card-compact flex flex-wrap items-center justify-between gap-16 mb-48" role="alert">
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

          {hasSessions ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-16 mb-64">
                <StatTile label="Meetings" value={metrics.totalMeetings} caption="sessions recorded" />
                <StatTile label="Recorded" value={formatMinutes(metrics.totalMinutes)} caption="total audio captured" />
                <StatTile label="This week" value={formatMinutes(metrics.weekMinutes)} caption="recorded since Monday" />
                <StatTile label="In Notion" value={metrics.notionSynced} caption="pages uploaded" />
              </div>

              <UpcomingMeetings
                onNavigateToSettings={onNavigateToSettings}
                onStartRecording={handleRecordFromCalendar}
                isRecording={isRecording}
                className="mb-64"
              />

              <section aria-labelledby="recent-heading">
                <h2 id="recent-heading" className="eyebrow mb-16">Recent recordings</h2>
                <SessionList sessions={recentSessions} onOpenSession={onOpenSession} />
                {sessions.length > recentLimit && (
                  <div className="flex justify-center mt-24">
                    <button type="button" onClick={onNavigateToMeetings} className="btn-quiet btn-sm">
                      View all {sessions.length} meetings
                      <ArrowRight size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                )}
              </section>
            </>
          ) : sessionsError ? null : (
            <>
              <EmptyState
                icon={<Mic size={28} strokeWidth={1.5} />}
                title="Record your first meeting"
                message="Start recording any online or in-person meeting. MeetMind transcribes it, writes the summary and pulls out the action items."
                action={
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={isRecording}
                    className={keysNotSet ? 'btn-ink' : 'btn-sunshine'}
                  >
                    <span className={`dot dot-sm ${keysNotSet ? 'dot-signal' : 'dot-ink'}`} aria-hidden="true" />
                    Start recording
                  </button>
                }
              />
              <UpcomingMeetings
                onNavigateToSettings={onNavigateToSettings}
                onStartRecording={handleRecordFromCalendar}
                isRecording={isRecording}
                className="mt-48"
              />
            </>
          )}
        </div>
      </div>

      {showPasteModal && <PasteTranscriptModal onClose={closePaste} />}
    </>
  );
}
