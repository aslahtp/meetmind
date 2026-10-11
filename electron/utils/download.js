// Streams an HTTPS download to disk and returns its SHA-256. No electron import, so the release
// fetch script (scripts/fetch-ffmpeg.js) can use it too.

const fs = require('fs');
const crypto = require('crypto');

/**
 * Downloads `url` to `dest`, following redirects. `onProgress({ downloaded, total })` is called
 * as bytes arrive (`total` is 0 when the server sends no Content-Length).
 * Resolves with the file's SHA-256 (lowercase hex).
 */
function downloadFile(url, dest, { onProgress, userAgent = 'MeetMind-Installer/1.0', maxRedirects = 8 } = {}) {
  return new Promise((resolve, reject) => {
    function get(current, redirectsLeft) {
      const mod = current.startsWith('https:') ? require('https') : require('http');
      mod.get(current, { headers: { 'User-Agent': userAgent } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return get(new URL(res.headers.location, current).toString(), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        const hash = crypto.createHash('sha256');
        const file = fs.createWriteStream(dest);
        let downloaded = 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          hash.update(chunk);
          onProgress?.({ downloaded, total });
        });
        res.on('error', reject);
        file.on('error', reject);
        file.on('finish', () => file.close(() => resolve(hash.digest('hex'))));
        res.pipe(file);
      }).on('error', reject);
    }
    get(url, maxRedirects);
  });
}

/** Throws unless `actual` equals the pinned `expected` SHA-256. */
function assertSha256(actual, expected, label) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`Checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
}

module.exports = { downloadFile, assertSha256 };
