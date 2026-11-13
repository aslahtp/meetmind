import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type initSqlJs from 'sql.js';
import type { NewSession, Notes, Session, SessionUpdate } from '../shared';
import logger from '../utils/logger';
import { errorMessage } from '../utils/errors';
import { sanitizeNotes, sanitizeTranscript } from '../services/notes-sanitize';

type SqlDatabase = initSqlJs.Database;
type SqlValue = initSqlJs.SqlValue;

let db: SqlDatabase | null = null;

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'meetmind.db');
}

// Bumped on every write, so the renderer can skip re-reading every session when nothing changed.
let revision = 0;

function getRevision() {
  return revision;
}

// Called after every write with the new revision; main.ts tells the renderer (sessions:changed),
// so every screen shows a status change the moment it is saved.
const changeListeners = new Set<(revision: number) => void>();

function onChange(listener: (revision: number) => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function persist() {
  if (!db) return;
  revision += 1;
  try {
    const data = db.export();
    const buf = Buffer.from(data);
    fs.writeFileSync(getDbPath(), buf);
  } catch (err) {
    logger.error('Failed to persist database', { error: errorMessage(err) });
  }
  for (const listener of changeListeners) {
    try {
      listener(revision);
    } catch (err) {
      logger.warn('Database change listener failed', { error: errorMessage(err) });
    }
  }
}

async function initialize() {
  const initSql: typeof initSqlJs = require('sql.js');
  const SQL = await initSql();
  const dbPath = getDbPath();

  logger.info('Initializing SQLite database', { dbPath });

  const database = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  db = database;

  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL DEFAULT 'Untitled Meeting',
      meeting_url       TEXT,
      started_at        DATETIME,
      ended_at          DATETIME,
      duration_seconds  INTEGER,
      audio_path        TEXT,
      transcript        TEXT,
      notes             TEXT,
      notion_page_url   TEXT,
      status            TEXT NOT NULL DEFAULT 'recording'
    )
  `);
  // Added in 4.0.0: why the last processing run failed (no migration system, so add if missing).
  const cols = database.exec('PRAGMA table_info(sessions)')[0]?.values.map((r) => r[1]) || [];
  if (!cols.includes('last_error')) database.run('ALTER TABLE sessions ADD COLUMN last_error TEXT');
  // Added in 4.10.0: the meeting's own title (detected tab, calendar, pasted title), kept over the LLM's.
  if (!cols.includes('meeting_title')) database.run('ALTER TABLE sessions ADD COLUMN meeting_title TEXT');
  // Added in 4.17.0: when Settings › Storage deleted the recording (the notes and transcript stay),
  // and where a meeting came from ('transcript' for a pasted transcript, otherwise NULL).
  if (!cols.includes('audio_deleted_at')) database.run('ALTER TABLE sessions ADD COLUMN audio_deleted_at TEXT');
  if (!cols.includes('source')) database.run('ALTER TABLE sessions ADD COLUMN source TEXT');
  // Added in 4.17.0: the platform meeting detection saw ('meet' | 'zoom' | 'teams'), for meetings
  // recorded from its prompt, which have no link to read it from.
  if (!cols.includes('meeting_platform')) database.run('ALTER TABLE sessions ADD COLUMN meeting_platform TEXT');
  database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  persist();

  logger.info('Database initialized');
  return database;
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized. Call initialize() first.');
  return db;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createSession(session: NewSession) {
  const d = ensureDb();
  d.run(
    `INSERT INTO sessions (id, title, meeting_title, meeting_url, meeting_platform, started_at, audio_path, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title         || 'Untitled Meeting',
      session.meeting_title || null,
      session.meeting_url   || null,
      session.meeting_platform || null,
      session.started_at  || new Date().toISOString(),
      session.audio_path  || null,
      session.status      || 'recording',
      session.source      || null,
    ]
  );
  persist();
  return getSession(session.id);
}

function updateSession(id: string, updates: SessionUpdate) {
  const d = ensureDb();
  const allowed = ['title', 'meeting_title', 'meeting_url', 'started_at', 'ended_at', 'duration_seconds', 'audio_path', 'transcript', 'notes', 'notion_page_url', 'status', 'last_error', 'audio_deleted_at'];
  const keys = Object.keys(updates).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (updates as Record<string, SqlValue>)[k]);
  values.push(id);
  d.run(`UPDATE sessions SET ${setClause} WHERE id = ?`, values);
  persist();
}

function getSession(id: string): Session | null {
  const d = ensureDb();
  const stmt = d.prepare('SELECT * FROM sessions WHERE id = ?');
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return deserializeSession(row);
}

function listSessions({ limit = null, offset = 0 }: { limit?: number | null; offset?: number } = {}): Session[] {
  const d = ensureDb();
  let stmt: initSqlJs.Statement;
  if (limit !== null) {
    stmt = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
  } else {
    stmt = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC');
    stmt.bind([]);
  }
  const rows: initSqlJs.ParamsObject[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map((row) => deserializeSession(row));
}

function deleteSession(id: string) {
  const d = ensureDb();
  d.run('DELETE FROM sessions WHERE id = ?', [id]);
  persist();
}

function getSessionCount() {
  const d = ensureDb();
  const stmt = d.prepare('SELECT COUNT(*) as count FROM sessions');
  stmt.step();
  const count = stmt.get()[0] as number;
  stmt.free();
  return count;
}

function getRecentSessions(limit = 5) {
  return listSessions({ limit });
}

/**
 * Mark sessions stuck in 'recording' (e.g. app crashed or stop failed) as 'error'
 * if they started more than 2 hours ago.
 */
function markStaleRecordingSessionsAsError() {
  const d = ensureDb();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  d.run(`UPDATE sessions SET status = 'error' WHERE status = 'recording' AND started_at < ?`, [cutoff]);
  persist();
}

// ── Deserialization ───────────────────────────────────────────────────────────

function deserializeSession(row: initSqlJs.ParamsObject): Session;
function deserializeSession(row: null | undefined): null;
function deserializeSession(row: initSqlJs.ParamsObject | null | undefined): Session | null {
  if (!row) return null;
  // The columns are Session's fields (transcript and notes stored as JSON text).
  return {
    ...row,
    // Type-checked on the way out: a wrongly typed field in an old row must not break the UI.
    transcript: sanitizeStoredTranscript(safeJsonParse<unknown>(row.transcript, [])),
    notes:      sanitizeNotes(safeJsonParse<Notes | null>(row.notes, null)),
  } as unknown as Session;
}

function sanitizeStoredTranscript(transcript: unknown) {
  return Array.isArray(transcript) ? sanitizeTranscript(transcript) : transcript;
}

function safeJsonParse<T>(value: SqlValue | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

// ── Duration calculation ──────────────────────────────────────────────────────

function computeDuration(session: Pick<Session, 'started_at' | 'ended_at'>) {
  if (!session.started_at || !session.ended_at) return null;
  const start = new Date(session.started_at).getTime();
  const end   = new Date(session.ended_at).getTime();
  return Math.round((end - start) / 1000);
}

export {
  initialize,
  createSession,
  updateSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionCount,
  getRecentSessions,
  markStaleRecordingSessionsAsError,
  getRevision,
  onChange,
  computeDuration,
};
