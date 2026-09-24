import React from 'react';
import { Trash2, Loader2, ListChecks, Video, RotateCcw } from 'lucide-react';
import { useApp } from '../app.jsx';
import NotionIcon from './NotionIcon.jsx';
import { IconButton, StatusPill, StatusDot, Skeleton } from './ui/index.jsx';
import {
  formatDate,
  formatTime,
  formatDurationSeconds,
  getSessionDuration,
  sessionDisplayTitle,
} from '../lib/format.js';
import { meetingHostname, meetingPlatform } from '../lib/platform.js';
import { useSessionActions } from '../lib/hooks.js';

export function SessionCard({ session, onOpen, onDelete, onRetry, isDeleting }) {
  const notes = session.notes;
  const duration = formatDurationSeconds(getSessionDuration(session));
  const startTime = formatTime(session.started_at);
  const actionCount = notes?.action_items?.length || 0;
  const topicCount = notes?.topics?.length || notes?.key_points?.length || 0;
  const isComplete = session.status === 'complete';
  const isError = session.status === 'error';
  const platform = meetingPlatform(session.meeting_url);
  const hostname = meetingHostname(session.meeting_url);
  const hasFooter = isComplete && (actionCount > 0 || session.notion_page_url || platform || topicCount > 0);

  const meta = [formatDate(session.started_at), startTime, duration].filter(Boolean);

  return (
    <article
      className={`group relative card-compact py-16 transition-colors duration-150 hover:bg-ink/[0.03] ${
        isDeleting ? 'card-deleting' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-16">
        <div className="flex-1 min-w-0">
          {/* Stretched link: the title button covers the whole card. */}
          <button
            type="button"
            onClick={onOpen}
            disabled={isDeleting}
            className="block max-w-full text-left text-subheading font-medium text-ink truncate group-hover:underline underline-offset-4 after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-ink focus-visible:after:outline-offset-2"
          >
            {sessionDisplayTitle(session)}
          </button>
          <p className="text-caption text-graphite mt-4 tabular">
            {meta.join(' · ')}
          </p>
        </div>

        <div className="relative z-[1] flex items-center gap-8 flex-shrink-0">
          {isComplete && notes?.sentiment ? (
            <span className="pill-quiet capitalize">{notes.sentiment}</span>
          ) : !isComplete ? (
            <StatusPill status={session.status} />
          ) : null}
          <IconButton
            label={`Delete ${sessionDisplayTitle(session)}`}
            onClick={() => onDelete(session)}
            disabled={isDeleting}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-signal hover:border-signal"
          >
            {isDeleting
              ? <Loader2 size={16} strokeWidth={1.75} className="spinner" />
              : <Trash2 size={16} strokeWidth={1.75} />}
          </IconButton>
        </div>
      </div>

      {isError && (
        <div className="relative z-[1] flex flex-wrap items-center justify-between gap-16 mt-16 pt-8 rule">
          <p className="flex items-center gap-8 text-caption text-ink">
            <StatusDot tone="error" />
            Processing failed. Open the meeting for details, or retry.
          </p>
          <button type="button" className="btn-ghost px-16 py-4 text-caption" onClick={() => onRetry(session)}>
            <RotateCcw size={14} strokeWidth={1.75} />
            Retry
          </button>
        </div>
      )}

      {hasFooter && (
        <div className="flex flex-wrap items-center gap-16 mt-16 pt-8 rule text-caption text-graphite">
          {actionCount > 0 && (
            <span className="flex items-center gap-8 text-ink">
              <ListChecks size={16} strokeWidth={1.75} />
              {actionCount} action item{actionCount !== 1 ? 's' : ''}
            </span>
          )}
          {session.notion_page_url && (
            <span className="flex items-center gap-8">
              <StatusDot tone="ok" />
              <NotionIcon size={14} />
              In Notion
            </span>
          )}
          {platform && (
            <span className="flex items-center gap-8">
              {platform.icon
                ? <img src={platform.icon} alt="" className="w-16 h-16 object-contain logo-mono" />
                : <Video size={16} strokeWidth={1.75} />}
              {hostname || platform.name}
            </span>
          )}
          {topicCount > 0 && (
            <span>{topicCount} topic{topicCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}
    </article>
  );
}

export function SessionCardSkeleton() {
  return (
    <div className="card-compact py-16" aria-hidden="true">
      <div className="flex items-start justify-between gap-16">
        <div className="flex-1 min-w-0">
          <Skeleton className="h-24 w-[45%]" />
          <Skeleton className="h-16 w-[30%] mt-8" />
        </div>
        <Skeleton className="h-32 w-[96px] rounded-full" />
      </div>
    </div>
  );
}

export function SessionListSkeleton({ count = 3 }) {
  return (
    <div className="flex flex-col gap-16" aria-busy="true" aria-label="Loading meetings">
      {Array.from({ length: count }, (_, i) => <SessionCardSkeleton key={i} />)}
    </div>
  );
}

// Session list shared by Dashboard and Meetings: wires delete + retry actions.
export function SessionList({ sessions, onOpenSession }) {
  const { trackProcessing } = useApp();
  const { deletingIds, handleDelete, handleRetry } = useSessionActions();

  const onRetry = (session) => {
    trackProcessing(session.id);
    handleRetry(session);
  };

  return (
    <div className="flex flex-col gap-16">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onOpen={() => onOpenSession(session)}
          onDelete={handleDelete}
          onRetry={onRetry}
          isDeleting={deletingIds.has(session.id)}
        />
      ))}
    </div>
  );
}

export default SessionCard;
