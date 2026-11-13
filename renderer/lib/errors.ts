// Reading a caught value. With `strict`, `catch (err)` gives `unknown`: it is usually an Error, but
// IPC and libraries can reject with a string or a plain object. Same as electron/utils/errors.ts (the
// renderer may not import runtime code from electron/).

/** The message of a thrown value: an Error's (or error-like object's) `message`, else the value as text; '' for null/undefined. */
export function errorMessage(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return String(err);
}
