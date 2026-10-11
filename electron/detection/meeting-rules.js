// Pure meeting-detection rules: which apps count as meeting apps, how their window titles look,
// and the per-tick state machine that turns "who has the mic + which windows are open" into
// meeting-detected / meeting-ended events. No electron or native imports, so it's unit-testable.

const PLATFORMS = {
  meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
};

const BROWSERS = {
  'chrome.exe': 'Chrome',
  'msedge.exe': 'Edge',
  'brave.exe': 'Brave',
  'firefox.exe': 'Firefox',
  'opera.exe': 'Opera',
  'vivaldi.exe': 'Vivaldi',
  'arc.exe': 'Arc',
};

// Desktop meeting apps: holding the mic is enough to count as a call. Keys are what the mic
// consent registry reports — an exe name for win32 apps, a package family name for packaged ones.
const NATIVE_APPS = {
  'zoom.exe': { platform: 'zoom', label: 'Zoom app' },
  'ms-teams.exe': { platform: 'teams', label: 'Teams app' },
  'teams.exe': { platform: 'teams', label: 'Teams app' },
  'msteams_8wekyb3d8bbwe': { platform: 'teams', label: 'Teams app', windowExe: 'ms-teams.exe' },
};

const DEBOUNCE_TICKS = 2;               // consecutive positive polls before prompting
const TITLE_MEMORY_MS = 2 * 60 * 1000;  // a browser keeps a meeting this long after its tab loses focus
const END_GRACE_MS = 15 * 1000;         // mic released / title gone this long before "ended"

// Browsers append these after the page title, e.g. "Meet - abc-defg-hij - Camera or microphone
// recording - Google Chrome" or "… and 3 more pages - Personal - Microsoft Edge".
const TITLE_SUFFIX = /\s+[-–—]\s+(?:Camera or microphone recording|Camera recording|Microphone recording|Audio playing|Network error|Google Chrome|Microsoft.?Edge|Brave|Mozilla Firefox|Opera|Vivaldi|Arc|Personal|Work)\b.*$/i;
const MORE_PAGES = /\s+and \d+ more pages?$/i;

const MEET_TITLE = /^(?:Google )?Meet\s*[-–—:]\s*|\bmeet\.google\.com\b/i;
const ZOOM_TITLE = /^Zoom (?:Meeting|Webinar|Workplace)\b/i;
const TEAMS_TITLE = /\|\s*Microsoft Teams\b|^Microsoft Teams\b/i;

// "C:#Program Files#Google#Chrome#Application#chrome.exe" -> "chrome.exe";
// packaged keys ("MSTeams_8wekyb3d8bbwe") are returned lowercased as-is.
function exeFromConsentKey(name) {
  const parts = String(name || '').split('#');
  return parts[parts.length - 1].toLowerCase();
}

function cleanMeetingTitle(title) {
  let t = String(title || '').replace(/[\u200b\u200e\u200f]/g, '');
  t = t.replace(TITLE_SUFFIX, '').replace(MORE_PAGES, '');
  t = t.replace(/^(?:Google )?Meet\s*[-–—:]\s*/i, '');
  t = t.replace(/\s*\|\s*Microsoft Teams$/i, '');
  return t.trim();
}

// Returns { platform, title } when a window looks like a meeting, else null.
function matchMeetingWindow({ exe, title }) {
  const app = String(exe || '').toLowerCase();
  const raw = String(title || '');
  if (!raw) return null;

  if (BROWSERS[app]) {
    let platform = null;
    if (MEET_TITLE.test(raw)) platform = 'meet';
    else if (ZOOM_TITLE.test(raw)) platform = 'zoom';
    else if (TEAMS_TITLE.test(raw)) platform = 'teams';
    if (!platform) return null;
    const cleaned = cleanMeetingTitle(raw);
    return { platform, title: cleaned === 'meet.google.com' ? '' : cleaned };
  }

  const native = Object.entries(NATIVE_APPS)
    .find(([id, n]) => id === app || n.windowExe === app)?.[1];
  if (native && (ZOOM_TITLE.test(raw) || TEAMS_TITLE.test(raw))) {
    return { platform: native.platform, title: cleanMeetingTitle(raw) };
  }
  return null;
}

function createDetectorState() {
  return {
    recent: {},        // browser exe -> { platform, title, bounds, seenAt }
    pendingKey: null,
    pendingTicks: 0,
    active: null,      // the meeting currently considered live
    dismissed: [],     // keys the user said "Not now" to; cleared when that meeting ends
  };
}

function toMeeting(key, platform, appLabel, title, bounds) {
  return {
    key,
    platform,
    platformLabel: PLATFORMS[platform],
    appLabel,
    title: title || PLATFORMS[platform],
    bounds: bounds || null,
  };
}

// The meeting the current tick points at, or null.
function findCandidate(state, micExes, windows, now) {
  for (const id of micExes) {
    const native = NATIVE_APPS[id];
    if (native) {
      const windowExe = native.windowExe || id;
      const own = windows.filter((w) => String(w.exe).toLowerCase() === windowExe);
      const match = own.map((w) => ({ w, m: matchMeetingWindow(w) })).find((x) => x.m);
      return toMeeting(`${native.platform}|${id}`, native.platform, native.label,
        match?.m.title, (match?.w || own[0])?.bounds);
    }
    if (BROWSERS[id]) {
      const seen = state.recent[id];
      if (seen && now - seen.seenAt <= TITLE_MEMORY_MS) {
        return toMeeting(`${seen.platform}|${id}`, seen.platform, BROWSERS[id], seen.title, seen.bounds);
      }
    }
  }
  return null;
}

// One poll. `micExes` are consent-registry ids currently holding the mic (see exeFromConsentKey),
// `windows` are visible top-level windows as { exe, title, bounds }. Returns the next state and
// the events to act on: { type: 'meeting-detected' | 'meeting-ended', meeting }.
function reduceTick(prev, { micExes = [], windows = [], now = Date.now(), selfExe = '' }) {
  const state = { ...prev, recent: { ...prev.recent }, dismissed: [...prev.dismissed] };
  const events = [];
  const self = String(selfExe).toLowerCase();
  const mic = micExes.map((e) => String(e).toLowerCase()).filter((e) => e && e !== self);

  for (const w of windows) {
    const exe = String(w.exe || '').toLowerCase();
    if (!BROWSERS[exe]) continue;
    const m = matchMeetingWindow({ exe, title: w.title });
    if (m) state.recent[exe] = { ...m, bounds: w.bounds || null, seenAt: now };
  }
  for (const [exe, seen] of Object.entries(state.recent)) {
    if (now - seen.seenAt > TITLE_MEMORY_MS) delete state.recent[exe];
  }

  const candidate = findCandidate(state, mic, windows, now);

  if (state.active) {
    if (candidate && candidate.key === state.active.key) {
      state.active = { ...state.active, ...candidate, lastSeenAt: now };
    } else if (now - state.active.lastSeenAt >= END_GRACE_MS) {
      const { lastSeenAt: _lastSeenAt, ...meeting } = state.active;
      events.push({ type: 'meeting-ended', meeting });
      state.dismissed = state.dismissed.filter((k) => k !== meeting.key);
      state.active = null;
    }
    state.pendingKey = null;
    state.pendingTicks = 0;
    return { state, events };
  }

  if (!candidate) {
    state.pendingKey = null;
    state.pendingTicks = 0;
    return { state, events };
  }

  state.pendingTicks = candidate.key === state.pendingKey ? state.pendingTicks + 1 : 1;
  state.pendingKey = candidate.key;
  if (state.pendingTicks >= DEBOUNCE_TICKS) {
    state.active = { ...candidate, lastSeenAt: now };
    state.pendingKey = null;
    state.pendingTicks = 0;
    if (!state.dismissed.includes(candidate.key)) {
      events.push({ type: 'meeting-detected', meeting: candidate });
    }
  }
  return { state, events };
}

function dismissMeeting(state, key) {
  if (!key || state.dismissed.includes(key)) return state;
  return { ...state, dismissed: [...state.dismissed, key] };
}

module.exports = {
  PLATFORMS,
  BROWSERS,
  NATIVE_APPS,
  DEBOUNCE_TICKS,
  TITLE_MEMORY_MS,
  END_GRACE_MS,
  exeFromConsentKey,
  cleanMeetingTitle,
  matchMeetingWindow,
  createDetectorState,
  reduceTick,
  dismissMeeting,
};
