// Rules for how long recordings are kept (Settings › Storage). Pure (no electron import) so they
// are unit-tested; electron/services/recordings-storage.js applies them to the recordings folder.

const DAY_MS = 24 * 60 * 60 * 1000;

// 0 means keep recordings forever.
const RETENTION_DAYS = [0, 1, 7, 30, 90, 365];
const DEFAULT_RETENTION_DAYS = 0;

const AUDIO_EXTENSIONS = ['.wav', '.webm'];

function normalizeRetentionDays(value: any) {
  const n = Number(value);
  return RETENTION_DAYS.includes(n) ? n : DEFAULT_RETENTION_DAYS;
}

/**
 * Groups the recordings folder's files by meeting id (the file's basename), keeping only audio.
 * @param {{ name: string, size: number, mtimeMs: number }[]} entries
 * @returns {{ id: string, files: string[], bytes: number, mtimeMs: number }[]}
 */
function groupRecordingFiles(entries: any) {
  const byId = new Map();
  for (const entry of entries || []) {
    if (!entry || typeof entry.name !== 'string') continue;
    const lower = entry.name.toLowerCase();
    const ext = AUDIO_EXTENSIONS.find((e) => lower.endsWith(e));
    if (!ext) continue;
    const id = entry.name.slice(0, -ext.length);
    if (!id) continue;
    const size = Number(entry.size) > 0 ? Number(entry.size) : 0;
    const mtimeMs = Number(entry.mtimeMs) || 0;
    const existing = byId.get(id);
    if (existing) {
      existing.files.push(entry.name);
      existing.bytes += size;
      existing.mtimeMs = Math.max(existing.mtimeMs, mtimeMs);
    } else {
      byId.set(id, { id, files: [entry.name], bytes: size, mtimeMs });
    }
  }
  return [...byId.values()];
}

/**
 * Whether a meeting id from the renderer can name files in the recordings folder: no path
 * separators or dot segments, so it can't reach outside it.
 */
function isRecordingId(id: any) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/**
 * When a recording was made: its meeting's start, or for a file with no meeting, the file's
 * modified time.
 */
function recordingTime(recording: any, startedAtById: any) {
  const startedAt = startedAtById?.[recording.id];
  if (startedAt) {
    const t = new Date(startedAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  return recording.mtimeMs || 0;
}

function totals(recordings: any) {
  return {
    ids: recordings.map((r: any) => r.id),
    count: recordings.length,
    bytes: recordings.reduce((sum: any, r: any) => sum + (r.bytes || 0), 0),
  };
}

function notBusy(busyIds: any) {
  const busy = busyIds instanceof Set ? busyIds : new Set(busyIds || []);
  return (r: any) => !busy.has(r.id);
}

/**
 * The recordings older than the retention period, except the busy ones (being recorded or
 * processed right now). Nothing when recordings are kept forever.
 */
function planCleanup({ recordings, startedAtById, retentionDays, now = Date.now(), busyIds }: any) {
  const days = normalizeRetentionDays(retentionDays);
  if (!days) return totals([]);
  const cutoff = now - days * DAY_MS;
  const expired = (recordings || [])
    .filter(notBusy(busyIds))
    .filter((r: any) => recordingTime(r, startedAtById) < cutoff);
  return totals(expired);
}

/** Every recording but the busy ones, for "Delete all recordings". */
function planDeleteAll({ recordings, busyIds }: any) {
  const all = recordings || [];
  const deletable = all.filter(notBusy(busyIds));
  return { ...totals(deletable), skipped: all.length - deletable.length };
}

function summarize({ recordings, startedAtById, retentionDays, now = Date.now(), busyIds }: any) {
  const { count, bytes } = totals(recordings || []);
  const expiring = planCleanup({ recordings, startedAtById, retentionDays, now, busyIds });
  return {
    count,
    bytes,
    retentionDays: normalizeRetentionDays(retentionDays),
    expiring: { count: expiring.count, bytes: expiring.bytes },
  };
}

export {
  RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  normalizeRetentionDays,
  AUDIO_EXTENSIONS,
  isRecordingId,
  groupRecordingFiles,
  recordingTime,
  planCleanup,
  planDeleteAll,
  summarize,
};
