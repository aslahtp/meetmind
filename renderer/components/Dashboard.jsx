import React, { useState, useEffect, useMemo } from 'react';
import {
  Mic,
  Timer,
  RefreshCw,
  Upload,
  Users,
  CalendarDays,
  X,
} from 'lucide-react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';
import UpcomingMeetings from './UpcomingMeetings.jsx';
import SessionCard, {
  SessionCardSkeleton,
  SkeletonBlock,
  EmptyState,
  useDelayedFlag,
  SKELETON_DELAY_MS,
  useSessionActions,
  getSessionDuration,
} from './SessionCard.jsx';

function StatTileSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5">
      <div className="flex items-center justify-between mb-2">
        <SkeletonBlock className="h-3 w-20 rounded" />
        <SkeletonBlock className="w-7 h-7 rounded-lg" />
      </div>
      <SkeletonBlock className="h-7 w-12 rounded mb-1.5" />
      <SkeletonBlock className="h-3 w-24 rounded" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 pt-3 pb-3 border-b border-slate-200 dark:border-zinc-800/80 flex-shrink-0">
        <div>
          <SkeletonBlock className="h-6 w-44 rounded mb-2" />
          <SkeletonBlock className="h-3 w-32 rounded" />
        </div>
        <div className="flex items-center gap-2.5">
          <SkeletonBlock className="h-8 w-8 rounded-lg" />
          <SkeletonBlock className="h-8 w-28 rounded-lg" />
          <SkeletonBlock className="h-8 w-32 rounded-lg" />
        </div>
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-4 gap-3 px-6 pt-4 pb-2 flex-shrink-0">
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    </div>
  );
}

export default function Dashboard({ onOpenSession, onNavigateToSettings, onNavigateToMeetings }) {
  const { sessions, refreshSessions, startRecording, isRecording, sessionsLoading } = useApp();
  const { deletingIds, handleDelete, handleUploadAudio } = useSessionActions();
  const showSkeleton = useDelayedFlag(sessionsLoading, SKELETON_DELAY_MS);
  const [meetingToast, setMeetingToast] = useState(null);

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
      totalMinutes: Math.round(totalSecs / 60),
      weekMinutes: Math.round(weekSecs / 60),
      notionSynced: notionCount,
    };
  }, [sessions]);

  const recentSessions = sessions.slice(0, 5);

  useEffect(() => {
    refreshSessions();
  }, []);

  // Listen for calendar meeting-starting events
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsub = window.meetmind.on('calendar:meeting-starting', (event) => {
      setMeetingToast(event);
      // Auto-dismiss after 30 seconds
      setTimeout(() => setMeetingToast((prev) => prev?.id === event.id ? null : prev), 30_000);
    });
    return unsub;
  }, []);

  const handleRecordFromCalendar = (event) => {
    if (event.meetingLink) {
      window.meetmind.shell.openExternal(event.meetingLink);
    }
    startRecording();
  };

  // While loading, render the skeleton only once it's been slow enough to warrant
  // one; before that show nothing, so a fast load goes straight to real content
  // without any intermediate flash.
  if (sessionsLoading) {
    return showSkeleton ? <DashboardSkeleton /> : <div className="h-full bg-slate-50 dark:bg-zinc-950/40" />;
  }

  if (sessions.length === 0) {
    return <EmptyState onRecord={startRecording} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40 fade-in">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 pt-3 pb-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-50/80 dark:bg-transparent backdrop-blur-md flex-shrink-0 titlebar-drag select-none">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-slate-500 dark:text-zinc-400 text-xs mt-0.5">
            {sessions.length} meeting{sessions.length !== 1 ? 's' : ''} recorded
            {sessions.length > 5 && (
              <>
                {' · '}
                <button
                  onClick={onNavigateToMeetings}
                  className="titlebar-no-drag text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                >
                  View all →
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2.5 titlebar-no-drag">
          <button
            onClick={refreshSessions}
            className="btn-ghost p-2 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
            title="Refresh list"
          >
            <RefreshCw size={15} strokeWidth={2} />
          </button>
          <button
            onClick={handleUploadAudio}
            className="btn-outline text-xs px-3.5 py-2"
          >
            <Upload size={14} strokeWidth={2} />
            Import File
          </button>
          {!isRecording && (
            <button onClick={startRecording} className="btn-primary text-xs px-4 py-2">
              <span className="w-2 h-2 rounded-full bg-zinc-950" />
              New Recording
            </button>
          )}
        </div>
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-4 gap-3 px-6 pt-4 pb-2 flex-shrink-0">
        {/* Meetings */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5 group hover:border-violet-500/30 hover:-translate-y-0.5 transition-all duration-200 cursor-default shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 dark:text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Meetings</span>
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
              <Users size={13} strokeWidth={2} className="text-violet-500 dark:text-violet-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{metrics.totalMeetings}</div>
          <p className="text-slate-400 dark:text-zinc-600 text-[10px] mt-0.5">sessions recorded</p>
        </div>

        {/* Recorded Time */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5 group hover:border-sky-500/30 hover:-translate-y-0.5 transition-all duration-200 cursor-default shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 dark:text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Recorded Time</span>
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center flex-shrink-0">
              <Timer size={13} strokeWidth={2} className="text-sky-500 dark:text-sky-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {metrics.totalMinutes >= 60
              ? `${Math.floor(metrics.totalMinutes / 60)}h ${metrics.totalMinutes % 60}m`
              : `${metrics.totalMinutes}m`}
          </div>
          <p className="text-slate-400 dark:text-zinc-600 text-[10px] mt-0.5">total audio captured</p>
        </div>

        {/* This Week */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5 group hover:border-rose-500/30 hover:-translate-y-0.5 transition-all duration-200 cursor-default shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 dark:text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">This Week</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center flex-shrink-0">
              <CalendarDays size={13} strokeWidth={2} className="text-rose-500 dark:text-rose-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-500 dark:text-rose-400 tracking-tight">
            {metrics.weekMinutes >= 60
              ? `${Math.floor(metrics.weekMinutes / 60)}h ${metrics.weekMinutes % 60}m`
              : `${metrics.weekMinutes}m`}
          </div>
          <p className="text-slate-400 dark:text-zinc-600 text-[10px] mt-0.5">recorded this week</p>
        </div>

        {/* Notion Synced */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5 group hover:border-emerald-500/30 hover:-translate-y-0.5 transition-all duration-200 cursor-default shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 dark:text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Notion Synced</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <NotionIcon size={13} className="text-emerald-500 dark:text-emerald-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-500 dark:text-emerald-400 tracking-tight">{metrics.notionSynced}</div>
          <p className="text-slate-400 dark:text-zinc-600 text-[10px] mt-0.5">pages uploaded</p>
        </div>
      </div>

      {/* Scrollable content: upcoming meetings + past sessions */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
        {/* Upcoming Meetings (Google Calendar) */}
        <UpcomingMeetings
          onNavigateToSettings={onNavigateToSettings}
          onStartRecording={handleRecordFromCalendar}
          isRecording={isRecording}
          className=""
        />

        {/* Meeting starting toast */}
        {meetingToast && !isRecording && (
          <div className="fade-in">
            <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/5 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Mic size={15} className="text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-zinc-200 truncate">
                      "{meetingToast.title}" is starting now
                    </p>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Would you like to start recording?</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => {
                      handleRecordFromCalendar(meetingToast);
                      setMeetingToast(null);
                    }}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                    Start Recording
                  </button>
                  <button
                    onClick={() => setMeetingToast(null)}
                    className="btn-ghost p-1 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Divider between upcoming and past sessions */}
        <div className="flex items-center gap-3 pt-1">
          <div className="flex-1 h-px bg-slate-200 dark:bg-zinc-800/60" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-600">Recent Recordings</span>
          <div className="flex-1 h-px bg-slate-200 dark:bg-zinc-800/60" />
        </div>

        {/* Past session cards */}
        {recentSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onClick={() => onOpenSession(session)}
            onDelete={handleDelete}
            isDeleting={deletingIds.has(session.id)}
          />
        ))}
      </div>
    </div>
  );
}
