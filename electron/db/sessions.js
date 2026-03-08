const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');

let db = null;

function getDbPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'meetmind.db');
}

function initialize() {
  const Database = require('better-sqlite3');
  const dbPath = getDbPath();

  logger.info('Initializing SQLite database', { dbPath });

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);

  logger.info('Database initialized');
  return db;
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized. Call initialize() first.');
  return db;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createSession(session) {
  const d = ensureDb();
  const stmt = d.prepare(`
    INSERT INTO sessions (id, title, meeting_url, started_at, audio_path, status)
    VALUES (@id, @title, @meeting_url, @started_at, @audio_path, @status)
  `);
  stmt.run({
    id:          session.id,
    title:       session.title       || 'Untitled Meeting',
    meeting_url: session.meeting_url || null,
    started_at:  session.started_at  || new Date().toISOString(),
    audio_path:  session.audio_path  || null,
    status:      session.status      || 'recording',
  });
  return getSession(session.id);
}

function updateSession(id, updates) {
  const d = ensureDb();
  const fields = Object.keys(updates)
    .filter((k) => k !== 'id')
    .map((k) => `${k} = @${k}`)
    .join(', ');

  if (!fields) return;

  const stmt = d.prepare(`UPDATE sessions SET ${fields} WHERE id = @id`);
  stmt.run({ ...updates, id });
}

function getSession(id) {
  const d = ensureDb();
  const row = d.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? deserializeSession(row) : null;
}

function listSessions({ limit = 50, offset = 0 } = {}) {
  const d = ensureDb();
  const rows = d
    .prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return rows.map(deserializeSession);
}

function deleteSession(id) {
  const d = ensureDb();
  d.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function getSessionCount() {
  const d = ensureDb();
  return d.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
}

function getRecentSessions(limit = 5) {
  return listSessions({ limit });
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
  computeDuration,
};
