import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarDays,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Mic,
  Users,
  Video,
  RefreshCw,
  Loader2,
  Link2,
  MapPin,
  AlertCircle,
} from 'lucide-react';
import GoogleCalendarIcon from './GoogleCalendarIcon.jsx';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function formatEventTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatEventDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getEventStatus(event) {
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();

  if (event.isAllDay) return 'all-day';
  if (now >= start && now <= end) return 'in-progress';
  if (start - now <= 15 * 60 * 1000 && start - now > 0) return 'starting-soon';
  return 'upcoming';
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

function isTomorrow(dateStr) {
  const d = new Date(dateStr);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString();
}

function getDayLabel(dateStr) {
  if (isToday(dateStr)) return 'Today';
  if (isTomorrow(dateStr)) return 'Tomorrow';
  return formatEventDate(dateStr);
}

function getMeetingPlatform(url) {
  if (!url) return null;
  if (url.includes('meet.google.com')) return { name: 'Google Meet', color: 'text-emerald-500 dark:text-emerald-400', icon: 'icons/google-meet.png' };
  if (url.includes('zoom.us') || url.includes('zoom.com')) return { name: 'Zoom', color: 'text-blue-500 dark:text-blue-400' };
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return { name: 'Teams', color: 'text-violet-500 dark:text-violet-400' };
  return { name: 'Video Call', color: 'text-sky-500 dark:text-sky-400' };
}

function EventCard({ event, onStartRecording, isRecording }) {
  const status = getEventStatus(event);
  const platform = getMeetingPlatform(event.meetingLink);
  const isLive = status === 'in-progress';
  const isSoon = status === 'starting-soon';

  return (
    <div
      className={`relative overflow-hidden rounded-lg border transition-all duration-200 group ${
        isLive
          ? 'border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-500/5'
          : isSoon
          ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/5'
          : 'border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40'
      } hover:border-indigo-500/30 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/5`}
    >
      <div className="px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <div className="flex items-center gap-2 mb-1">
              {isLive && (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              )}
              {isSoon && (
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <Clock size={10} strokeWidth={2.5} />
                  Soon
                </span>
              )}
              <h4 className="text-sm font-medium text-slate-800 dark:text-zinc-200 truncate leading-tight">
                {event.title}
              </h4>
            </div>

            {/* Time + metadata */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-zinc-400">
              {!event.isAllDay && (
                <span className="flex items-center gap-1">
                  <Clock size={11} strokeWidth={2} />
                  {formatEventTime(event.start)}
                  <span className="text-slate-300 dark:text-zinc-600">—</span>
                  {formatEventTime(event.end)}
                </span>
              )}
              {event.isAllDay && (
                <span className="flex items-center gap-1 text-slate-400 dark:text-zinc-500">
                  All day
                </span>
              )}
              {event.attendeeCount > 1 && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className="flex items-center gap-1">
                    <Users size={11} strokeWidth={2} />
                    {event.attendeeCount}
                  </span>
                </>
              )}
              {event.location && !event.meetingLink && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className="flex items-center gap-1 truncate max-w-[120px]">
                    <MapPin size={11} strokeWidth={2} />
                    {event.location}
                  </span>
                </>
              )}
              {platform && (
                <>
                  <span className="text-slate-300 dark:text-zinc-600">·</span>
                  <span className={`flex items-center gap-1 font-medium ${platform.color}`}>
                    {platform.icon
                      ? <img src={platform.icon} alt={platform.name} className="w-3 h-3 object-contain" />
                      : <Video size={11} strokeWidth={2} />}
                    {platform.name}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {event.meetingLink && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.meetmind.shell.openExternal(event.meetingLink);
                }}
                className="btn-ghost text-[11px] px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
                title="Join meeting"
              >
                <ExternalLink size={11} strokeWidth={2} />
                Join
              </button>
            )}
            {(isLive || isSoon) && !event.isAllDay && !isRecording && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRecording(event);
                }}
                className="btn-primary text-[11px] px-2.5 py-1 shadow-sm"
                title="Start recording this meeting"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                Record
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonEvent() {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40 px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="h-3.5 w-44 bg-slate-200 dark:bg-zinc-800 rounded animate-pulse mb-2" />
          <div className="flex gap-2">
            <div className="h-3 w-24 bg-slate-200 dark:bg-zinc-800 rounded animate-pulse" />
            <div className="h-3 w-16 bg-slate-200 dark:bg-zinc-800 rounded animate-pulse" />
          </div>
        </div>
        <div className="h-6 w-14 bg-slate-200 dark:bg-zinc-800 rounded animate-pulse" />
      </div>
    </div>
  );
}

export default function UpcomingMeetings({ onNavigateToSettings, onStartRecording, isRecording, className = '' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(async (showRefreshState = false) => {
    if (!window.meetmind?.calendar) return;

    if (showRefreshState) setRefreshing(true);

    try {
      const status = await window.meetmind.calendar.getStatus();
      setConnected(status.connected);

      if (!status.connected) {
        setEvents([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const result = await window.meetmind.calendar.getEvents();
      if (result.success) {
        setEvents(result.events || []);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => fetchEvents(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Group events by day
  const groupedEvents = useMemo(() => {
    const groups = {};
    for (const event of events) {
      const dateKey = new Date(event.start).toDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    }
    return Object.entries(groups).map(([dateKey, evts]) => ({
      dateKey,
      label: getDayLabel(evts[0].start),
      events: evts,
    }));
  }, [events]);

  // Don't render the section at all if not connected
  if (!loading && !connected) {
    return (
      <div className={className}>
        <button
          onClick={onNavigateToSettings}
          className="w-full rounded-xl border border-dashed border-slate-300 dark:border-zinc-700/60 bg-white/50 dark:bg-zinc-900/30 px-4 py-3 text-left hover:border-indigo-500/40 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/5 transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <GoogleCalendarIcon size={15} className="text-indigo-500 dark:text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-zinc-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                Connect Google Calendar
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
                See upcoming meetings and get recording prompts
              </p>
            </div>
            <ChevronRight size={16} className="text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 transition-colors" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors"
        >
          {collapsed ? <ChevronRight size={13} strokeWidth={2.5} /> : <ChevronDown size={13} strokeWidth={2.5} />}
          <GoogleCalendarIcon size={13} className="text-indigo-500 dark:text-indigo-400" />
          Upcoming Meetings
          {events.length > 0 && (
            <span className="ml-1 text-[10px] font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 rounded-full px-1.5 py-0.5 normal-case">
              {events.length}
            </span>
          )}
        </button>
        <button
          onClick={() => fetchEvents(true)}
          disabled={refreshing}
          className="btn-ghost p-1.5 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"
          title="Refresh events"
        >
          <RefreshCw size={12} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Collapsible content */}
      {!collapsed && (
        <div className="space-y-3 fade-in">
          {loading ? (
            <div className="space-y-2">
              <SkeletonEvent />
              <SkeletonEvent />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={15} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="leading-relaxed font-medium">
                    {error.includes('http') ? error.split('http')[0].replace(/:\s*$/, '') : error}
                  </p>
                  {error.includes('http') && (
                    <button
                      type="button"
                      onClick={() => {
                        const match = error.match(/https?:\/\/[^\s]+/);
                        if (match) window.meetmind.shell.openExternal(match[0]);
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 font-medium transition-colors"
                    >
                      <ExternalLink size={12} />
                      Enable Google Calendar API in Google Cloud Console
                    </button>
                  )}
                  {error.includes('Settings') && (
                    <button
                      type="button"
                      onClick={onNavigateToSettings}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-300 font-medium transition-colors"
                    >
                      Go to Settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-3">
              <p className="text-xs text-slate-400 dark:text-zinc-500">No upcoming meetings</p>
            </div>
          ) : (
            groupedEvents.map((group) => (
              <div key={group.dateKey}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-600 mb-1.5 px-0.5">
                  {group.label}
                </p>
                <div className="space-y-1.5">
                  {group.events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onStartRecording={onStartRecording}
                      isRecording={isRecording}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
