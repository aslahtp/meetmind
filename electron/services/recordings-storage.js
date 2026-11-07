// Recording storage (Settings › Storage): reads the recordings folder and deletes audio files,
// keeping each meeting's transcript and notes. The rules live in storage-rules.js; everything this
// needs from electron is passed in, so the module has no electron import.

const fs = require('fs');
const path = require('path');
const { groupRecordingFiles, planCleanup, planDeleteAll, summarize } = require('./storage-rules');

/**
 * @param {object} deps
 * @param {() => string} deps.getRecordingsDir
 * @param {object} deps.db                      electron/db/sessions.js
 * @param {(id: string) => void} deps.deleteSessionWaveform
 * @param {object} deps.logger
 */
function createRecordingsStorage({ getRecordingsDir, db, deleteSessionWaveform, logger }) {
  function scan() {
    const dir = getRecordingsDir();
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('Failed to read recordings folder', { dir, error: err.message });
      return [];
    }
    const entries = [];
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
    const map = {};
    for (const s of db.listSessions()) map[s.id] = s.started_at;
    return map;
  }

  function getSummary({ retentionDays, busyIds }) {
    return {
      dir: getRecordingsDir(),
      ...summarize({ recordings: scan(), startedAtById: startedAtById(), retentionDays, busyIds }),
    };
  }

  /** Deletes one meeting's audio files. Returns the bytes freed, or null if a file couldn't go. */
  function deleteRecording(recording) {
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
        if (err.code === 'ENOENT') continue;
        ok = false;
        logger.warn('Failed to delete recording file', { file: fp, error: err.message });
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

  function deleteRecordings(recordings, ids) {
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
  function cleanup({ retentionDays, busyIds, reason }) {
    const recordings = scan();
    const plan = planCleanup({ recordings, startedAtById: startedAtById(), retentionDays, busyIds });
    if (plan.count === 0) return { count: 0, bytes: 0, failed: 0 };
    const result = deleteRecordings(recordings, plan.ids);
    logger.info('Deleted old recordings', { reason, retentionDays, ...result });
    return result;
  }

  /** Deletes every recording except the busy ones. */
  function deleteAll({ busyIds }) {
    const recordings = scan();
    const plan = planDeleteAll({ recordings, busyIds });
    const result = deleteRecordings(recordings, plan.ids);
    logger.info('Deleted all recordings', { ...result, skipped: plan.skipped });
    return { ...result, skipped: plan.skipped };
  }

  return { scan, getSummary, cleanup, deleteAll };
}

module.exports = { createRecordingsStorage };
