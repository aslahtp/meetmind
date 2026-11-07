// Which meeting platform a meeting was on: saved by meeting detection (meeting_platform), or read
// from its link (the extension, a calendar event).

const PLATFORMS = {
  meet: { key: 'meet', name: 'Google Meet', icon: 'icons/google-meet.png' },
  zoom: { key: 'zoom', name: 'Zoom' },
  teams: { key: 'teams', name: 'Teams' },
};

export function meetingHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// From a meeting link: { key, name, icon? }, a generic "Video call" for other links, null without one.
export function meetingPlatform(url) {
  if (!url) return null;
  if (url.includes('meet.google.com')) return PLATFORMS.meet;
  if (url.includes('zoom.us') || url.includes('zoom.com')) return PLATFORMS.zoom;
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return PLATFORMS.teams;
  return { key: 'other', name: 'Video call' };
}

// A session's platform: the one meeting detection saw (no link, e.g. the Zoom app), else its link's.
export function sessionPlatform(session) {
  return PLATFORMS[session?.meeting_platform] || meetingPlatform(session?.meeting_url);
}
