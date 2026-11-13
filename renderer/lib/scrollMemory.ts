import { useLayoutEffect, useState } from 'react';

// Remembers where list pages (Dashboard, Meetings) were scrolled, so Back from a meeting
// returns to the same spot. Positions are recorded continuously; they're only re-applied when
// the page is re-entered via Back (see markScrollRestore), not when opened from the top bar.

const positions = new Map();     // key → last scrollTop
const pendingRestore = new Set(); // keys to restore on their next mount
const values = new Map();         // key → remembered UI state (search, filter…)
const pendingFocus = new Set();   // keys of controls to focus once their page mounts

// Give up waiting for content that never gets tall enough (e.g. the list shrank meanwhile).
const RESTORE_TIMEOUT_MS = 1500;

export function markScrollRestore(key: any) {
  pendingRestore.add(key);
}

export function cancelScrollRestore(key: any) {
  pendingRestore.delete(key);
}

/** Ask the next page that owns `key` to focus that control once it's on screen. */
export function requestFocus(key: any) {
  pendingFocus.add(key);
}

/** True (once) if focus was requested for `key`. */
export function consumeFocus(key: any) {
  return pendingFocus.delete(key);
}

/**
 * Returns a callback ref for a page's scroll container. It saves the position as the user
 * scrolls and, if a restore is pending for `key`, scrolls back to the saved position as soon as
 * the content is tall enough. Any user scroll input cancels a pending restore.
 */
export function useScrollMemory(key: any) {
  const [el, setEl] = useState<any>(null);

  useLayoutEffect(() => {
    if (!el) return undefined;
    const target = pendingRestore.has(key) ? positions.get(key) || 0 : 0;
    pendingRestore.delete(key);
    let restoring = target > 0;
    let ro: any = null;
    let timer: any = null;

    const finish = () => {
      restoring = false;
      ro?.disconnect();
      clearTimeout(timer);
    };
    const tryRestore = () => {
      if (!restoring) return;
      if (el.scrollHeight - el.clientHeight >= target - 1) {
        el.scrollTop = target;
        finish();
      }
    };

    if (restoring) {
      ro = new ResizeObserver(tryRestore);
      Array.from(el.children).forEach((child) => ro.observe(child));
      timer = setTimeout(finish, RESTORE_TIMEOUT_MS);
      tryRestore();
    }

    const onScroll = () => {
      if (!restoring) positions.set(key, el.scrollTop);
    };
    const cancel = () => { if (restoring) finish(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', cancel, { passive: true });
    el.addEventListener('pointerdown', cancel);
    el.addEventListener('keydown', cancel);

    return () => {
      finish();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', cancel);
      el.removeEventListener('pointerdown', cancel);
      el.removeEventListener('keydown', cancel);
    };
  }, [el, key]);

  return setEl;
}

/** useState that survives the page unmounting (for the rest of the app session). */
export function useRememberedState(key: any, initialValue: any) {
  const [value, setValue] = useState(() => (values.has(key) ? values.get(key) : initialValue));
  const set = (next: any) => {
    setValue((prev: any) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      values.set(key, resolved);
      return resolved;
    });
  };
  return [value, set];
}
