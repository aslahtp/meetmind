// Recording storage (Settings › Storage): reads the recordings folder and deletes audio files,
// keeping each meeting's transcript and notes. The rules live in storage-rules.ts; everything this
// needs from electron is passed in, so the module has no electron import.

import type { Outcome } from '../shared';
import fs from 'fs';
import path from 'path';
import { errorCode, errorMessage } from '../utils/errors';
import type * as SessionsDb from '../db/sessions';
import {
  AUDIO_EXTENSIONS,
  isRecordingId,
  groupRecordingFiles,
  planCleanup,
  planDeleteAll,
  summarize,
  type BusyIds,
  type Recording,
  type RecordingFile,
  type StartedAtById,
} from './storage-rules';

interface RecordingsStorageDeps {
  getRecordingsDir: () => string;
  /** electron/db/sessions.ts */
  db: Pick<typeof SessionsDb, 'listSessions' | 'getSession' | 'updateSession'>;
  deleteSessionWaveform: (id: string) => void;
  logger: { info(message: string, data?: unknown): void; warn(message: string, data?: unknown): void };
}

function createRecordingsStorage({ getRecordingsDir, db, deleteSessionWaveform, logger }: RecordingsStorageDeps) {
  function scan() {
    const dir = getRecordingsDir();
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') logger.warn('Failed to read recordings folder', { dir, error: errorMessage(err) });
      return [];
    }
    const entries: RecordingFile[] = [];
    for (const name of names) {
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.isFile()) entries.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Deleted while scanning.
      }
    }
    return groupRecordingFiles(entries);
  }

  function startedAtById() {
    const map: StartedAtById = {};
    for (const s of db.listSessions()) map[s.id] = s.started_at;
    return map;
  }

  function getSummary({ retentionDays, busyIds }: { retentionDays?: unknown; busyIds?: BusyIds }) {
    return {
      dir: getRecordingsDir(),
      ...summarize({ recordings: scan(), startedAtById: startedAtById(), retentionDays, busyIds }),
    };
  }

  /** Deletes one meeting's audio files. Returns the bytes freed, or null if a file couldn't go. */
  function deleteRecording(recording: Recording) {
    const dir = getRecordingsDir();
    let freed = 0;
    let ok = true;
    for (const name of recording.files) {
      const fp = path.join(dir, name);
      try {
        const { size } = fs.statSync(fp);
        fs.unlinkSync(fp);
        freed += size;
      } catch (err) {
        if (errorCode(err) === 'ENOENT') continue;
        ok = false;
        logger.warn('Failed to delete recording file', { file: fp, error: errorMessage(err) });
      }
    }
    // A locked file stays, and so does its meeting's link to it; the next run tries again.
    if (!ok) return null;
    deleteSessionWaveform(recording.id);
    if (db.getSession(recording.id)) {
      db.updateSession(recording.id, { audio_path: null, audio_deleted_at: new Date().toISOString() });
    }
    return freed;
  }

  function deleteRecordings(recordings: Recording[], ids: Iterable<string>) {
    const wanted = new Set(ids);
    let count = 0;
    let bytes = 0;
    let failed = 0;
    for (const recording of recordings) {
      if (!wanted.has(recording.id)) continue;
      const freed = deleteRecording(recording);
      if (freed == null) failed += 1;
      else {
        count += 1;
        bytes += freed;
      }
    }
    return { count, bytes, failed };
  }

  /** Deletes the recordings older than the retention period. */
  function cleanup({ retentionDays, busyIds, reason }: { retentionDays?: unknown; busyIds?: BusyIds; reason?: string }) {
    const recordings = scan();
    const plan = planCleanup({ recordings, startedAtById: startedAtById(), retentionDays, busyIds });
    if (plan.count === 0) return { count: 0, bytes: 0, failed: 0 };
    const result = deleteRecordings(recordings, plan.ids);
    logger.info('Deleted old recordings', { reason, retentionDays, ...result });
    return result;
  }

  /** Deletes every recording except the busy ones. */
  function deleteAll({ busyIds }: { busyIds?: BusyIds }) {
    const recordings = scan();
    const plan = planDeleteAll({ recordings, busyIds });
    const result = deleteRecordings(recordings, plan.ids);
    logger.info('Deleted all recordings', { ...result, skipped: plan.skipped });
    return { ...result, skipped: plan.skipped };
  }

  /**
   * One meeting's audio files (its id plus .wav/.webm), without reading the whole folder.
   * Returns { id, files, bytes, mtimeMs } or null when it has none.
   */
  function find(id: unknown) {
    if (!isRecordingId(id)) return null;
    const dir = getRecordingsDir();
    const entries: RecordingFile[] = [];
    for (const ext of AUDIO_EXTENSIONS) {
      const name = `${id}${ext}`;
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.isFile()) entries.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // No file with this extension.
      }
    }
    return groupRecordingFiles(entries)[0] || null;
  }

  /**
   * Deletes one meeting's audio from its Audio tab. Refuses while it is being recorded or
   * processed. Returns { success, bytes } or { success: false, error }.
   */
  function deleteOne({ id, busyIds }: { id: unknown; busyIds?: Set<string> | null }): Outcome<{ bytes: number }> {
    if (!isRecordingId(id)) return { success: false, error: 'Unknown meeting.' };
    if (busyIds?.has(id)) {
      return { success: false, error: 'This meeting is being recorded or processed. Try again when it’s done.' };
    }
    const recording = find(id);
    if (!recording) return { success: false, error: 'There’s no recording to delete.' };
    const bytes = deleteRecording(recording);
    if (bytes == null) {
      return { success: false, error: 'The recording file is in use. Close any app playing it and try again.' };
    }
    logger.info('Deleted a recording', { sessionId: id, bytes });
    return { success: true, bytes };
  }

  return { scan, find, getSummary, cleanup, deleteAll, deleteOne };
}

export { createRecordingsStorage };
