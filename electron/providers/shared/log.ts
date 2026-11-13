// Lazy, failure-tolerant logger so provider modules stay importable outside Electron (unit tests).
let real: any;
function getLogger() {
  if (real === undefined) {
    try { real = require('../../utils/logger'); } catch { real = null; }
  }
  return real;
}

function make(level: any) {
  return (...args: any[]) => {
    try { getLogger()?.[level]?.(...args); } catch { /* logging must never break a provider */ }
  };
}

export const info = make('info');
export const warn = make('warn');
export const error = make('error');
export const debug = make('debug');
