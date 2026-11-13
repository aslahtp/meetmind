import https from 'https';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parsed JSON, or the raw body text when it isn't JSON. */
function httpsPost(url: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
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

function httpsGet(url: string, extraHeaders: Record<string, string> = {}): Promise<unknown> {
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

function httpsPut(url: string, body: Buffer | null | undefined, extraHeaders: Record<string, string> = {}): Promise<{ statusCode: number; body: string }> {
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
        if (res.statusCode! >= 200 && res.statusCode! < 300) {
          resolve({ statusCode: res.statusCode!, body: responseBody });
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

/** An Error for a non-2xx response; `status` and `retryAfterMs` are what callers map or retry on. */
export type HttpError = Error & { status?: number; retryAfterMs?: number };

/** Build the Error for a non-2xx response, carrying `.status` and `.retryAfterMs`. */
function httpError(res: Pick<Response, 'status' | 'statusText' | 'headers'>, text: string, label = 'API'): HttpError {
  let data: { error?: { message?: string }; message?: string } | null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  const detail = data?.error?.message || data?.message || text.slice(0, 300) || res.statusText;
  const err: HttpError = new Error(`${label} error (${res.status}): ${detail}`);
  err.status = res.status;
  const retryAfter = Number(res.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
  return err;
}

/**
 * fetch() wrapper for OpenAI-compatible JSON/multipart APIs. Throws an Error
 * carrying `.status` and `.retryAfterMs` on non-2xx so callers can map/retry.
 */
async function fetchJson(
  url: string,
  init: RequestInit = {},
  { label = 'API', fetchImpl = globalThis.fetch }: { label?: string; fetchImpl?: typeof fetch } = {}
): Promise<unknown> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) throw httpError(res, text, label);
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

export { sleep, httpsPost, httpsGet, httpsPut, httpError, fetchJson };
