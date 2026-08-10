const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');

let db = null;
let SQL = null;

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'meetmind.db');
}

function persist() {
  if (!db) return;
  try {
    const data = db.export();
    const buf = Buffer.from(data);
    fs.writeFileSync(getDbPath(), buf);
  } catch (err) {
    logger.error('Failed to persist database', { error: err.message });
  }
}

async function initialize() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  const dbPath = getDbPath();

  logger.info('Initializing SQLite database', { dbPath });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  persist();

  logger.info('Database initialized');
  return db;
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized. Call initialize() first.');
  return db;
}

// ── Row helper: sql.js returns {columns, values} for exec; we need row objects ───

function rowToObject(columns, values) {
  const row = {};
  columns.forEach((col, i) => { row[col] = values[i]; });
  return row;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createSession(session) {
  const d = ensureDb();
  d.run(
    `INSERT INTO sessions (id, title, meeting_url, started_at, audio_path, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title       || 'Untitled Meeting',
      session.meeting_url || null,
      session.started_at  || new Date().toISOString(),
      session.audio_path  || null,
      session.status      || 'recording',
    ]
  );
  persist();
  return getSession(session.id);
}

function updateSession(id, updates) {
  const d = ensureDb();
  const allowed = ['title', 'meeting_url', 'started_at', 'ended_at', 'duration_seconds', 'audio_path', 'transcript', 'notes', 'notion_page_url', 'status'];
  const keys = Object.keys(updates).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  d.run(`UPDATE sessions SET ${setClause} WHERE id = ?`, values);
  persist();
}

function getSession(id) {
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

function listSessions({ limit = null, offset = 0 } = {}) {
  const d = ensureDb();
  let stmt;
  if (limit !== null) {
    stmt = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?');
    stmt.bind([limit, offset]);
  } else {
    stmt = d.prepare('SELECT * FROM sessions ORDER BY started_at DESC');
    stmt.bind([]);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(deserializeSession);
}

function deleteSession(id) {
  const d = ensureDb();
  d.run('DELETE FROM sessions WHERE id = ?', [id]);
  persist();
}

function getSessionCount() {
  const d = ensureDb();
  const stmt = d.prepare('SELECT COUNT(*) as count FROM sessions');
  stmt.step();
  const count = stmt.get()[0];
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

function deserializeSession(row) {
  if (!row) return null;
  return {
    ...row,
    transcript: safeJsonParse(row.transcript, []),
    notes:      safeJsonParse(row.notes, null),
  };
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ── Duration calculation ──────────────────────────────────────────────────────

function computeDuration(session) {
  if (!session.started_at || !session.ended_at) return null;
  const start = new Date(session.started_at).getTime();
  const end   = new Date(session.ended_at).getTime();
  return Math.round((end - start) / 1000);
}

module.exports = {
  initialize,
  createSession,
  updateSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionCount,
  getRecentSessions,
  markStaleRecordingSessionsAsError,
  computeDuration,
};
