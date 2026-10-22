// The title a meeting had where it came from (the detected Meet/Zoom/Teams tab or window, the
// extension, a calendar event, a pasted transcript's title). When it names the meeting, it is
// given to the LLM as a hint and kept as the notes title. Pure, so it's unit-testable.

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

/** The meeting's own title, or '' when it is missing or generic. */
function sourceMeetingTitle(raw) {
  const title = String(raw || '')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    // Raw tab titles from the extension: "Meet - Weekly sync", "Weekly sync | Microsoft Teams".
    .replace(/^(?:Google )?Meet\s+[-–—]\s+/i, '')
    .replace(/\s*\|\s*Microsoft Teams$/i, '')
    .trim()
    .slice(0, MAX_LENGTH)
    .trim();
  if (!title || GENERIC_TITLES.has(title.toLowerCase()) || MEET_CODE.test(title)) return '';
  return title;
}

/** Make `meetingTitle` the notes title, including the Markdown heading in `markdown` mode. */
function applyMeetingTitle(notes, meetingTitle) {
  if (!meetingTitle || !notes || typeof notes !== 'object') return notes;
  notes.title = meetingTitle;
  notes.meeting_title = meetingTitle;
  if (typeof notes._rawMarkdown === 'string') {
    const heading = `# ${meetingTitle}`;
    notes._rawMarkdown = /^#\s+.+$/m.test(notes._rawMarkdown)
      ? notes._rawMarkdown.replace(/^#\s+.+$/m, () => heading)
      : `${heading}\n\n${notes._rawMarkdown}`;
  }
  return notes;
}

module.exports = { sourceMeetingTitle, applyMeetingTitle };
