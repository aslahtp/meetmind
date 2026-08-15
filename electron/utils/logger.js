const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFilePath = null;
let logEmitter = null;

function setLogEmitter(emitter) {
  logEmitter = typeof emitter === 'function' ? emitter : null;
}

function getLogsDir() {
  const dir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLogFilePath() {
  if (logFilePath) return logFilePath;
  const logsDir = getLogsDir();
  logFilePath = path.join(logsDir, `meetmind-${new Date().toISOString().slice(0, 10)}.log`);
  return logFilePath;
}

function formatMessage(level, message, data, ts) {
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function write(level, message, data) {
  const ts = new Date().toISOString();
  const line = formatMessage(level, message, data, ts);
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
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

function parseLogLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Format: [2026-08-15T...] [INFO] message {"data": "..."}
  const match = trimmed.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\](?:\s+\[([^\]]+)\])?\s+(.*?)(?:\s+(\{.*\}|\[.*\]))?$/);
  if (match) {
    let meta = null;
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
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.slice(-limit).map(parseLogLine).filter(Boolean);
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
  info:  (msg, data) => write('info',  msg, data),
  warn:  (msg, data) => write('warn',  msg, data),
  error: (msg, data) => write('error', msg, data),
  debug: (msg, data) => write('debug', msg, data),
  readLogs,
  clearLogs,
  getLogsDir,
  getLogFilePath,
  setLogEmitter,
};

module.exports = logger;

