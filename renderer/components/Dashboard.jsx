import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Mic,
  RefreshCw,
  Upload,
  X,
  ArrowRight,
  ClipboardList,
} from 'lucide-react';
import { useApp, hasSttApiKey } from '../lib/app-context.js';
import PasteTranscriptModal from './PasteTranscriptModal.jsx';
import UpcomingMeetings from './UpcomingMeetings.jsx';
import { SessionList, SessionListSkeleton } from './SessionCard.jsx';
import {
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

// One bordered strip with hairline-separated cells instead of four tall cards.
function StatStrip({ stats }) {
  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 rounded-card border border-ink overflow-hidden mb-32">
      {stats.map(({ label, value, caption }, i) => (
        <div
          key={label}
          title={caption}
          className={`px-24 py-16 border-ink ${i > 0 ? 'md:border-l' : ''} ${i % 2 === 1 ? 'border-l' : ''} ${
            i >= 2 ? 'border-t md:border-t-0' : ''
          }`}
        >
          <dt className="eyebrow">{label}</dt>
          <dd className="text-subheading font-medium text-ink tabular mt-4">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Slim sticky bar shared by the loaded and loading states: greeting left, actions right, and
// the meeting count centred in whatever space is left between them.
function DashboardToolbar({ subtitle, actions }) {
  return (
    <header className="flex-shrink-0 border-b border-ink bg-paper">
      <div className="w-full px-24 py-8 min-h-[56px] flex items-center gap-16">
        <h1 className="flex-shrink-0 text-body-sm font-medium text-ink whitespace-nowrap">{greeting()}</h1>
        <p className="flex-1 min-w-0 text-center text-caption text-graphite truncate">{subtitle}</p>
        {actions && <div className="flex-shrink-0 flex items-center gap-8">{actions}</div>}
      </div>
    </header>
  );
}

function DashboardSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DashboardToolbar />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-32 pt-24 pb-48" aria-busy="true" aria-label="Loading dashboard">
          <div className="grid grid-cols-2 md:grid-cols-4 rounded-card border border-ink mb-32">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="px-24 py-16">
                <Skeleton className="h-16 w-[60%]" />
                <Skeleton className="h-24 w-[40%] mt-8" />
              </div>
            ))}
          </div>
          <SessionListSkeleton />
        </div>
      </div>
    </div>
  );
}

function SetupCard({ config, onSetup }) {
  const sttDone = hasSttApiKey(config);
  const geminiDone = !!config?.geminiApiKey?.trim();
  const notionDone = !!(config?.notionToken?.trim() && config?.notionPageId?.trim());

  return (
    <section className="card mb-32" aria-labelledby="setup-heading">
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
    <div className="flex flex-wrap items-center justify-between gap-16 rounded-card border border-ink bg-sunshine text-on-sunshine px-24 py-16 mb-32 fade-in" role="status">
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
      <button type="button" onClick={openPaste} className="btn-ghost px-16 py-4 text-caption">
        <ClipboardList size={14} strokeWidth={1.75} />
        Paste transcript
      </button>
      <button type="button" onClick={handleUploadAudio} className="btn-ghost px-16 py-4 text-caption">
        <Upload size={14} strokeWidth={1.75} />
        Import audio
      </button>
      <IconButton label="Refresh meetings" onClick={handleRefresh} disabled={refreshing}>
        <RefreshCw size={16} strokeWidth={1.75} className={refreshing ? 'spinner' : ''} />
      </IconButton>
    </>
  );

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden fade-in">
        <DashboardToolbar
          subtitle={
            hasSessions
              ? `${sessions.length} meeting${sessions.length !== 1 ? 's' : ''} recorded`
              : 'Your meeting notes will appear here.'
          }
          actions={headerActions}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] px-32 pt-24 pb-48">
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

            {hasSessions ? (
              <>
                <StatStrip
                  stats={[
                    { label: 'Meetings', value: metrics.totalMeetings, caption: 'Sessions recorded' },
                    { label: 'Recorded', value: formatMinutes(metrics.totalMinutes), caption: 'Total audio captured' },
                    { label: 'This week', value: formatMinutes(metrics.weekMinutes), caption: 'Recorded since Monday' },
                    { label: 'In Notion', value: metrics.notionSynced, caption: 'Pages uploaded to Notion' },
                  ]}
                />

                <UpcomingMeetings
                  onNavigateToSettings={onNavigateToSettings}
                  onStartRecording={handleRecordFromCalendar}
                  isRecording={isRecording}
                  className="mb-32"
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
                  className="mt-32"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {showPasteModal && <PasteTranscriptModal onClose={closePaste} />}
    </>
  );
}
