// Which meeting platform a meeting was on: saved by meeting detection (meeting_platform), or read
// from its link (the extension, a calendar event).

const PLATFORMS = {
  meet: { key: 'meet', name: 'Google Meet', icon: 'icons/google-meet.png' },
  zoom: { key: 'zoom', name: 'Zoom' },
  teams: { key: 'teams', name: 'Teams' },
};

export function meetingHostname(url: any) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Each platform's domains. A link belongs to one when its host is the domain or a subdomain of it
// (us02web.zoom.us), never because the domain appears elsewhere in the URL.
const PLATFORM_DOMAINS: Array<[string, string[]]> = [
  ['meet', ['meet.google.com']],
  ['zoom', ['zoom.us', 'zoom.com']],
  ['teams', ['teams.microsoft.com', 'teams.live.com']],
];

function urlHost(url: any) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// From a meeting link: { key, name, icon? }, a generic "Video call" for other links, null without one.
export function meetingPlatform(url: any) {
  if (!url) return null;
  const host = urlHost(url);
  const match = PLATFORM_DOMAINS.find(([, domains]) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`)));
  return match ? (PLATFORMS as any)[match[0]] : { key: 'other', name: 'Video call' };
}

// A session's platform: the one meeting detection saw (no link, e.g. the Zoom app), else its link's.
export function sessionPlatform(session: any) {
  return (PLATFORMS as any)[session?.meeting_platform] || meetingPlatform(session?.meeting_url);
}
