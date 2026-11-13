// Lazy, failure-tolerant logger so provider modules stay importable outside Electron (unit tests).
type LoggerModule = Record<string, ((...args: unknown[]) => void) | undefined>;
let real: LoggerModule | null | undefined;
function getLogger(): LoggerModule | null {
  if (real === undefined) {
    try { real = require('../../utils/logger') as LoggerModule; } catch { real = null; }
  }
  return real ?? null;
}

function make(level: string) {
  return (...args: unknown[]) => {
    try { getLogger()?.[level]?.(...args); } catch { /* logging must never break a provider */ }
  };
}

export const info = make('info');
export const warn = make('warn');
export const error = make('error');
export const debug = make('debug');
