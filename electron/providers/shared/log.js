// Lazy, failure-tolerant logger so provider modules stay importable outside Electron (unit tests).
let real;
function getLogger() {
  if (real === undefined) {
    try { real = require('../../utils/logger'); } catch { real = null; }
  }
  return real;
}

function make(level) {
  return (...args) => {
    try { getLogger()?.[level]?.(...args); } catch { /* logging must never break a provider */ }
  };
}

module.exports = { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug') };
