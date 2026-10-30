// Pure rules for calendar events from any source: finding the meeting link, merging several
// calendars into one list (the same meeting in two calendars shows once), and deciding when a
// "meeting starting" prompt is due. No electron imports, so it's unit-testable.

const REMINDER_WINDOW_MS = 60_000;
const NOTIFIED_MEMORY_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;

// Hosts whose links are video calls. Matched on the URL's hostname, so a "meet" in some
// unrelated link (meetup.com, a doc called "meeting notes") no longer counts.
const MEETING_HOST = /(?:^|\.)(?:meet\.google\.com|zoom\.us|zoom\.com|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|gotomeet\.me|meet\.jit\.si|chime\.aws|around\.co)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]+/gi;

function isMeetingUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (MEETING_HOST.test(url.hostname)) return true;
    // Cal.com's own video rooms.
    return /(?:^|\.)cal\.com$/i.test(url.hostname) && url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

function findMeetingUrl(text) {
  if (!text) return '';
  for (const match of String(text).matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, '');
    if (isMeetingUrl(candidate)) return candidate;
  }
  return '';
}

/**
 * The link to join the meeting. `conferenceUrls` are fields made for it (Google's hangoutLink
 * and conference entry points, the X-GOOGLE-CONFERENCE / X-MICROSOFT-* ICS properties) and win
 * outright; then the event's URL, description and location are searched for a known video host.
 */
function extractMeetingLink({ conferenceUrls = [], url = '', description = '', location = '' } = {}) {
  for (const candidate of conferenceUrls) {
    if (candidate && /^https?:\/\//i.test(String(candidate).trim())) return String(candidate).trim();
  }
  return findMeetingUrl(url) || findMeetingUrl(description) || findMeetingUrl(location);
}

/**
 * Milliseconds for an event time. All-day events carry a bare `YYYY-MM-DD` date, which is local
 * midnight (Date would read it as UTC midnight and shift the day for anyone west of Greenwich).
 */
function eventTimeMs(value) {
  if (!value) return NaN;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime();
  return new Date(value).getTime();
}

/** The same meeting has the same iCalendar UID and start in every calendar it appears in. */
function eventKey(event) {
  return `${event.uid || event.id}|${eventTimeMs(event.start)}`;
}

/**
 * One list from every source's events: drops anything already over (meetings in progress stay),
 * keeps one copy of a meeting found in several calendars (the Google API copy has the richer
 * conference data), and sorts by start time.
 */
function mergeEvents(lists, { now = Date.now(), limit = DEFAULT_LIMIT } = {}) {
  const byKey = new Map();
  for (const list of lists) {
    for (const event of list || []) {
      const start = eventTimeMs(event.start);
      const end = eventTimeMs(event.end);
      if (Number.isNaN(start)) continue;
      if ((Number.isNaN(end) ? start : end) <= now) continue;

      const key = eventKey(event);
      const existing = byKey.get(key);
      if (!existing || (existing.sourceType !== 'google' && event.sourceType === 'google')) {
        byKey.set(key, event);
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => eventTimeMs(a.start) - eventTimeMs(b.start) || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit);
}

/**
 * Events whose "meeting starting" prompt is due: timed events starting within a minute either
 * side of `now` that haven't been announced yet. `notified` maps eventKey → end time.
 */
function dueToStart(events, now, notified) {
  const due = [];
  for (const event of events) {
    if (event.isAllDay) continue;
    const key = eventKey(event);
    if (notified.has(key)) continue;
    const start = eventTimeMs(event.start);
    if (Math.abs(start - now) <= REMINDER_WINDOW_MS) due.push(event);
  }
  return due;
}

/** Forget announced events two hours after they end, so the map can't grow without bound. */
function pruneNotified(notified, now) {
  for (const [key, end] of notified) {
    if (now - end > NOTIFIED_MEMORY_MS) notified.delete(key);
  }
}

module.exports = {
  REMINDER_WINDOW_MS,
  isMeetingUrl,
  extractMeetingLink,
  eventTimeMs,
  eventKey,
  mergeEvents,
  dueToStart,
  pruneNotified,
};
