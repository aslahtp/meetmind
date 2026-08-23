import React, { useState, useEffect } from 'react';
import {
  Mic,
  CalendarDays,
  Clock,
  Timer,
  Trash2,
  AlertCircle,
  Loader2,
  Sparkles,
  MessageCircle,
  Zap,
  Flame,
  ListChecks,
} from 'lucide-react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';

const SENTIMENT_BADGE = {
  positive: { cls: 'badge-green', Icon: Sparkles },
  neutral:  { cls: 'badge-gray',  Icon: MessageCircle },
  mixed:    { cls: 'badge-yellow', Icon: Zap },
  tense:    { cls: 'badge-red',   Icon: Flame },
};

const STATUS_BADGE = {
  complete:     { cls: 'badge-green', label: 'Complete' },
  recording:    { cls: 'badge-red',   label: 'Recording' },
  transcribing: { cls: 'badge-blue',  label: 'Transcribing' },
  generating:   { cls: 'badge-blue',  label: 'Generating' },
  uploading:    { cls: 'badge-yellow',label: 'Uploading' },
  error:        { cls: 'badge-red',   label: 'Error' },
};

export function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatStartTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDurationSeconds(secs) {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function getSessionDuration(session) {
  if (session.duration_seconds != null) return session.duration_seconds;
  if (session.started_at && session.ended_at) {
    const start = new Date(session.started_at).getTime();
    const end = new Date(session.ended_at).getTime();
    return Math.round((end - start) / 1000);
  }
  return null;
}

export function sessionDisplayTitle(session) {
  const title = session.title?.trim();
  if (title && title !== 'Untitled Meeting') return title;
  const d = session.started_at ? new Date(session.started_at) : null;
  if (d) return `Meeting — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return 'Untitled Meeting';
}

export function EmptyState({ onRecord }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 fade-in">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-3xl bg-emerald-500/20 blur-xl animate-pulse" />
        <div className="relative w-20 h-20 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-center shadow-2xl">
          <Mic size={36} strokeWidth={1.5} className="text-emerald-500 dark:text-emerald-400" />
        </div>
      </div>
      <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">No meeting notes yet</h2>
      <p className="text-slate-600 dark:text-zinc-400 text-sm mb-7 max-w-sm leading-relaxed">
        Start recording any online or in-person meeting to automatically transcribe, summarize, and extract key action items.
      </p>
      <button onClick={onRecord} className="btn-primary px-6 py-2.5 text-sm shadow-emerald-500/25">
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 animate-ping" />
        Start Recording
      </button>
    </div>
  );
}

export function SessionCard({ session, onClick, onDelete, isDeleting }) {
  const notes = session.notes;
  const sentimentObj = SENTIMENT_BADGE[notes?.sentiment] || { cls: 'badge-gray', Icon: MessageCircle };
  const SentimentIcon = sentimentObj.Icon;
  const statusInfo = STATUS_BADGE[session.status] || { cls: 'badge-gray', label: session.status };
  const durationSecs = getSessionDuration(session);
  const duration = formatDurationSeconds(durationSecs);
  const startTime = formatStartTime(session.started_at);
  const actionCount = notes?.action_items?.length || 0;
  const isError = session.status === 'error';

  return (
    <div
      className={`w-full transition-all ${
        isDeleting ? 'card-deleting pointer-events-none' : ''
      }`}
    >
      <button
        onClick={onClick}
        disabled={isDeleting}
        className="w-full text-left card bg-white dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800/50 hover:border-slate-300 dark:hover:border-zinc-700/80 transition-all duration-200 group relative overflow-hidden shadow-sm dark:shadow-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="font-semibold text-base text-slate-900 dark:text-zinc-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                {sessionDisplayTitle(session)}
              </h3>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-zinc-400">
              <span className="flex items-center gap-1 text-slate-500 dark:text-zinc-400">
                <CalendarDays size={12} strokeWidth={2} />
                {formatDate(session.started_at)}
              </span>
              {startTime && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} strokeWidth={2} />
                    {startTime}
                  </span>
                </>
              )}
              {duration != null && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-transparent font-mono text-[11px]">
                    <Timer size={10} strokeWidth={2} />
                    {duration}
                  </span>
                </>
              )}
              {session.meeting_url && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400/80 truncate max-w-[150px]">
                    {new URL(session.meeting_url).hostname.replace('www.', '')}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {session.status === 'complete' && notes?.sentiment && (
              <span className={sentimentObj.cls}>
                <SentimentIcon size={12} strokeWidth={2} />
                <span className="capitalize">{notes.sentiment}</span>
              </span>
            )}
            {session.status !== 'complete' && (
              <span className={statusInfo.cls}>{statusInfo.label}</span>
            )}
            <div
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(session);
              }}
              className={`p-1.5 rounded-lg transition-all ${
                isDeleting
                  ? 'opacity-100 bg-rose-500/20 text-rose-500'
                  : 'opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400'
              }`}
              title="Delete session"
            >
              {isDeleting ? (
                <Loader2 size={14} className="animate-spin text-rose-500" strokeWidth={2.5} />
              ) : (
                <Trash2 size={14} strokeWidth={2} />
              )}
            </div>
          </div>
        </div>

        {isError && (
          <p className="mt-2.5 text-rose-600 dark:text-rose-400/90 text-xs flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 rounded-md p-2">
            <AlertCircle size={14} strokeWidth={2} className="flex-shrink-0" />
            Recording was interrupted or needs retry. Click to view details.
          </p>
        )}

        {session.status === 'complete' && (
          <div className="flex items-center gap-4 mt-3.5 pt-3 border-t border-slate-200 dark:border-zinc-800/60 text-xs text-slate-500 dark:text-zinc-400">
            {actionCount > 0 && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400/90 font-medium">
                <ListChecks size={13} strokeWidth={2} />
                {actionCount} action item{actionCount !== 1 ? 's' : ''}
              </span>
            )}
            {session.notion_page_url && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <NotionIcon size={14} />
                Notion Synced
              </span>
            )}
            {(notes?.topics?.length || notes?.key_points?.length) > 0 && (
              <span className="text-slate-400 dark:text-zinc-500">
                {(notes.topics?.length || notes.key_points.length)} topic{(notes.topics?.length || notes.key_points.length) !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

export function SkeletonBlock({ className = '' }) {
  return <div className={`bg-slate-200 dark:bg-zinc-800 animate-pulse ${className}`} />;
}

export function SessionCardSkeleton() {
  return (
    <div className="w-full">
      {/* Matches the .card padding/border/radius of a real SessionCard so it occupies the same footprint */}
      <div className="card cursor-default">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <SkeletonBlock className="h-4 w-56 rounded mb-2.5" />
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-3 w-24 rounded" />
              <SkeletonBlock className="h-3 w-16 rounded" />
              <SkeletonBlock className="h-3 w-14 rounded" />
            </div>
          </div>
          <SkeletonBlock className="h-[22px] w-20 rounded-full flex-shrink-0" />
        </div>
        <div className="flex items-center gap-4 mt-3.5 pt-3 border-t border-slate-200 dark:border-zinc-800/60">
          <SkeletonBlock className="h-3 w-24 rounded" />
          <SkeletonBlock className="h-3 w-20 rounded" />
        </div>
      </div>
    </div>
  );
}

// Sessions come from a local SQLite file and normally load in well under 100ms.
// Showing the skeleton instantly would just swap one flash for another, so only
// reveal it if loading is actually slow enough to look like a hang.
export const SKELETON_DELAY_MS = 160;

export function useDelayedFlag(active, delayMs) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return visible;
}

export function useSessionActions() {
  const { refreshSessions } = useApp();
  const [deletingIds, setDeletingIds] = useState(new Set());

  const handleDelete = async (session) => {
    if (deletingIds.has(session.id)) return;
    if (window.confirm('Are you sure you want to delete this session? This cannot be undone.')) {
      setDeletingIds((prev) => new Set(prev).add(session.id));
      setTimeout(async () => {
        try {
          await window.meetmind.sessions.delete(session.id);
          refreshSessions();
        } catch (err) {
          window.alert('Failed to delete session: ' + err.message);
          setDeletingIds((prev) => {
            const next = new Set(prev);
            next.delete(session.id);
            return next;
          });
        }
      }, 480);
    }
  };

  const handleUploadAudio = async () => {
    try {
      const result = await window.meetmind.recording.uploadFile();
      if (result?.success) {
        await refreshSessions();
      } else if (result?.error && !result.cancelled) {
        window.alert(result.error);
      }
    } catch (err) {
      window.alert(err.message || 'Failed to import audio file.');
    }
  };

  return { deletingIds, handleDelete, handleUploadAudio };
}

export default SessionCard;
