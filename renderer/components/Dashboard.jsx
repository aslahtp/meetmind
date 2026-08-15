import React, { useState, useEffect, useMemo } from 'react';
import {
  Mic,
  CalendarDays,
  Clock,
  Timer,
  Trash2,
  AlertCircle,
  RefreshCw,
  Upload,
  Users,
  ListChecks,
  Sparkles,
  MessageCircle,
  Zap,
  Flame,
  Loader2,
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

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatStartTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDurationSeconds(secs) {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getSessionDuration(session) {
  if (session.duration_seconds != null) return session.duration_seconds;
  if (session.started_at && session.ended_at) {
    const start = new Date(session.started_at).getTime();
    const end = new Date(session.ended_at).getTime();
    return Math.round((end - start) / 1000);
  }
  return null;
}

function EmptyState({ onRecord }) {
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

function sessionDisplayTitle(session) {
  const title = session.title?.trim();
  if (title && title !== 'Untitled Meeting') return title;
  const d = session.started_at ? new Date(session.started_at) : null;
  if (d) return `Meeting — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return 'Untitled Meeting';
}

function SessionCard({ session, onClick, onDelete, isDeleting }) {
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

export default function Dashboard({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording } = useApp();
  const [deletingIds, setDeletingIds] = useState(new Set());

  const metrics = useMemo(() => {
    const completed = sessions.filter((s) => s.status === 'complete');
    const totalSecs = sessions.reduce((acc, s) => acc + (getSessionDuration(s) || 0), 0);
    const actionItemsCount = completed.reduce((acc, s) => acc + (s.notes?.action_items?.length || 0), 0);
    const notionCount = sessions.filter((s) => s.notion_page_url).length;

    return {
      totalMeetings: sessions.length,
      totalMinutes: Math.round(totalSecs / 60),
      actionItems: actionItemsCount,
      notionSynced: notionCount,
    };
  }, [sessions]);

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

  useEffect(() => {
    refreshSessions();
  }, []);

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

        {/* Action Items */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/60 px-4 py-3.5 group hover:border-amber-500/30 hover:-translate-y-0.5 transition-all duration-200 cursor-default shadow-sm dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 dark:text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Action Items</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <ListChecks size={13} strokeWidth={2} className="text-amber-500 dark:text-amber-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-500 dark:text-amber-400 tracking-tight">{metrics.actionItems}</div>
          <p className="text-slate-400 dark:text-zinc-600 text-[10px] mt-0.5">tasks extracted</p>
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
