import { useState, useEffect } from 'react';
import { useApp } from '../app.jsx';

// Sessions come from a local SQLite file and normally load in well under 100ms.
// Showing the skeleton instantly would just swap one flash for another, so only
// reveal it if loading is actually slow enough to look like a hang.
export const SKELETON_DELAY_MS = 160;

export function useDelayedFlag(active, delayMs) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return visible;
}

// Re-render on an interval so time-relative labels (Live / Soon) stay fresh.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const REMOVE_ANIMATION_MS = 300; // matches .card-deleting in globals.css

export function useSessionActions() {
  const { refreshSessions, confirm, addToast } = useApp();
  const [deletingIds, setDeletingIds] = useState(new Set());

  const handleDelete = async (session) => {
    if (deletingIds.has(session.id)) return;
    const ok = await confirm({
      title: 'Delete this meeting?',
      message: 'The recording, transcript and notes will be removed from this computer. This cannot be undone.',
      confirmLabel: 'Delete meeting',
      destructive: true,
    });
    if (!ok) return;

    setDeletingIds((prev) => new Set(prev).add(session.id));
    try {
      await Promise.all([
        window.meetmind.sessions.delete(session.id),
        new Promise((r) => setTimeout(r, REMOVE_ANIMATION_MS)),
      ]);
      await refreshSessions();
    } catch (err) {
      addToast(`Couldn't delete the meeting: ${err.message}`, 'error');
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  };

  const handleUploadAudio = async () => {
    try {
      const result = await window.meetmind.recording.uploadFile();
      if (result?.success) {
        await refreshSessions();
      } else if (result?.error && !result.cancelled) {
        addToast(result.error, 'error');
      }
    } catch (err) {
      addToast(err.message || 'Failed to import audio file.', 'error');
    }
  };

  // Processing runs in the background; progress arrives via `processing:progress`.
  const handleRetry = async (session) => {
    try {
      const result = await window.meetmind.processing.retry(session.id, 'all');
      if (result?.success === false) {
        addToast(result.error || 'Retry failed.', 'error');
        return;
      }
      await refreshSessions();
    } catch (err) {
      addToast(err.message || 'Retry failed.', 'error');
    }
  };

  return { deletingIds, handleDelete, handleUploadAudio, handleRetry };
}
