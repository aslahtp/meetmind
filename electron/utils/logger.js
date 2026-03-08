const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFilePath = null;

function getLogFilePath() {
  if (logFilePath) return logFilePath;
  const logsDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  logFilePath = path.join(logsDir, `meetmind-${new Date().toISOString().slice(0, 10)}.log`);
  return logFilePath;
}

function formatMessage(level, message, data) {
  const ts = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function write(level, message, data) {
  const line = formatMessage(level, message, data);
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
}

const logger = {
  info:  (msg, data) => write('info',  msg, data),
  warn:  (msg, data) => write('warn',  msg, data),
  error: (msg, data) => write('error', msg, data),
  debug: (msg, data) => write('debug', msg, data),
};

module.exports = logger;
