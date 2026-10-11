import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  DEBOUNCE_TICKS,
  TITLE_MEMORY_MS,
  END_GRACE_MS,
  exeFromConsentKey,
  cleanMeetingTitle,
  matchMeetingWindow,
  createDetectorState,
  reduceTick,
  dismissMeeting,
} = require('../electron/detection/meeting-rules.js');

const MEET_WINDOW = { exe: 'chrome.exe', title: 'Meet - abc-defg-hij - Camera or microphone recording - Google Chrome', bounds: { x: 0, y: 0, width: 1200, height: 800 } };
const OTHER_CHROME = { exe: 'chrome.exe', title: 'Inbox - Gmail - Google Chrome' };

// Runs ticks `stepMs` apart, returning the final state and every event emitted.
function run(ticks, { start = 0, stepMs = 1500, state = createDetectorState() } = {}) {
  const events = [];
  let now = start;
  for (const tick of ticks) {
    const result = reduceTick(state, { now, ...tick });
    state = result.state;
    events.push(...result.events);
    now += stepMs;
  }
  return { state, events, now };
}

describe('exeFromConsentKey', () => {
  it('takes the exe name from a NonPackaged key', () => {
    expect(exeFromConsentKey('C:#Program Files#Google#Chrome#Application#chrome.exe')).toBe('chrome.exe');
    expect(exeFromConsentKey('C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe')).toBe('zoom.exe');
  });

  it('lowercases packaged family names as-is', () => {
    expect(exeFromConsentKey('MSTeams_8wekyb3d8bbwe')).toBe('msteams_8wekyb3d8bbwe');
  });
});

describe('cleanMeetingTitle', () => {
  it('strips the Meet prefix and browser suffixes', () => {
    expect(cleanMeetingTitle('Meet - abc-defg-hij - Google Chrome')).toBe('abc-defg-hij');
    expect(cleanMeetingTitle('Meet – Weekly sync - Camera or microphone recording - Google Chrome')).toBe('Weekly sync');
    expect(cleanMeetingTitle('Meet - Standup and 3 more pages - Personal - Microsoft\u200b Edge')).toBe('Standup');
  });

  it('strips the Teams suffix', () => {
    expect(cleanMeetingTitle('Design review | Microsoft Teams')).toBe('Design review');
  });
});

describe('matchMeetingWindow', () => {
  it('matches Google Meet tabs in any supported browser', () => {
    expect(matchMeetingWindow(MEET_WINDOW)).toEqual({ platform: 'meet', title: 'abc-defg-hij' });
    expect(matchMeetingWindow({ exe: 'msedge.exe', title: 'Meet – Weekly sync - Personal - Microsoft\u200b Edge' }))
      .toEqual({ platform: 'meet', title: 'Weekly sync' });
    expect(matchMeetingWindow({ exe: 'firefox.exe', title: 'Meet - abc-defg-hij — Mozilla Firefox' })?.platform).toBe('meet');
  });

  it('matches Zoom and Teams in the browser', () => {
    expect(matchMeetingWindow({ exe: 'chrome.exe', title: 'Zoom Meeting - Google Chrome' })?.platform).toBe('zoom');
    expect(matchMeetingWindow({ exe: 'chrome.exe', title: 'Meeting with Priya | Microsoft Teams - Google Chrome' })?.platform).toBe('teams');
  });

  it('ignores ordinary pages and non-browser apps', () => {
    expect(matchMeetingWindow(OTHER_CHROME)).toBeNull();
    expect(matchMeetingWindow({ exe: 'chrome.exe', title: 'How to run a good meeting - Google Chrome' })).toBeNull();
    expect(matchMeetingWindow({ exe: 'code.exe', title: 'Meet - notes.md - Visual Studio Code' })).toBeNull();
  });

  it('matches the Zoom and Teams desktop meeting windows', () => {
    expect(matchMeetingWindow({ exe: 'Zoom.exe', title: 'Zoom Meeting' })?.platform).toBe('zoom');
    expect(matchMeetingWindow({ exe: 'ms-teams.exe', title: 'Design review | Microsoft Teams' }))
      .toEqual({ platform: 'teams', title: 'Design review' });
  });
});

describe('reduceTick', () => {
  const live = { micExes: ['chrome.exe'], windows: [MEET_WINDOW] };

  it('waits for consecutive positive ticks before detecting', () => {
    const one = run([live]);
    expect(one.events).toEqual([]);
    const two = run(Array(DEBOUNCE_TICKS).fill(live));
    expect(two.events).toHaveLength(1);
    expect(two.events[0]).toMatchObject({
      type: 'meeting-detected',
      meeting: { key: 'meet|chrome.exe', platform: 'meet', platformLabel: 'Google Meet', appLabel: 'Chrome', title: 'abc-defg-hij' },
    });
    expect(two.events[0].meeting.bounds).toEqual(MEET_WINDOW.bounds);
  });

  it('does not prompt when a browser uses the mic without a meeting tab', () => {
    const { events } = run(Array(5).fill({ micExes: ['chrome.exe'], windows: [OTHER_CHROME] }));
    expect(events).toEqual([]);
  });

  it('does not prompt for a meeting tab that is not using the mic', () => {
    const { events } = run(Array(5).fill({ micExes: [], windows: [MEET_WINDOW] }));
    expect(events).toEqual([]);
  });

  it('remembers a meeting tab after the user switches to another tab', () => {
    const switched = { micExes: ['chrome.exe'], windows: [OTHER_CHROME] };
    const { events } = run([{ micExes: [], windows: [MEET_WINDOW] }, switched, switched]);
    expect(events.map((e) => e.type)).toEqual(['meeting-detected']);
  });

  it('forgets a meeting tab after the title memory runs out', () => {
    const seen = run([{ micExes: [], windows: [MEET_WINDOW] }]);
    const later = run(Array(3).fill({ micExes: ['chrome.exe'], windows: [OTHER_CHROME] }), {
      start: TITLE_MEMORY_MS + 5000, state: seen.state,
    });
    expect(later.events).toEqual([]);
  });

  it('treats a desktop meeting app holding the mic as a meeting', () => {
    const { events } = run(Array(2).fill({ micExes: ['zoom.exe'], windows: [] }));
    expect(events[0]).toMatchObject({ type: 'meeting-detected', meeting: { platform: 'zoom', title: 'Zoom' } });
    const teams = run(Array(2).fill({ micExes: ['msteams_8wekyb3d8bbwe'], windows: [{ exe: 'ms-teams.exe', title: 'Sprint planning | Microsoft Teams' }] }));
    expect(teams.events[0].meeting).toMatchObject({ platform: 'teams', title: 'Sprint planning' });
  });

  it('ignores MeetMind itself holding the mic', () => {
    const { events } = run(Array(3).fill({ micExes: ['meetmind.exe'], windows: [], selfExe: 'MeetMind.exe' }));
    expect(events).toEqual([]);
  });

  it('reports the end once the mic has been released for the grace period', () => {
    const detected = run(Array(2).fill(live));
    const gone = { micExes: [], windows: [] };
    const early = run([gone], { start: detected.now, state: detected.state });
    expect(early.events).toEqual([]);
    const ended = run([gone], { start: detected.now + END_GRACE_MS, state: detected.state });
    expect(ended.events).toEqual([expect.objectContaining({ type: 'meeting-ended', meeting: expect.objectContaining({ key: 'meet|chrome.exe' }) })]);
    expect(ended.state.active).toBeNull();
  });

  it('does not re-prompt a dismissed meeting until it ends', () => {
    const detected = run(Array(2).fill(live));
    const dismissed = dismissMeeting(detected.state, 'meet|chrome.exe');
    const still = run(Array(4).fill(live), { start: detected.now, state: dismissed });
    expect(still.events).toEqual([]);

    // After it ends, the same app joining a new call prompts again.
    const ended = run([{ micExes: [], windows: [] }], { start: still.now + END_GRACE_MS, state: still.state });
    expect(ended.events.map((e) => e.type)).toEqual(['meeting-ended']);
    const again = run(Array(2).fill(live), { start: ended.now, state: ended.state });
    expect(again.events.map((e) => e.type)).toEqual(['meeting-detected']);
  });
});
