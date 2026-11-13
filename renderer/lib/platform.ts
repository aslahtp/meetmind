// Which meeting platform a meeting was on: saved by meeting detection (meeting_platform), or read
// from its link (the extension, a calendar event).

export interface MeetingPlatformInfo {
  key: string;
  name: string;
  icon?: string;
}

const PLATFORMS: Record<string, MeetingPlatformInfo> = {
  meet: { key: 'meet', name: 'Google Meet', icon: 'icons/google-meet.png' },
  zoom: { key: 'zoom', name: 'Zoom' },
  teams: { key: 'teams', name: 'Teams' },
};

export function meetingHostname(url: string | null | undefined): string {
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

function urlHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// From a meeting link: { key, name, icon? }, a generic "Video call" for other links, null without one.
export function meetingPlatform(url: string | null | undefined): MeetingPlatformInfo | null {
  if (!url) return null;
  const host = urlHost(url);
  const match = PLATFORM_DOMAINS.find(([, domains]) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`)));
  return match ? PLATFORMS[match[0]] : { key: 'other', name: 'Video call' };
}

// A session's platform: the one meeting detection saw (no link, e.g. the Zoom app), else its link's.
/** The session fields a platform is read from (`meeting_platform` may be a value this build doesn't know). */
export interface PlatformFields {
  meeting_platform?: string | null;
  meeting_url?: string | null;
}

export function sessionPlatform(session: PlatformFields | null | undefined): MeetingPlatformInfo | null {
  const saved = session?.meeting_platform;
  return (saved ? PLATFORMS[saved] : undefined) || meetingPlatform(session?.meeting_url);
}
