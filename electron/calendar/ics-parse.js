// Parse an ICS (iCalendar) feed into MeetMind's calendar events for a time window. Recurring
// events are expanded with their exceptions (moved or cancelled occurrences) and time zones
// come from the feed's own VTIMEZONEs. Pure (ical.js only), so it's unit-testable.

const ICAL = require('ical.js');
const { extractMeetingLink } = require('./calendar-events');

// Safety valves for hostile or enormous feeds: occurrences emitted per series, and recurrence
// steps walked per series (a daily meeting since 2010 is ~6,000 steps).
const MAX_OCCURRENCES_PER_SERIES = 200;
const MAX_ITERATIONS_PER_SERIES = 20_000;
// Moved occurrences are found through their original slot, so walk a little past the window.
const RECURRENCE_SLACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMED_DURATION_MS = 30 * 60 * 1000;

// Properties some servers put the join link in.
const CONFERENCE_PROPS = [
  'x-google-conference',
  'x-microsoft-skypeteamsmeetingurl',
  'x-microsoft-onlinemeetingconflink',
  'x-microsoft-onlinemeetingexternallink',
  'conference',
];

const NOT_A_CALENDAR = 'That link didn’t return a calendar. Copy the ICS (iCal) address, not the calendar’s web page.';

function isValidIanaZone(tzid) {
  if (!tzid) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

// Offset of an IANA zone from UTC at a given instant, in ms.
function zoneOffsetMs(tzid, utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

// Wall-clock time in an IANA zone → UTC ms (two passes settle DST boundaries).
function wallClockInZoneMs(t, tzid) {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  let utc = wall - zoneOffsetMs(tzid, wall);
  utc = wall - zoneOffsetMs(tzid, utc);
  return utc;
}

/**
 * ms since epoch for an ICAL.Time. UTC and feed-defined zones convert exactly; ical.js treats
 * anything else as "local" with a zero offset, so those are resolved here: a TZID the feed
 * didn't define but that is a real IANA zone (Cal.com, some CalDAV servers) goes through Intl,
 * and floating times are the user's own wall clock.
 */
function timeToMs(time, tzid) {
  const zone = time.zone;
  if (zone && zone !== ICAL.Timezone.localTimezone) return time.toUnixTime() * 1000;
  if (isValidIanaZone(tzid)) return wallClockInZoneMs(time, tzid);
  return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second).getTime();
}

function dateOnly(time) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

function dateOnlyMs(time) {
  return new Date(time.year, time.month - 1, time.day).getTime();
}

function propTzid(component, name) {
  return component.getFirstProperty(name)?.getParameter('tzid') || '';
}

function textValue(component, name) {
  const value = component.getFirstPropertyValue(name);
  return value == null ? '' : String(value).trim();
}

function conferenceUrls(component) {
  const urls = [];
  for (const name of CONFERENCE_PROPS) {
    for (const prop of component.getAllProperties(name)) {
      const value = prop.getFirstValue();
      if (value) urls.push(String(value).trim());
    }
  }
  return urls;
}

function stripMailto(value) {
  return String(value || '').replace(/^mailto:/i, '');
}

/** Turn one occurrence (start/end Times from the series or its exception) into an event. */
function buildEvent(component, startTime, endTime, recurrenceKey) {
  const uid = textValue(component, 'uid');
  const isAllDay = !!startTime.isDate;

  let start;
  let end;
  let startMs;
  let endMs;
  if (isAllDay) {
    start = dateOnly(startTime);
    end = dateOnly(endTime);
    startMs = dateOnlyMs(startTime);
    endMs = dateOnlyMs(endTime);
    if (endMs <= startMs) {
      const next = new Date(startMs + 24 * 60 * 60 * 1000);
      end = dateOnly({ year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() });
      endMs = next.getTime();
    }
  } else {
    startMs = timeToMs(startTime, propTzid(component, 'dtstart'));
    endMs = timeToMs(endTime, propTzid(component, 'dtend') || propTzid(component, 'dtstart'));
    // No DTEND/DURATION (or a zero-length one): give it a nominal half hour, so a meeting that
    // has just started still counts as in progress.
    if (!(endMs > startMs)) endMs = startMs + DEFAULT_TIMED_DURATION_MS;
    start = new Date(startMs).toISOString();
    end = new Date(endMs).toISOString();
  }

  const description = textValue(component, 'description');
  const location = textValue(component, 'location');
  return {
    event: {
      id: recurrenceKey ? `${uid}_${recurrenceKey}` : uid,
      uid,
      title: textValue(component, 'summary') || 'Untitled Event',
      start,
      end,
      isAllDay,
      meetingLink: extractMeetingLink({
        conferenceUrls: conferenceUrls(component),
        url: textValue(component, 'url'),
        description,
        location,
      }),
      location,
      attendeeCount: component.getAllProperties('attendee').length,
      organizer: stripMailto(component.getFirstPropertyValue('organizer')),
      status: (textValue(component, 'status') || 'confirmed').toLowerCase(),
      description,
    },
    startMs,
    endMs,
  };
}

function isCancelled(component) {
  return textValue(component, 'status').toUpperCase() === 'CANCELLED';
}

function overlaps(startMs, endMs, from, to) {
  return endMs > from && startMs < to;
}

function expandSeries(master, exceptions, from, to, out) {
  const event = new ICAL.Event(master, { strictExceptions: true, exceptions });
  const tzid = propTzid(master, 'dtstart');

  if (!event.isRecurring()) {
    if (isCancelled(master)) return;
    const built = buildEvent(master, event.startDate, event.endDate, '');
    if (overlaps(built.startMs, built.endMs, from, to)) out.push(built.event);
    return;
  }

  const iterator = event.iterator();
  let emitted = 0;
  for (let steps = 0; steps < MAX_ITERATIONS_PER_SERIES; steps++) {
    const next = iterator.next();
    if (!next) break;
    const slotMs = next.isDate ? dateOnlyMs(next) : timeToMs(next, tzid);
    if (slotMs > to + RECURRENCE_SLACK_MS) break;

    const details = event.getOccurrenceDetails(next);
    const component = details.item.component;
    if (isCancelled(component)) continue;
    const recurrenceKey = next.convertToZone(ICAL.Timezone.utcTimezone).toString().replace(/[-:]/g, '');
    const built = buildEvent(component, details.startDate, details.endDate, recurrenceKey);
    if (!overlaps(built.startMs, built.endMs, from, to)) continue;
    out.push(built.event);
    if (++emitted >= MAX_OCCURRENCES_PER_SERIES) break;
  }
}

function calendarsIn(text) {
  let jcal;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new Error(NOT_A_CALENDAR);
  }
  // One VCALENDAR parses to a single jCal array; several to an array of them.
  const list = Array.isArray(jcal[0]) ? jcal : [jcal];
  return list.map((data) => new ICAL.Component(data)).filter((c) => c.name === 'vcalendar');
}

/**
 * Events from an ICS feed that overlap [from, to) (ms), unsorted. Returns
 * { calendarName, events } where calendarName is the feed's X-WR-CALNAME, if any.
 */
function parseIcs(text, { from, to }) {
  if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text)) throw new Error(NOT_A_CALENDAR);
  const calendars = calendarsIn(text);
  if (!calendars.length) throw new Error(NOT_A_CALENDAR);

  let calendarName = '';
  const events = [];
  for (const calendar of calendars) {
    calendarName ||= textValue(calendar, 'x-wr-calname');

    // Group by UID: a series plus its moved/cancelled occurrences (RECURRENCE-ID). Google's
    // secret ICS address lists only the occurrence you were invited to, with no master, so
    // an exception without one stands on its own.
    const groups = new Map();
    const standalone = [];
    for (const vevent of calendar.getAllSubcomponents('vevent')) {
      const uid = textValue(vevent, 'uid');
      if (!uid) {
        standalone.push(vevent);
        continue;
      }
      if (!groups.has(uid)) groups.set(uid, { master: null, exceptions: [] });
      const group = groups.get(uid);
      if (vevent.hasProperty('recurrence-id')) group.exceptions.push(vevent);
      else if (!group.master) group.master = vevent;
      else standalone.push(vevent);
    }

    for (const { master, exceptions } of groups.values()) {
      try {
        if (master) expandSeries(master, exceptions, from, to, events);
        else standalone.push(...exceptions);
      } catch {
        // One malformed series (a bad RRULE, an unreadable date) mustn't hide the rest.
      }
    }
    for (const vevent of standalone) {
      try {
        expandSeries(vevent, [], from, to, events);
      } catch {
        // Same as above.
      }
    }
  }
  return { calendarName, events };
}

module.exports = { parseIcs, NOT_A_CALENDAR };
