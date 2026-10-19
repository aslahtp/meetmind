const https = require('https');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpsPost(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch {
          resolve(responseBody);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { ...extraHeaders },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPut(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ?? Buffer.alloc(0);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      headers: {
        'Content-Length': payload.length,
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: responseBody });
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}: ${responseBody || res.statusMessage}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Build the Error for a non-2xx response, carrying `.status` and `.retryAfterMs`. */
function httpError(res, text, label = 'API') {
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  const detail = data?.error?.message || data?.message || text.slice(0, 300) || res.statusText;
  const err = new Error(`${label} error (${res.status}): ${detail}`);
  err.status = res.status;
  const retryAfter = Number(res.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
  return err;
}

/**
 * fetch() wrapper for OpenAI-compatible JSON/multipart APIs. Throws an Error
 * carrying `.status` and `.retryAfterMs` on non-2xx so callers can map/retry.
 */
async function fetchJson(url, init = {}, { label = 'API', fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) throw httpError(res, text, label);
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

module.exports = { sleep, httpsPost, httpsGet, httpsPut, httpError, fetchJson };
