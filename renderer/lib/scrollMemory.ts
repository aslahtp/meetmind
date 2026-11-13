import { useLayoutEffect, useState } from 'react';

// Remembers where list pages (Dashboard, Meetings) were scrolled, so Back from a meeting
// returns to the same spot. Positions are recorded continuously; they're only re-applied when
// the page is re-entered via Back (see markScrollRestore), not when opened from the top bar.

const positions = new Map<string, number>();     // key → last scrollTop
const pendingRestore = new Set<string>(); // keys to restore on their next mount
const values = new Map<string, unknown>();         // key → remembered UI state (search, filter…)
const pendingFocus = new Set<string>();   // keys of controls to focus once their page mounts

// Give up waiting for content that never gets tall enough (e.g. the list shrank meanwhile).
const RESTORE_TIMEOUT_MS = 1500;

export function markScrollRestore(key: string) {
  pendingRestore.add(key);
}

export function cancelScrollRestore(key: string) {
  pendingRestore.delete(key);
}

/** Ask the next page that owns `key` to focus that control once it's on screen. */
export function requestFocus(key: string) {
  pendingFocus.add(key);
}

/** True (once) if focus was requested for `key`. */
export function consumeFocus(key: string) {
  return pendingFocus.delete(key);
}

/**
 * Returns a callback ref for a page's scroll container. It saves the position as the user
 * scrolls and, if a restore is pending for `key`, scrolls back to the saved position as soon as
 * the content is tall enough. Any user scroll input cancels a pending restore.
 */
export function useScrollMemory(key: string): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!el) return undefined;
    const target = pendingRestore.has(key) ? positions.get(key) || 0 : 0;
    pendingRestore.delete(key);
    let restoring = target > 0;
    let ro: ResizeObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
      const observer = new ResizeObserver(tryRestore);
      ro = observer;
      Array.from(el.children).forEach((child) => observer.observe(child));
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
export function useRememberedState<T>(
  key: string,
  initialValue: T,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  // The map holds whatever each key's page stored; a key is only ever used with one type.
  const [value, setValue] = useState<T>(() => (values.has(key) ? (values.get(key) as T) : initialValue));
  const set = (next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      values.set(key, resolved);
      return resolved;
    });
  };
  return [value, set] as const;
}
