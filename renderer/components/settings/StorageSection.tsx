import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, FolderOpen, Loader2, Trash2, Eraser } from 'lucide-react';
import { useApp } from '../../lib/app-context';
import { formatBytes, plural } from '../../lib/format';
import { RETENTION_OPTIONS, retentionPeriod, describeRecordings, deletionToast } from '../../lib/storage';
import { SegmentedControl, Skeleton } from '../ui/index';
import { SettingsGroup } from './SettingsParts';

// Settings › Storage: how much space recordings take, how long they're kept, and manual cleanup.
// Deleting removes only the audio; each meeting's notes and transcript stay.
export default function StorageSection({ form, onChange, active, savedRetentionDays }: { form?: any; onChange?: any; active?: any; savedRetentionDays?: any }) {
  const { confirm, addToast } = useApp();
  const [summary, setSummary] = useState<any>(null); // { dir, count, bytes, retentionDays, expiring }
  const [loadError, setLoadError] = useState<any>(null);
  const [busy, setBusy] = useState<any>(null); // null | 'cleanup' | 'delete-all' | 'open'

  const retentionDays = form.recordingRetentionDays ?? 0;
  const unsaved = savedRetentionDays != null && retentionDays !== savedRetentionDays;

  const load = useCallback(async () => {
    if (!window.meetmind?.storage) return;
    try {
      setSummary(await window.meetmind.storage.summary(retentionDays));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Couldn’t read the recordings folder.');
    }
  }, [retentionDays]);

  // Refresh when the tab opens and when another period is picked (previewed before saving).
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // Recordings deleted elsewhere (the startup cleanup, saving a shorter period) or a new one saved.
  useEffect(() => {
    if (!window.meetmind?.on || !active) return undefined;
    const unsubscribe = window.meetmind.on('sessions:changed', () => load());
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [active, load]);

  const openFolder = async () => {
    setBusy('open');
    try {
      const result = await window.meetmind.storage.openFolder();
      if (!result?.success) addToast(`Couldn’t open the recordings folder: ${result?.error || 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const runDeletion = async (kind: any) => {
    setBusy(kind);
    try {
      const result = kind === 'cleanup'
        ? await window.meetmind.storage.cleanup()
        : await window.meetmind.storage.deleteAll();
      const { message, type } = deletionToast(result);
      addToast(message, type);
    } catch (err: any) {
      addToast(`Couldn’t delete recordings: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
      load();
    }
  };

  const handleCleanup = async () => {
    const { count, bytes } = summary.expiring;
    const ok = await confirm({
      title: 'Delete old recordings?',
      message: `${describeRecordings(count, bytes)} older than ${retentionPeriod(retentionDays)} will be deleted. Their notes and transcripts are kept. This can’t be undone.`,
      confirmLabel: 'Delete recordings',
      destructive: true,
    });
    if (ok) runDeletion('cleanup');
  };

  const handleDeleteAll = async () => {
    const ok = await confirm({
      title: 'Delete all recordings?',
      message: `All ${describeRecordings(summary.count, summary.bytes)} will be deleted from this computer. Notes and transcripts are kept, but these meetings can’t be played or transcribed again. This can’t be undone.`,
      confirmLabel: 'Delete all recordings',
      destructive: true,
    });
    if (ok) runDeletion('delete-all');
  };

  const expiring = summary?.expiring;
  const canClean = !!summary && retentionDays > 0 && !unsaved && expiring?.count > 0 && !busy;

  let cleanupHint;
  if (unsaved) cleanupHint = 'Save your changes first to clean up with the new period.';
  else if (retentionDays === 0) cleanupHint = 'Pick how long to keep recordings to clean up old ones, or delete them all.';
  else cleanupHint = `Delete recordings older than ${retentionPeriod(retentionDays)} now, or delete them all.`;

  return (
    <div className="space-y-24">
      <SettingsGroup
        title="Recordings"
        description="Meeting audio saved on this computer. Deleting a recording keeps the meeting’s notes and transcript."
        icon={<HardDrive size={20} strokeWidth={1.75} className="text-ink" />}
        aside={
          <button type="button" onClick={openFolder} disabled={busy === 'open'} className="btn-ghost btn-sm">
            {busy === 'open'
              ? <Loader2 size={14} strokeWidth={2} className="spinner" />
              : <FolderOpen size={14} strokeWidth={1.75} />}
            Open folder
          </button>
        }
      >
        {/* ── Totals ─────────────────────────────────────────────────────── */}
        <div aria-live="polite">
          {summary ? (
            <>
              <p className="text-heading font-medium text-ink tabular">{formatBytes(summary.bytes)}</p>
              <p className="text-caption text-graphite mt-4 tabular">
                {summary.count === 0 ? 'No recordings saved' : `${plural(summary.count, 'recording')} saved`}
              </p>
              {summary.dir && (
                <p className="font-mono text-caption text-graphite truncate mt-8" title={summary.dir}>{summary.dir}</p>
              )}
            </>
          ) : loadError ? (
            <p role="alert" className="text-caption text-signal">{loadError}</p>
          ) : (
            <div className="space-y-8">
              <Skeleton className="h-32 w-128" />
              <Skeleton className="h-16 w-192" />
            </div>
          )}
        </div>

        {/* ── Retention ──────────────────────────────────────────────────── */}
        <div className="rule pt-24">
          <p className="text-body-sm font-medium text-ink">Keep recordings</p>
          <p className="text-caption text-graphite mt-4">
            Older recordings are deleted when MeetMind starts. A meeting that’s being recorded or processed is never touched.
          </p>
          <div className="mt-16 overflow-x-auto">
            <SegmentedControl
              role="radiogroup"
              label="Keep recordings"
              options={RETENTION_OPTIONS}
              value={retentionDays}
              onChange={(days: any) => onChange('recordingRetentionDays', days)}
            />
          </div>
          {summary && retentionDays > 0 && (
            <p className="text-caption text-graphite mt-16 tabular">
              {expiring.count > 0
                ? `${describeRecordings(expiring.count, expiring.bytes)} ${expiring.count === 1 ? 'is' : 'are'} older than ${retentionPeriod(retentionDays)}${unsaved ? ' and will be deleted when you save.' : '.'}`
                : `No recordings are older than ${retentionPeriod(retentionDays)}.`}
            </p>
          )}
        </div>

        {/* ── Manual cleanup ─────────────────────────────────────────────── */}
        <div className="rule pt-24">
          <p className="text-body-sm font-medium text-ink">Free up space</p>
          <p className="text-caption text-graphite mt-4">{cleanupHint}</p>
          <div className="flex flex-wrap items-center gap-8 mt-16">
            <button type="button" onClick={handleCleanup} disabled={!canClean} className="btn-ghost btn-sm">
              {busy === 'cleanup'
                ? <Loader2 size={14} strokeWidth={2} className="spinner" />
                : <Eraser size={14} strokeWidth={1.75} />}
              Clean up now
            </button>
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={!summary || summary.count === 0 || !!busy}
              className="btn-ghost btn-sm"
            >
              {busy === 'delete-all'
                ? <Loader2 size={14} strokeWidth={2} className="spinner" />
                : <Trash2 size={14} strokeWidth={1.75} />}
              Delete all recordings
            </button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
}
