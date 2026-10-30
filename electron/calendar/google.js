// Google Calendar over OAuth, one or more accounts. Each account (a calendar source of type
// 'google') brings its own OAuth client from the user's Google Cloud project; sign-in runs a
// loopback redirect server, one at a time.

const { google } = require('googleapis');
const http = require('http');
const logger = require('../utils/logger');
const { extractMeetingLink } = require('./calendar-events');

// Scopes for read-only calendar access + user profile email
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

// Loopback port range for OAuth redirect
const LOOPBACK_PORT_START = 39880;
const LOOPBACK_PORT_END = 39890;
const AUTH_TIMEOUT_MS = 120_000;

// sourceId → { client, key }: one OAuth2 client per account, rebuilt when its credentials change.
const clients = new Map();
// sourceId → { token, at }: refresh token Google rejected (revoked/expired) and when. Calls with
// that token fail fast without contacting Google, and are retried for real once a day, so sync
// resumes by itself if the token recovers; signing in again (new token) clears it.
const rejected = new Map();
const AUTH_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The sign-in in progress: { cancel }.
let activeAuth = null;

const AUTH_EXPIRED_MESSAGE = 'Google sign-in expired or was revoked. Sign in again.';
const API_DISABLED_URL = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';

function getClient(source) {
  const key = `${source.clientId}\n${source.clientSecret}\n${source.refreshToken}`;
  const cached = clients.get(source.id);
  if (cached && cached.key === key) return cached.client;

  const client = new google.auth.OAuth2(source.clientId, source.clientSecret, `http://localhost:${LOOPBACK_PORT_START}`);
  client.setCredentials({ refresh_token: source.refreshToken });
  clients.set(source.id, { client, key });
  return client;
}

function authError(message) {
  const err = new Error(message);
  err.needsSignIn = true;
  return err;
}

// ── Auth Flow ─────────────────────────────────────────────────────────────────

/**
 * Start the OAuth 2.0 flow: opens the user's browser for Google sign-in, captures the redirect
 * on a temporary loopback server, and exchanges the code for tokens. A new sign-in cancels one
 * still waiting. Resolves { refreshToken, email }.
 */
async function startAuthFlow({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error('Enter your OAuth Client ID and Client Secret.');
  }
  cancelAuthFlow();

  const { shell } = require('electron');
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
    let server = null;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { server?.close(); } catch {}
      if (activeAuth?.server === server) activeAuth = null;
      if (err) reject(err);
      else resolve(value);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Google sign-in timed out after 2 minutes. Try again.'));
    }, AUTH_TIMEOUT_MS);

    server = http.createServer(async (req, res) => {
      try {
        const queryParams = new URL(req.url, `http://localhost:${port}`).searchParams;
        const code = queryParams.get('code');
        const error = queryParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(makeCallbackPage(false, `Authorization denied: ${error}`));
          finish(new Error(`Google sign-in was denied (${error}).`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(makeCallbackPage(false, 'No authorization code received.'));
          return;
        }

        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        let email = '';
        try {
          const oauth2 = google.oauth2({ version: 'v2', auth: client });
          const userInfo = await oauth2.userinfo.get();
          email = userInfo.data.email || '';
        } catch (e) {
          logger.warn('Could not fetch Google user email', { error: e.message });
        }

        if (!tokens.refresh_token) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(makeCallbackPage(false, 'Google did not return a refresh token. Remove MeetMind from your Google account’s third-party access and try again.'));
          finish(new Error('Google did not return a refresh token. Remove MeetMind from your Google account’s third-party access, then sign in again.'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(makeCallbackPage(true, `Connected as ${escapeHtml(email) || 'your Google account'}. You can close this tab.`));
        finish(null, { refreshToken: tokens.refresh_token, email });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(makeCallbackPage(false, `Error: ${escapeHtml(err.message)}`));
        finish(err);
      }
    });

    activeAuth = { server, cancel: () => finish(Object.assign(new Error('Sign-in cancelled.'), { cancelled: true })) };

    server.listen(port, () => {
      logger.info('OAuth loopback server started', { port });
      shell.openExternal(authUrl).catch((err) => finish(new Error(`Failed to open browser: ${err.message}`)));
    });

    server.on('error', (err) => finish(new Error(`Failed to start OAuth server: ${err.message}`)));
  });
}

/** Abort a sign-in that is still waiting for the browser. */
function cancelAuthFlow() {
  activeAuth?.cancel();
  activeAuth = null;
}

/** Drop everything held for a source (removed, or its credentials replaced). */
function forgetSource(id) {
  clients.delete(id);
  rejected.delete(id);
}

// ── Fetch Events ──────────────────────────────────────────────────────────────

// True while this token is inside its once-a-day retry window after Google rejected it.
function isTokenRejected(source) {
  const entry = rejected.get(source.id);
  return !!entry && entry.token === source.refreshToken && Date.now() - entry.at < AUTH_RETRY_INTERVAL_MS;
}

/**
 * Events on the account's primary calendar that overlap [from, to) (ms). `timeMin` filters on
 * an event's end, so meetings already in progress come back too.
 */
async function fetchEvents(source, { from, to }) {
  if (isTokenRejected(source)) throw authError(AUTH_EXPIRED_MESSAGE);
  const client = getClient(source);

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    if (rejected.delete(source.id)) {
      logger.info('Google Calendar authorization works again; sync resumed', { calendar: source.name });
    }
    return (res.data.items || []).filter((e) => e && e.status !== 'cancelled').map(normalizeEvent);
  } catch (err) {
    const msg = err.message || String(err);

    // Revoked/expired refresh token: warn once, then back off to one real attempt a day with
    // this token (the poller keeps running) instead of failing every minute.
    if (msg.includes('invalid_grant') || err.response?.data?.error === 'invalid_grant' || err.code === 401) {
      if (!isTokenRejected(source)) {
        rejected.set(source.id, { token: source.refreshToken, at: Date.now() });
        logger.warn('Google Calendar authorization was revoked or has expired; retrying once a day until you sign in again', { calendar: source.name, error: msg });
      }
      throw authError(AUTH_EXPIRED_MESSAGE);
    }

    if (msg.includes('Google Calendar API has not been used') || msg.includes('it is disabled') || msg.includes('accessNotConfigured')) {
      const error = new Error('The Google Calendar API is not enabled in your Google Cloud project.');
      error.actionUrl = msg.match(/https?:\/\/[^\s]+/)?.[0] || API_DISABLED_URL;
      error.actionLabel = 'Enable Google Calendar API';
      throw error;
    }

    if (err.code === 403) throw authError(AUTH_EXPIRED_MESSAGE);
    throw new Error(`Couldn’t load Google Calendar: ${msg}`);
  }
}

function normalizeEvent(event) {
  const videoEntry = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return {
    id: event.id,
    uid: event.iCalUID || event.id,
    title: event.summary || 'Untitled Event',
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    isAllDay: !event.start?.dateTime,
    meetingLink: extractMeetingLink({
      conferenceUrls: [event.hangoutLink, videoEntry?.uri],
      description: event.description,
      location: event.location,
    }),
    location: event.location || '',
    attendeeCount: event.attendees?.length || 0,
    organizer: event.organizer?.email || '',
    status: event.status,
    description: event.description || '',
  };
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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
  cancelAuthFlow,
  forgetSource,
  fetchEvents,
};
