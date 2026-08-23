const { google } = require('googleapis');
const { shell } = require('electron');
const http = require('http');
const url = require('url');
const logger = require('../utils/logger');

// Scopes for read-only calendar access + user profile email
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Loopback port range for OAuth redirect
const LOOPBACK_PORT_START = 39880;
const LOOPBACK_PORT_END = 39890;

let oAuth2Client = null;
let eventPollTimer = null;
let cachedEvents = [];
let lastFetchTime = 0;
let activeAuthServer = null;
let lastPollerError = null;

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ── OAuth2 Client ─────────────────────────────────────────────────────────────

function getOAuth2Client(config) {
  const clientId = config.googleCalendarClientId;
  const clientSecret = config.googleCalendarClientSecret;
  if (!clientId || !clientSecret) return null;

  if (!oAuth2Client || oAuth2Client._clientId !== clientId) {
    oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${LOOPBACK_PORT_START}`);
    oAuth2Client._clientId = clientId;
  }

  const refreshToken = config.googleCalendarRefreshToken;
  if (refreshToken) {
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
  }

  return oAuth2Client;
}

// ── Auth Flow ─────────────────────────────────────────────────────────────────

/**
 * Start the OAuth 2.0 flow: opens the user's browser for Google sign-in,
 * captures the redirect on a temporary loopback server, and exchanges the
 * code for tokens. Returns { refreshToken, email }.
 */
async function startAuthFlow(config) {
  const clientId = config.googleCalendarClientId;
  const clientSecret = config.googleCalendarClientSecret;

  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar Client ID and Client Secret are required. Configure them in Settings.');
  }

  // Close any previously running auth server to prevent duplicate listeners
  if (activeAuthServer) {
    try {
      activeAuthServer.close();
    } catch {}
    activeAuthServer = null;
  }

  // Find a free loopback port
  const port = await findFreePort(LOOPBACK_PORT_START, LOOPBACK_PORT_END);
  const redirectUri = `http://localhost:${port}`;

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Always prompt to ensure we get a refresh token
  });

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (server) {
        try { server.close(); } catch {}
      }
      if (activeAuthServer === server) {
        activeAuthServer = null;
      }
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('OAuth flow timed out after 2 minutes. Please try again.'));
    }, 120_000);

    const server = http.createServer(async (req, res) => {
      try {
        const queryParams = new URL(req.url, `http://localhost:${port}`).searchParams;
        const code = queryParams.get('code');
        const error = queryParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(makeCallbackPage(false, `Authorization denied: ${error}`));
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Google authorization denied: ${error}`));
          }
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(makeCallbackPage(false, 'No authorization code received.'));
          return;
        }

        // Exchange code for tokens
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Fetch the user's email for display
        let email = '';
        try {
          const oauth2 = google.oauth2({ version: 'v2', auth: client });
          const userInfo = await oauth2.userinfo.get();
          email = userInfo.data.email || '';
        } catch (e) {
          logger.warn('Could not fetch Google user email', { error: e.message });
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(makeCallbackPage(true, `Connected as ${email || 'your Google account'}. You can close this tab.`));

        if (!settled) {
          settled = true;
          cleanup();

          // Update the module-level client
          oAuth2Client = client;
          oAuth2Client._clientId = clientId;

          resolve({
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            email,
          });
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(makeCallbackPage(false, `Error: ${err.message}`));
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    });

    activeAuthServer = server;

    server.listen(port, () => {
      logger.info('OAuth loopback server started', { port });
      shell.openExternal(authUrl).catch((err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`Failed to open browser: ${err.message}`));
        }
      });
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Failed to start OAuth server: ${err.message}`));
      }
    });
  });
}

/**
 * Disconnect: clear the cached client and tokens.
 */
function disconnectCalendar() {
  if (activeAuthServer) {
    try { activeAuthServer.close(); } catch {}
    activeAuthServer = null;
  }
  oAuth2Client = null;
  cachedEvents = [];
  lastFetchTime = 0;
  lastPollerError = null;
  stopEventPoller();
  logger.info('Google Calendar disconnected');
}

/**
 * Check whether a valid refresh token is stored.
 */
function isCalendarConnected(config) {
  return !!(config.googleCalendarRefreshToken && config.googleCalendarClientId && config.googleCalendarClientSecret);
}

// ── Fetch Events ──────────────────────────────────────────────────────────────

/**
 * Fetch upcoming events from the primary calendar.
 * Returns an array of clean event objects.
 * @param {object} config - The app config
 * @param {number} hoursAhead - How many hours ahead to look (default 36 — covers today + tomorrow)
 */
async function fetchUpcomingEvents(config, hoursAhead = 36) {
  if (!isCalendarConnected(config)) return [];

  // Return cache if fresh enough
  const now = Date.now();
  if (cachedEvents.length > 0 && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedEvents;
  }

  const client = getOAuth2Client(config);
  if (!client) return [];

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 25,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (res.data.items || []).map(normalizeEvent).filter(Boolean);
    cachedEvents = events;
    lastFetchTime = Date.now();

    logger.info('Fetched Google Calendar events', { count: events.length });
    return events;
  } catch (err) {
    const msg = err.message || String(err);
    logger.error('Failed to fetch Google Calendar events', { error: msg });

    if (msg.includes('Google Calendar API has not been used') || msg.includes('it is disabled') || msg.includes('accessNotConfigured')) {
      const matchUrl = msg.match(/https?:\/\/[^\s]+/);
      const url = matchUrl ? matchUrl[0] : 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';
      throw new Error(`Google Calendar API is not enabled in your Google Cloud project. Please enable it in Google Cloud Console: ${url}`);
    }

    // If token is expired/revoked, surface it clearly
    if (err.code === 401 || err.code === 403 || msg.includes('invalid_grant')) {
      throw new Error('Google Calendar authorization expired or invalid. Please reconnect in Settings.');
    }
    throw err;
  }
}

function normalizeEvent(event) {
  if (!event) return null;

  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const isAllDay = !event.start?.dateTime;

  // Extract meeting link (Google Meet, Zoom, Teams, etc.)
  let meetingLink = '';
  if (event.hangoutLink) {
    meetingLink = event.hangoutLink;
  } else if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find((e) => e.entryPointType === 'video');
    if (videoEntry) meetingLink = videoEntry.uri;
  }

  // Fallback: try to find a URL in the description or location
  if (!meetingLink) {
    const urlRegex = /https?:\/\/[^\s<>"]+(?:meet|zoom|teams)[^\s<>"]+/i;
    const descMatch = event.description?.match(urlRegex);
    const locMatch = event.location?.match(urlRegex);
    meetingLink = descMatch?.[0] || locMatch?.[0] || '';
  }

  return {
    id: event.id,
    title: event.summary || 'Untitled Event',
    start,
    end,
    isAllDay,
    meetingLink,
    location: event.location || '',
    attendeeCount: event.attendees?.length || 0,
    organizer: event.organizer?.email || '',
    status: event.status,
    description: event.description || '',
  };
}

// ── Event Poller (for meeting-start notifications) ────────────────────────────

/**
 * Start a 60-second polling interval that checks if any upcoming meeting is
 * starting now (within a 1-minute window). Calls `onMeetingStart(event)` for
 * each matching event, but only once per event.
 */
function startEventPoller(config, onMeetingStart) {
  stopEventPoller();

  if (!isCalendarConnected(config)) return;

  const notifiedEventIds = new Set();

  eventPollTimer = setInterval(async () => {
    try {
      const events = await fetchUpcomingEvents(config, 1); // Next hour only
      lastPollerError = null;
      const now = Date.now();

      for (const event of events) {
        if (event.isAllDay) continue;
        if (notifiedEventIds.has(event.id)) continue;

        const eventStart = new Date(event.start).getTime();
        const diffMs = eventStart - now;

        // Notify if the event starts within the next 60 seconds or started within the last 60 seconds
        if (diffMs >= -60_000 && diffMs <= 60_000) {
          notifiedEventIds.add(event.id);
          onMeetingStart(event);
        }
      }

      // Clean up old IDs (events that are more than 2 hours old)
      for (const id of notifiedEventIds) {
        const event = events.find((e) => e.id === id);
        if (event) {
          const eventEnd = new Date(event.end).getTime();
          if (now - eventEnd > 2 * 60 * 60 * 1000) {
            notifiedEventIds.delete(id);
          }
        }
      }
    } catch (err) {
      // Only log once if it's the same error to avoid spamming the logs
      if (err.message !== lastPollerError) {
        lastPollerError = err.message;
        logger.warn('Calendar event poll paused/failed', { error: err.message });
      }
    }
  }, 60_000);

  // Run once immediately
  eventPollTimer.unref?.();
  logger.info('Calendar event poller started');
}

function stopEventPoller() {
  if (eventPollTimer) {
    clearInterval(eventPollTimer);
    eventPollTimer = null;
    logger.info('Calendar event poller stopped');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findFreePort(start, end) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      if (port > end) {
        reject(new Error(`No free port found in range ${start}-${end}`));
        return;
      }
      const server = http.createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    }
    tryPort(start);
  });
}

function makeCallbackPage(success, message) {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '✓' : '✗';
  return `<!DOCTYPE html>
<html>
<head><title>MeetMind — Google Calendar</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
  .card { text-align: center; padding: 3rem; border-radius: 1rem;
          background: #18181b; border: 1px solid #27272a; max-width: 400px; }
  .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
  h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0; color: #a1a1aa; font-size: 0.875rem; line-height: 1.5; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h2>${success ? 'Connected!' : 'Connection Failed'}</h2>
  <p>${message}</p>
</div></body></html>`;
}

module.exports = {
  startAuthFlow,
  disconnectCalendar,
  isCalendarConnected,
  fetchUpcomingEvents,
  startEventPoller,
  stopEventPoller,
};
