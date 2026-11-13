// Reading a caught value. With `strict`, `catch (err)` gives `unknown`: it is usually an Error, but
// a library can throw a string or a plain object. renderer/lib/errors.ts is the renderer's copy (the
// renderer may not import runtime code from electron/).

/** The message of a thrown value: an Error's (or error-like object's) `message`, else the value as text; '' for null/undefined. */
export function errorMessage(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return String(err);
}

/** A Node system error's `code` (e.g. 'ENOENT'), if the thrown value has one. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') return err.code;
  return undefined;
}
