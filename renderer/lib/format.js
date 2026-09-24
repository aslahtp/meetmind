// Shared date / time / duration formatting for the renderer.

export function formatDate(isoString, { year = true } = {}) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  });
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// 75 → "1m 15s", 4000 → "1h 6m"
export function formatDurationSeconds(secs) {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Input in minutes: 75 → "1h 15m", 42 → "42m"
export function formatMinutes(totalMinutes) {
  const mins = Math.round(totalMinutes || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Stopwatch style: 75 → "01:15", 3725 → "1:02:05"
export function formatClock(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function dayLabel(isoString) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (isSameDay(isoString, today)) return 'Today';
  if (isSameDay(isoString, tomorrow)) return 'Tomorrow';
  return formatDate(isoString, { year: false });
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

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
