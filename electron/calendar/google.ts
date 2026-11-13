// Google Calendar over OAuth, one or more accounts. Each account (a calendar source of type
// 'google') brings its own OAuth client from the user's Google Cloud project; sign-in runs a
// loopback redirect server, one at a time.

import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { calendar as calendarApi, type calendar_v3 } from '@googleapis/calendar';
import crypto from 'crypto';
import http from 'http';
import type { StoredCalendarSource } from '../shared';
import logger from '../utils/logger';
import { errorMessage } from '../utils/errors';
import { extractMeetingLink, type SourceEvent } from './calendar-events';

/** What the manager reads off a failed fetch or sign-in to word the error for the UI. */
export type CalendarFetchError = Error & {
  needsSignIn?: boolean;
  actionUrl?: string;
  actionLabel?: string;
  cancelled?: boolean;
};

/** The parts of a Google API error that are read here (`code` or `status` carries the HTTP status). */
type GoogleApiError = Error & { code?: number | string; status?: number; response?: { data?: { error?: string } } };

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

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
const clients = new Map<string, { client: OAuth2Client; key: string }>();
// sourceId → { token, at }: refresh token Google rejected (revoked/expired) and when. Calls with
// that token fail fast without contacting Google, and are retried for real once a day, so sync
// resumes by itself if the token recovers; signing in again (new token) clears it.
const rejected = new Map<string, { token: string | undefined; at: number }>();
const AUTH_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The sign-in in progress: { cancel }.
let activeAuth: { server: http.Server | null; cancel: () => void } | null = null;

const AUTH_EXPIRED_MESSAGE = 'Google sign-in expired or was revoked. Sign in again.';
const API_DISABLED_URL = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com';

function getClient(source: StoredCalendarSource) {
  const key = `${source.clientId}\n${source.clientSecret}\n${source.refreshToken}`;
  const cached = clients.get(source.id);
  if (cached && cached.key === key) return cached.client;

  const client = new OAuth2Client({ clientId: source.clientId, clientSecret: source.clientSecret, redirectUri: `http://localhost:${LOOPBACK_PORT_START}` });
  client.setCredentials({ refresh_token: source.refreshToken });
  clients.set(source.id, { client, key });
  return client;
}

function authError(message: string) {
  const err: CalendarFetchError = new Error(message);
  err.needsSignIn = true;
  return err;
}

// ── Auth Flow ─────────────────────────────────────────────────────────────────

/**
 * Start the OAuth 2.0 flow: opens the user's browser for Google sign-in, captures the redirect
 * on a temporary loopback server, and exchanges the code for tokens. A new sign-in cancels one
 * still waiting. Resolves { refreshToken, email }.
 */
async function startAuthFlow({
  clientId,
  clientSecret,
}: {
  clientId?: string;
  clientSecret?: string;
}): Promise<{ refreshToken: string; email: string }> {
  if (!clientId || !clientSecret) {
    throw new Error('Enter your OAuth Client ID and Client Secret.');
  }
  cancelAuthFlow();

  const { shell } = require('electron') as typeof import('electron');
  const port = await findFreePort(LOOPBACK_PORT_START, LOOPBACK_PORT_END);
  const redirectUri = `http://localhost:${port}`;
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

  // Any web page or local app can reach the loopback port. `state` proves a redirect belongs to
  // this sign-in (so nobody else can finish or cancel it), and PKCE means a code issued to any
  // other sign-in can't be exchanged here.
  const state = crypto.randomBytes(32).toString('hex');
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Always prompt to ensure we get a refresh token
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let server: http.Server | null = null;

    const finish = (err: Error | null, value?: { refreshToken: string; email: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { server?.close(); } catch {}
      if (activeAuth?.server === server) activeAuth = null;
      if (err) reject(err);
      else resolve(value!);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Google sign-in timed out after 2 minutes. Try again.'));
    }, AUTH_TIMEOUT_MS);

    // Request data never goes into the page or an error message (both end up in front of the
    // user or in the log); only fixed text does.
    const reply = (res: http.ServerResponse, status: number, success: boolean, message: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(makeCallbackPage(success, message));
    };

    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, redirectUri);
        if (req.method !== 'GET' || url.pathname !== '/') {
          reply(res, 404, false, 'Not found.');
          return;
        }
        if (!isExpectedState(url.searchParams.get('state'), state)) {
          reply(res, 400, false, 'This sign-in link isn’t the one MeetMind opened. Go back to MeetMind and try again.');
          return;
        }

        if (url.searchParams.has('error')) {
          const declined = url.searchParams.get('error') === 'access_denied';
          reply(res, 200, false, declined ? 'You declined access. You can close this tab.' : 'Google couldn’t complete the sign-in. You can close this tab.');
          finish(new Error(declined ? 'You declined access in the browser.' : 'Google couldn’t complete the sign-in. Try again.'));
          return;
        }

        // The state check above already proved this is Google's redirect for this sign-in. A
        // missing code just fails the exchange below with a fixed message, so it needs no branch.
        const code = url.searchParams.get('code') || '';
        const { tokens } = await client.getToken({ code, codeVerifier });
        client.setCredentials(tokens);

        let email = '';
        try {
          const userInfo = await client.request<{ email?: string }>({ url: USERINFO_URL });
          email = userInfo.data.email || '';
        } catch (e) {
          logger.warn('Could not fetch Google user email', { error: errorMessage(e) });
        }

        if (!tokens.refresh_token) {
          reply(res, 200, false, 'Google did not return a refresh token. Remove MeetMind from your Google account’s third-party access and try again.');
          finish(new Error('Google did not return a refresh token. Remove MeetMind from your Google account’s third-party access, then sign in again.'));
          return;
        }

        reply(res, 200, true, `Connected as ${escapeHtml(email) || 'your Google account'}. You can close this tab.`);
        finish(null, { refreshToken: tokens.refresh_token, email });
      } catch (err) {
        const message = tokenErrorMessage(err);
        reply(res, 500, false, `${message} You can close this tab.`);
        finish(new Error(message));
      }
    });

    activeAuth = { server, cancel: () => finish(Object.assign(new Error('Sign-in cancelled.'), { cancelled: true })) };

    server.listen(port, () => {
      logger.info('OAuth loopback server started', { port });
      shell.openExternal(authUrl).catch((err) => finish(new Error(`Failed to open browser: ${errorMessage(err)}`)));
    });

    server.on('error', (err) => finish(new Error(`Failed to start OAuth server: ${errorMessage(err)}`)));
  });
}

/** Abort a sign-in that is still waiting for the browser. */
function cancelAuthFlow() {
  activeAuth?.cancel();
  activeAuth = null;
}

/** Drop everything held for a source (removed, or its credentials replaced). */
function forgetSource(id: string) {
  clients.delete(id);
  rejected.delete(id);
}

// ── Fetch Events ──────────────────────────────────────────────────────────────

// True while this token is inside its once-a-day retry window after Google rejected it.
function isTokenRejected(source: StoredCalendarSource) {
  const entry = rejected.get(source.id);
  return !!entry && entry.token === source.refreshToken && Date.now() - entry.at < AUTH_RETRY_INTERVAL_MS;
}

/**
 * Events on the account's primary calendar that overlap [from, to) (ms). `timeMin` filters on
 * an event's end, so meetings already in progress come back too.
 */
async function fetchEvents(source: StoredCalendarSource, { from, to }: { from: number; to: number }): Promise<SourceEvent[]> {
  if (isTokenRejected(source)) throw authError(AUTH_EXPIRED_MESSAGE);
  const client = getClient(source);

  try {
    const calendar = calendarApi({ version: 'v3', auth: client });
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
  } catch (thrown) {
    const err = thrown as GoogleApiError;
    const msg = errorMessage(err) || String(err);

    // Revoked/expired refresh token: warn once, then back off to one real attempt a day with
    // this token (the poller keeps running) instead of failing every minute.
    if (msg.includes('invalid_grant') || err.response?.data?.error === 'invalid_grant' || httpStatus(err) === 401) {
      if (!isTokenRejected(source)) {
        rejected.set(source.id, { token: source.refreshToken, at: Date.now() });
        logger.warn('Google Calendar authorization was revoked or has expired; retrying once a day until you sign in again', { calendar: source.name, error: msg });
      }
      throw authError(AUTH_EXPIRED_MESSAGE);
    }

    if (msg.includes('Google Calendar API has not been used') || msg.includes('it is disabled') || msg.includes('accessNotConfigured')) {
      const error: CalendarFetchError = new Error('The Google Calendar API is not enabled in your Google Cloud project.');
      error.actionUrl = msg.match(/https?:\/\/[^\s]+/)?.[0] || API_DISABLED_URL;
      error.actionLabel = 'Enable Google Calendar API';
      throw error;
    }

    if (httpStatus(err) === 403) throw authError(AUTH_EXPIRED_MESSAGE);
    throw new Error(`Couldn’t load Google Calendar: ${msg}`);
  }
}

function normalizeEvent(event: calendar_v3.Schema$Event): SourceEvent {
  const videoEntry = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return {
    id: event.id ?? '',
    uid: event.iCalUID || event.id || '',
    title: event.summary || 'Untitled Event',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    isAllDay: !event.start?.dateTime,
    meetingLink: extractMeetingLink({
      conferenceUrls: [event.hangoutLink, videoEntry?.uri],
      description: event.description,
      location: event.location,
    }),
    location: event.location || '',
    attendeeCount: event.attendees?.length || 0,
    organizer: event.organizer?.email || '',
    status: event.status ?? undefined,
    description: event.description || '',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// The HTTP status of a failed API call: the client library puts it in `code`, newer versions in `status`.
function httpStatus(err: GoogleApiError) {
  return typeof err.code === 'number' ? err.code : err.status;
}

// Constant-time comparison of the redirect's `state` with the one this sign-in sent.
function isExpectedState(received: string | null, expected: string) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// A fixed message for a failed code exchange, chosen by Google's error code, so nothing from the
// response is shown or logged verbatim.
function tokenErrorMessage(err: unknown) {
  const code = (err as GoogleApiError | null | undefined)?.response?.data?.error;
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return 'Google didn’t accept the OAuth Client ID or Secret. Check them and try again.';
  }
  if (code === 'invalid_grant') return 'The sign-in expired before it finished. Try again.';
  return 'Google couldn’t complete the sign-in. Try again.';
}

function findFreePort(start: number, end: number) {
  return new Promise<number>((resolve, reject) => {
    function tryPort(port: number) {
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

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

function makeCallbackPage(success: boolean, message: string) {
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

export {
  startAuthFlow,
  cancelAuthFlow,
  forgetSource,
  fetchEvents,
};
