import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Users,
  Video,
  RefreshCw,
  MapPin,
} from 'lucide-react';
import GoogleCalendarIcon from './GoogleCalendarIcon.jsx';
import { IconButton, StatusDot, Skeleton, AvatarTile } from './ui/index.jsx';
import { formatTime, dayLabel } from '../lib/format.js';
import { meetingPlatform } from '../lib/platform.js';
import { useNow } from '../lib/hooks.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SOON_WINDOW_MS = 15 * 60 * 1000;
const COLLAPSED_KEY = 'meetmind.upcomingCollapsed';

function getEventStatus(event, now) {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();

  if (event.isAllDay) return 'all-day';
  if (now >= start && now <= end) return 'in-progress';
  if (start - now <= SOON_WINDOW_MS && start - now > 0) return 'starting-soon';
  return 'upcoming';
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch { /* storage unavailable — collapse still works for this session */ }
}

function EventCard({ event, onStartRecording, isRecording, now }) {
  const status = getEventStatus(event, now);
  const platform = meetingPlatform(event.meetingLink);
  const isLive = status === 'in-progress';
  const isSoon = status === 'starting-soon';
  const minutesUntil = Math.max(1, Math.ceil((new Date(event.start).getTime() - now) / 60000));

  const meta = [];
  if (event.isAllDay) meta.push(<span key="time">All day</span>);
  else meta.push(<span key="time" className="tabular">{formatTime(event.start)} – {formatTime(event.end)}</span>);
  if (event.attendeeCount > 1) {
    meta.push(
      <span key="people" className="flex items-center gap-4">
        <Users size={14} strokeWidth={1.75} />
        {event.attendeeCount}
      </span>
    );
  }
  if (event.location && !event.meetingLink) {
    meta.push(
      <span key="loc" className="flex items-center gap-4 truncate max-w-[160px]">
        <MapPin size={14} strokeWidth={1.75} />
        {event.location}
      </span>
    );
  }
  if (platform) {
    meta.push(
      <span key="platform" className="flex items-center gap-4">
        {platform.icon
          ? <img src={platform.icon} alt="" className="w-16 h-16 object-contain logo-mono" />
          : <Video size={14} strokeWidth={1.75} />}
        {platform.name}
      </span>
    );
  }

  return (
    <div className={`card-compact py-16 ${isLive ? 'border-2' : ''}`}>
      <div className="flex items-center justify-between gap-16">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-8 min-w-0">
            {isLive && (
              <span className="flex items-center gap-8 text-caption font-medium text-ink flex-shrink-0">
                <StatusDot tone="ok" className="dot-live" />
                Live now
              </span>
            )}
            {isSoon && <span className="highlight flex-shrink-0">In {minutesUntil} min</span>}
            <h4 className="text-body-sm font-medium text-ink truncate">{event.title}</h4>
          </div>

          <div className="flex items-center gap-8 flex-wrap text-caption text-graphite mt-4">
            {meta.map((item, i) => (
              <React.Fragment key={item.key}>
                {i > 0 && <span aria-hidden="true">·</span>}
                {item}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-8 flex-shrink-0">
          {event.meetingLink && (
            <button
              type="button"
              onClick={() => window.meetmind.shell.openExternal(event.meetingLink)}
              className="btn-ghost btn-sm"
            >
              <ExternalLink size={14} strokeWidth={1.75} />
              Join
            </button>
          )}
          {(isLive || isSoon) && !event.isAllDay && !isRecording && (
            <button
              type="button"
              onClick={() => onStartRecording(event)}
              className="btn-ink btn-sm"
            >
              <span className="dot dot-sm dot-signal" aria-hidden="true" />
              Record
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonEvent() {
  return (
    <div className="card-compact py-16" aria-hidden="true">
      <div className="flex items-center justify-between gap-16">
        <div className="flex-1">
          <Skeleton className="h-16 w-[40%]" />
          <Skeleton className="h-16 w-[25%] mt-8" />
        </div>
        <Skeleton className="h-32 w-[72px] rounded-full" />
      </div>
    </div>
  );
}

export default function UpcomingMeetings({ onNavigateToSettings, onStartRecording, isRecording, className = '' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(60_000);

  const fetchEvents = useCallback(async (showRefreshState = false) => {
    if (!window.meetmind?.calendar) {
      setConnected(false);
      setLoading(false);
      return;
    }

    if (showRefreshState) setRefreshing(true);

    try {
      const status = await window.meetmind.calendar.getStatus();
      setConnected(status.connected);

      if (!status.connected) {
        setEvents([]);
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

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });
  };

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
      label: dayLabel(evts[0].start),
      events: evts,
    }));
  }, [events]);

  if (!loading && !connected) {
    return (
      <section className={className}>
        <button
          type="button"
          onClick={onNavigateToSettings}
          className="w-full card-compact text-left flex items-center gap-16 transition-colors duration-150 hover:bg-ink/[0.03]"
        >
          <AvatarTile size={48}>
            <GoogleCalendarIcon size={20} />
          </AvatarTile>
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-medium text-ink">Connect Google Calendar</p>
            <p className="text-caption text-graphite mt-4">See upcoming meetings and get a prompt to record when they start.</p>
          </div>
          <ChevronRight size={18} strokeWidth={1.75} className="text-graphite flex-shrink-0" />
        </button>
      </section>
    );
  }

  const errorUrl = error?.match(/https?:\/\/[^\s]+/)?.[0];

  return (
    <section className={className} aria-labelledby="upcoming-heading">
      <div className="flex items-center justify-between gap-16 mb-16">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="upcoming-list"
          className="flex items-center gap-8 text-graphite hover:text-ink transition-colors duration-150"
        >
          {collapsed ? <ChevronRight size={16} strokeWidth={1.75} /> : <ChevronDown size={16} strokeWidth={1.75} />}
          <GoogleCalendarIcon size={16} />
          <span id="upcoming-heading" className="eyebrow">Upcoming meetings</span>
          {events.length > 0 && <span className="pill-quiet tabular">{events.length}</span>}
        </button>
        <IconButton label="Refresh calendar events" onClick={() => fetchEvents(true)} disabled={refreshing}>
          <RefreshCw size={16} strokeWidth={1.75} className={refreshing ? 'spinner' : ''} />
        </IconButton>
      </div>

      {!collapsed && (
        <div id="upcoming-list" className="flex flex-col gap-24 fade-in">
          {loading ? (
            <div className="flex flex-col gap-8">
              <SkeletonEvent />
              <SkeletonEvent />
            </div>
          ) : error ? (
            <div className="card-compact" role="alert">
              <div className="flex items-start gap-16">
                <StatusDot tone="error" className="mt-4" />
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm text-ink">
                    {error.includes('http') ? error.split('http')[0].replace(/:\s*$/, '') : error}
                  </p>
                  {(errorUrl || error.includes('Settings')) && (
                    <div className="flex flex-wrap items-center gap-8 mt-16">
                      {errorUrl && (
                        <button
                          type="button"
                          onClick={() => window.meetmind.shell.openExternal(errorUrl)}
                          className="btn-ghost btn-sm"
                        >
                          <ExternalLink size={14} strokeWidth={1.75} />
                          Enable Google Calendar API
                        </button>
                      )}
                      {error.includes('Settings') && (
                        <button type="button" onClick={onNavigateToSettings} className="btn-ghost btn-sm">
                          Go to Settings
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : events.length === 0 ? (
            <p className="text-caption text-graphite">No upcoming meetings.</p>
          ) : (
            groupedEvents.map((group) => (
              <div key={group.dateKey}>
                <p className="eyebrow mb-8">{group.label}</p>
                <div className="flex flex-col gap-8">
                  {group.events.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onStartRecording={onStartRecording}
                      isRecording={isRecording}
                      now={now}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
