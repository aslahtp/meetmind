// Meeting-platform detection from a meeting URL.

export function meetingHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function meetingPlatform(url) {
  if (!url) return null;
  if (url.includes('meet.google.com')) return { name: 'Google Meet', icon: 'icons/google-meet.png' };
  if (url.includes('zoom.us') || url.includes('zoom.com')) return { name: 'Zoom' };
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return { name: 'Teams' };
  return { name: 'Video call' };
}
