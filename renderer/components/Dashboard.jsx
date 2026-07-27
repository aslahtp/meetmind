import React, { useEffect, useMemo } from 'react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';

const SENTIMENT_BADGE = {
  positive: { cls: 'badge-green', icon: '✨' },
  neutral:  { cls: 'badge-gray',  icon: '💬' },
  mixed:    { cls: 'badge-yellow',icon: '⚡' },
  tense:    { cls: 'badge-red',   icon: '🔥' },
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
        <div className="relative w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-2xl">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-400">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-bold tracking-tight text-white mb-2">No meeting notes yet</h2>
      <p className="text-zinc-400 text-sm mb-7 max-w-sm leading-relaxed">
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

function SessionCard({ session, onClick, onDelete }) {
  const notes = session.notes;
  const sentimentObj = SENTIMENT_BADGE[notes?.sentiment] || { cls: 'badge-gray', icon: '💬' };
  const statusInfo = STATUS_BADGE[session.status] || { cls: 'badge-gray', label: session.status };
  const durationSecs = getSessionDuration(session);
  const duration = formatDurationSeconds(durationSecs);
  const startTime = formatStartTime(session.started_at);
  const actionCount = notes?.action_items?.length || 0;
  const isError = session.status === 'error';

  return (
    <button
      onClick={onClick}
      className="w-full text-left card bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700/80 transition-all duration-200 group relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="font-semibold text-base text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
              {sessionDisplayTitle(session)}
            </h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400">
            <span className="flex items-center gap-1 text-zinc-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {formatDate(session.started_at)}
            </span>
            {startTime && (
              <>
                <span className="text-zinc-600">·</span>
                <span>{startTime}</span>
              </>
            )}
            {duration != null && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300 font-mono text-[11px]">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {duration}
                </span>
              </>
            )}
            {session.meeting_url && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-emerald-400/80 truncate max-w-[150px]">
                  {new URL(session.meeting_url).hostname.replace('www.', '')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {session.status === 'complete' && notes?.sentiment && (
            <span className={sentimentObj.cls}>
              <span>{sentimentObj.icon}</span>
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
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500/20 text-zinc-500 hover:text-rose-400"
            title="Delete session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
        </div>
      </div>

      {isError && (
        <p className="mt-2.5 text-rose-400/90 text-xs flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 rounded-md p-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Recording was interrupted or needs retry. Click to view details.
        </p>
      )}

      {session.status === 'complete' && (
        <div className="flex items-center gap-4 mt-3.5 pt-3 border-t border-zinc-800/60 text-xs text-zinc-400">
          {actionCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400/90 font-medium">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {actionCount} action item{actionCount !== 1 ? 's' : ''}
            </span>
          )}
          {session.notion_page_url && (
            <span className="text-emerald-400 font-medium flex items-center gap-1.5">
              <NotionIcon size={14} />
              Notion Synced
            </span>
          )}
          {notes?.key_points?.length > 0 && (
            <span className="text-zinc-500">
              {notes.key_points.length} key point{notes.key_points.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function Dashboard({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording } = useApp();

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
    if (window.confirm('Are you sure you want to delete this session? This cannot be undone.')) {
      try {
        await window.meetmind.sessions.delete(session.id);
        refreshSessions();
      } catch (err) {
        window.alert('Failed to delete session: ' + err.message);
      }
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
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950/40 fade-in">
      {/* Top Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 backdrop-blur-md flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Meeting Sessions</h1>
          <p className="text-zinc-400 text-xs mt-0.5">
            {sessions.length} meeting{sessions.length !== 1 ? 's' : ''} recorded
            {sessions.some((s) => s.status === 'error') && ' · Action required'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={refreshSessions}
            className="btn-ghost p-2 text-zinc-400 hover:text-white"
            title="Refresh list"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            onClick={handleUploadAudio}
            className="btn-outline text-xs px-3.5 py-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
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
        <div className="card py-3 px-4 bg-zinc-900/50 border-zinc-800/60">
          <span className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Meetings</span>
          <div className="text-lg font-bold text-white mt-0.5">{metrics.totalMeetings}</div>
        </div>
        <div className="card py-3 px-4 bg-zinc-900/50 border-zinc-800/60">
          <span className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Recorded Time</span>
          <div className="text-lg font-bold text-white mt-0.5">{metrics.totalMinutes}m</div>
        </div>
        <div className="card py-3 px-4 bg-zinc-900/50 border-zinc-800/60">
          <span className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Action Items</span>
          <div className="text-lg font-bold text-amber-400 mt-0.5">{metrics.actionItems}</div>
        </div>
        <div className="card py-3 px-4 bg-zinc-900/50 border-zinc-800/60">
          <span className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Notion Synced</span>
          <div className="text-lg font-bold text-emerald-400 mt-0.5">{metrics.notionSynced}</div>
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
          />
        ))}
      </div>
    </div>
  );
}

