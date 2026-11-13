import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** A log line as `readLogs()` and the emitter give it (the `log:entry` IPC event). */
interface LogEntry {
  timestamp: string;
  level: string;
  context?: string;
  message: string;
  meta: unknown;
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

let logFilePath: string | null = null;
let logFileDay: string | null = null;
let logEmitter: ((entry: LogEntry) => void) | null = null;

function setLogEmitter(emitter: ((entry: LogEntry) => void) | null | undefined) {
  logEmitter = typeof emitter === 'function' ? emitter : null;
}

function getLogsDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// One file per (UTC) day. The name used to be fixed when the app started, so an app left running
// for days wrote them all into the file named after its launch date.
function getLogFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  if (logFilePath && logFileDay === day) return logFilePath;
  logFileDay = day;
  logFilePath = path.join(getLogsDir(), `meetmind-${day}.log`);
  return logFilePath;
}

// Today's log file and, when there is one, the most recent earlier file: oldest first.
function recentLogFiles() {
  const current = getLogFilePath();
  let previous: string | null | undefined = null;
  try {
    const name = path.basename(current);
    previous = fs.readdirSync(getLogsDir())
      .filter((f) => /^meetmind-\d{4}-\d{2}-\d{2}\.log$/.test(f) && f < name)
      .sort()
      .pop();
  } catch { /* only today's file */ }
  return [previous ? path.join(getLogsDir(), previous) : null, current].filter((file): file is string => !!file);
}

function formatMessage(level: string, message: unknown, data: unknown, ts: string) {
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function write(level: LogLevel, message: unknown, data?: unknown) {
  const ts = new Date().toISOString();
  const line = formatMessage(level, message, data, ts);
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    const colors: Record<LogLevel, string> = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
    const reset = '\x1b[0m';
    console.log(`${colors[level] || ''}${line}${reset}`);
  }

  try {
    fs.appendFileSync(getLogFilePath(), line + '\n');
  } catch {
    // ignore log write failures
  }

  if (logEmitter) {
    try {
      logEmitter({
        timestamp: ts,
        level: level.toUpperCase(),
        message: String(message || ''),
        meta: data || null,
      });
    } catch {}
  }
}

function parseLogLine(line: unknown): LogEntry | null {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Format: [2026-08-15T...] [INFO] message {"data": "..."}
  const match = trimmed.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\](?:\s+\[([^\]]+)\])?\s+(.*?)(?:\s+(\{.*\}|\[.*\]))?$/);
  if (match) {
    let meta: unknown = null;
    if (match[5]) {
      try {
        meta = JSON.parse(match[5]);
      } catch {
        meta = match[5];
      }
    }
    return {
      timestamp: match[1],
      level: match[2].toUpperCase(),
      context: match[3] || undefined,
      message: match[4] || '',
      meta,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message: trimmed,
    meta: null,
  };
}

function readLogs(limit = 1000) {
  try {
    // The previous file is read only when today's is short of `limit` (just after midnight, or
    // after a restart), so the Logs page doesn't go empty at the start of a day.
    let lines: string[] = [];
    for (const filePath of recentLogFiles().reverse()) {
      if (lines.length >= limit || !fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      lines = content.split('\n').map((l) => l.trim()).filter(Boolean).concat(lines);
    }
    return lines.slice(-limit).map(parseLogLine).filter((entry): entry is LogEntry => !!entry);
  } catch {
    return [];
  }
}

function clearLogs() {
  try {
    const filePath = getLogFilePath();
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }
    return true;
  } catch {
    return false;
  }
}

const logger = {
  info:  (msg: unknown, data?: unknown) => write('info',  msg, data),
  warn:  (msg: unknown, data?: unknown) => write('warn',  msg, data),
  error: (msg: unknown, data?: unknown) => write('error', msg, data),
  debug: (msg: unknown, data?: unknown) => write('debug', msg, data),
  readLogs,
  clearLogs,
  getLogsDir,
  getLogFilePath,
  setLogEmitter,
};

export = logger;

