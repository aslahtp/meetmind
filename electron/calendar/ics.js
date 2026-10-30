// Download an ICS feed. Conditional requests (ETag / Last-Modified) let an unchanged feed answer
// 304 without a body; the size cap and timeout keep a wrong or hostile URL from stalling the app.
// The URL is a credential (anyone with it can read the calendar), so it never goes into errors.

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const USER_AGENT = 'MeetMind (+https://github.com/aslahtp/meetmind)';

const DEAD_LINK = 'This calendar link no longer works. Copy a fresh ICS link from your calendar and update it here.';

function host(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the calendar server';
  }
}

async function readCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new Error('This calendar is too large to read (over 15 MB).');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('This calendar is too large to read (over 15 MB).');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * GET the feed. Resolves { notModified: true } on a 304, otherwise { text, etag, lastModified }.
 * Rejects with an error message that is safe to show and to log.
 */
async function fetchIcs(url, { etag = '', lastModified = '', fetchImpl = fetch } = {}) {
  const headers = { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': USER_AGENT };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  let response;
  try {
    response = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`${host(url)} took too long to respond. Try again later.`);
    }
    throw new Error(`Couldn’t reach ${host(url)}. Check your internet connection.`);
  }

  if (response.status === 304) return { notModified: true };
  if ([401, 403, 404, 410].includes(response.status)) throw new Error(DEAD_LINK);
  if (!response.ok) throw new Error(`${host(url)} returned an error (HTTP ${response.status}). Try again later.`);

  return {
    text: await readCapped(response),
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
  };
}

module.exports = { fetchIcs, DEAD_LINK };
