import React, { useEffect } from 'react';
import { useApp } from '../app.jsx';

const SENTIMENT_BADGE = {
  positive: 'badge-green',
  neutral:  'badge-gray',
  mixed:    'badge-yellow',
  tense:    'badge-red',
};

const STATUS_BADGE = {
  complete:     { cls: 'badge-green',  label: 'Complete'    },
  recording:    { cls: 'badge-red',    label: 'Recording'   },
  transcribing: { cls: 'badge-blue',   label: 'Transcribing'},
  generating:   { cls: 'badge-blue',   label: 'Generating'  },
  uploading:    { cls: 'badge-yellow', label: 'Uploading'   },
  error:        { cls: 'badge-red',    label: 'Error'       },
};

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDurationSeconds(secs) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${s}s`;
}

function EmptyState({ onRecord }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-[#212121] border border-[#333] flex items-center justify-center mb-5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>
        </svg>
      </div>
      <h2 className="text-lg font-semibold mb-2">No meetings yet</h2>
      <p className="text-[#666] text-sm mb-6 max-w-xs">
        Start recording a meeting to automatically generate AI-powered notes and summaries.
      </p>
      <button onClick={onRecord} className="btn-primary">
        <span className="w-2 h-2 rounded-full bg-white"></span>
        Start Recording
      </button>
    </div>
  );
}

function SessionCard({ session, onClick }) {
  const notes = session.notes;
  const sentimentClass = SENTIMENT_BADGE[notes?.sentiment] || 'badge-gray';
  const statusInfo = STATUS_BADGE[session.status] || { cls: 'badge-gray', label: session.status };
  const duration = formatDurationSeconds(session.duration_seconds);
  const actionCount = notes?.action_items?.length || 0;

  return (
    <button
      onClick={onClick}
      className="w-full text-left card hover:border-[#444] hover:bg-[#252525] transition-all duration-150 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm text-white truncate group-hover:text-green-400 transition-colors">
            {session.title || 'Untitled Meeting'}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[#666] text-xs">{formatDate(session.started_at)}</span>
            {duration && (
              <>
                <span className="text-[#444] text-xs">·</span>
                <span className="text-[#666] text-xs">{duration}</span>
              </>
            )}
            {session.meeting_url && (
              <>
                <span className="text-[#444] text-xs">·</span>
                <span className="text-[#555] text-xs truncate max-w-[140px]">
                  {new URL(session.meeting_url).hostname.replace('www.', '')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {session.status === 'complete' && notes?.sentiment && (
            <span className={sentimentClass}>{notes.sentiment}</span>
          )}
          {session.status !== 'complete' && (
            <span className={statusInfo.cls}>{statusInfo.label}</span>
          )}
        </div>
      </div>

      {session.status === 'complete' && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#2a2a2a]">
          {actionCount > 0 && (
            <span className="text-[#888] text-xs flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              {actionCount} action item{actionCount !== 1 ? 's' : ''}
            </span>
          )}
          {session.notion_page_url && (
            <span className="text-green-700 text-xs flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 4h16v16H4V4z"/>
              </svg>
              Synced to Notion
            </span>
          )}
          {notes?.key_points?.length > 0 && (
            <span className="text-[#888] text-xs">
              {notes.key_points.length} topic{notes.key_points.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function Dashboard({ onOpenSession }) {
  const { sessions, refreshSessions, startRecording, isRecording } = useApp();

  useEffect(() => {
    refreshSessions();
  }, []);

  if (sessions.length === 0) {
    return <EmptyState onRecord={startRecording} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Sessions</h1>
          <p className="text-[#666] text-xs mt-0.5">{sessions.length} meeting{sessions.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshSessions}
            className="btn-ghost p-2"
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
          {!isRecording && (
            <button onClick={startRecording} className="btn-primary text-xs">
              <span className="w-2 h-2 rounded-full bg-white"></span>
              New Recording
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onClick={() => onOpenSession(session)}
          />
        ))}
      </div>
    </div>
  );
}
