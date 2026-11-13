// The title a meeting had where it came from (the detected Meet/Zoom/Teams tab or window, the
// extension, a calendar event, a pasted transcript's title). When it names the meeting, it is
// given to the LLM as a hint and kept as the notes title. Pure, so it's unit-testable.

import type { MeetingPlatform, Notes } from '../shared';

// Placeholders and app/page names that say nothing about the meeting.
const GENERIC_TITLES = new Set([
  'untitled meeting', 'meeting', 'meeting notes', 'pasted transcript',
  'meet', 'google meet', 'meet.google.com',
  'zoom', 'zoom meeting', 'zoom webinar', 'zoom workplace',
  'teams', 'microsoft teams', 'chat', 'calendar', 'activity', 'calls',
]);

// An ad-hoc Google Meet shows only its code, e.g. "abc-defg-hij".
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;
const MAX_LENGTH = 200;

/** One line, no invisible marks, at most MAX_LENGTH characters (code points, so emoji aren't split). */
function cleanTitle(raw: unknown) {
  const oneLine = String(raw || '')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(oneLine).slice(0, MAX_LENGTH).join('').trim();
}

/** The meeting's own title, or '' when it is missing or generic. */
function sourceMeetingTitle(raw: unknown) {
  const title = cleanTitle(String(raw || '')
    // Raw tab titles from the extension: "Meet - Weekly sync", "Weekly sync | Microsoft Teams".
    .replace(/^\s*(?:Google )?Meet\s+[-–—]\s+/i, '')
    .replace(/\s*\|\s*Microsoft Teams\s*$/i, ''));
  if (!title || GENERIC_TITLES.has(title.toLowerCase()) || MEET_CODE.test(title)) return '';
  return title;
}

/** Make `meetingTitle` the notes title, including the Markdown heading in `markdown` mode. */
function applyMeetingTitle<T>(input: T, meetingTitle: string | null | undefined): T {
  if (!meetingTitle || !input || typeof input !== 'object') return input;
  const notes = input as Notes;
  notes.title = meetingTitle;
  notes.meeting_title = meetingTitle;
  if (typeof notes._rawMarkdown === 'string') {
    const heading = `# ${meetingTitle}`;
    notes._rawMarkdown = /^#\s+.+$/m.test(notes._rawMarkdown)
      ? notes._rawMarkdown.replace(/^#\s+.+$/m, () => heading)
      : `${heading}\n\n${notes._rawMarkdown}`;
  }
  return input;
}

// Platforms meeting detection can name (see PLATFORMS in detection/meeting-rules.ts).
const MEETING_PLATFORMS: MeetingPlatform[] = ['meet', 'zoom', 'teams'];

function isMeetingPlatform(value: unknown): value is MeetingPlatform {
  return MEETING_PLATFORMS.includes(value as MeetingPlatform);
}

/**
 * Where a new recording's meeting is: what the caller passed (the extension's tab, a calendar
 * event, the detection prompt), filled in from the meeting detection sees right now when the
 * caller had no link and no platform (the app's Record button, the tray). A calendar event's
 * title still wins over the detected one.
 */
function resolveMeetingSource(
  {
    meetingUrl,
    meetingTitle,
    meetingPlatform,
  }: { meetingUrl?: string | null; meetingTitle?: string | null; meetingPlatform?: string | null } = {},
  detected: { url?: string; title?: string; platform?: string } | null = null
): { url: string; title: string; platform: MeetingPlatform | null } {
  const source = {
    url: meetingUrl || '',
    title: meetingTitle || '',
    platform: isMeetingPlatform(meetingPlatform) ? meetingPlatform : null,
  };
  if (source.url || source.platform || !detected) return source;
  return {
    url: detected.url || '',
    title: source.title || detected.title || '',
    platform: isMeetingPlatform(detected.platform) ? detected.platform : null,
  };
}

export { cleanTitle, sourceMeetingTitle, applyMeetingTitle, resolveMeetingSource };
