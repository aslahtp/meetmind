import { describe, it, expect } from 'vitest';
import { meetingHostname, meetingPlatform, sessionPlatform } from '../renderer/lib/platform.js';
import { searchSessions } from '../renderer/lib/meetingSearch.js';

describe('meeting platform', () => {
  it('reads the platform from a meeting link', () => {
    expect(meetingPlatform('https://meet.google.com/abc-defg-hij')).toMatchObject({ key: 'meet', name: 'Google Meet' });
    expect(meetingPlatform('https://us02web.zoom.us/j/123')).toMatchObject({ key: 'zoom', name: 'Zoom' });
    expect(meetingPlatform('https://teams.microsoft.com/l/meetup-join/x')).toMatchObject({ key: 'teams' });
    expect(meetingPlatform('https://example.com/call')).toEqual({ key: 'other', name: 'Video call' });
    expect(meetingPlatform('')).toBeNull();
    expect(meetingHostname('https://www.zoom.us/j/1')).toBe('zoom.us');
  });

  it('prefers the platform meeting detection saved, then the link', () => {
    expect(sessionPlatform({ meeting_platform: 'zoom', meeting_url: '' })).toMatchObject({ key: 'zoom', name: 'Zoom' });
    expect(sessionPlatform({ meeting_platform: 'meet', meeting_url: 'https://meet.google.com/abc-defg-hij' }))
      .toMatchObject({ key: 'meet' });
    expect(sessionPlatform({ meeting_platform: null, meeting_url: 'https://zoom.us/j/1' })).toMatchObject({ key: 'zoom' });
    expect(sessionPlatform({ meeting_platform: 'skype', meeting_url: null })).toBeNull();
    expect(sessionPlatform({})).toBeNull();
    expect(sessionPlatform(null)).toBeNull();
  });

  it('lets search find a detected meeting by its platform', () => {
    const sessions = [
      { id: 'zoom-app', title: 'Untitled', status: 'complete', meeting_platform: 'zoom', transcript: [] },
      { id: 'plain', title: 'Untitled', status: 'complete', transcript: [] },
    ];
    const matches = searchSessions(sessions, 'zoom');
    expect([...matches.keys()]).toEqual(['zoom-app']);
  });
});
