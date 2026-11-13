// Sends renderer errors to the main process log (Settings › Logs, and the log file). Without this
// a render error or an unhandled rejection left no trace outside DevTools.

const MAX_TEXT = 4000;

const clip = (value: any) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined);

/** `kind`: 'render' (caught by an error boundary), 'error' or 'unhandledrejection'. */
export function reportError(kind: any, error: any, extra = {}) {
  try {
    const err = error instanceof Error ? error : null;
    window.meetmind?.reportError?.({
      kind,
      message: clip(err ? err.message : String(error)),
      stack: clip(err?.stack),
      ...extra,
    });
  } catch { /* reporting must never throw */ }
}

/** Reports uncaught errors and unhandled promise rejections. Call once, at startup. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    // Resource load failures (an <img>, a script) arrive here too, without an error object.
    if (!event.error && !event.message) return;
    reportError('error', event.error || event.message, {
      source: clip(event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError('unhandledrejection', event.reason);
  });
}
