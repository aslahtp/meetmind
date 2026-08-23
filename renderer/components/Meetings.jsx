import React, { useEffect } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { useApp } from '../app.jsx';
import SessionCard, {
  SessionCardSkeleton,
  SkeletonBlock,
  EmptyState,
  useDelayedFlag,
  SKELETON_DELAY_MS,
  useSessionActions,
} from './SessionCard.jsx';

function MeetingsSkeleton() {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40">
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
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    </div>
  );
}

export default function Meetings({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording, sessionsLoading } = useApp();
  const { deletingIds, handleDelete, handleUploadAudio } = useSessionActions();
  const showSkeleton = useDelayedFlag(sessionsLoading, SKELETON_DELAY_MS);

  useEffect(() => {
    refreshSessions();
  }, []);

  if (sessionsLoading) {
    return showSkeleton ? <MeetingsSkeleton /> : <div className="h-full bg-slate-50 dark:bg-zinc-950/40" />;
  }

  if (sessions.length === 0) {
    return <EmptyState onRecord={startRecording} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40 fade-in">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 pt-3 pb-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-50/80 dark:bg-transparent backdrop-blur-md flex-shrink-0 titlebar-drag select-none">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Meeting Sessions</h1>
          <p className="text-slate-500 dark:text-zinc-400 text-xs mt-0.5">
            {sessions.length} meeting{sessions.length !== 1 ? 's' : ''} recorded
            {sessions.some((s) => s.status === 'error') && ' · Action required'}
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

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
        {sessions.map((session) => (
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
