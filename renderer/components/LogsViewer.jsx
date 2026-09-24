import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Check,
  Search,
  RefreshCw,
  FolderOpen,
  Radio,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../app.jsx';
import { IconButton, Switch, SegmentedControl, Skeleton } from './ui/index.jsx';

const MAX_LOGS = 2000;
const NEAR_BOTTOM_PX = 48;
const FALLBACK_POLL_MS = 3000;
const HIDE_EXT_KEY = 'meetmind:hide-extension-logs';

const LEVELS = [
  { value: 'ALL',   label: 'All' },
  { value: 'INFO',  label: 'Info' },
  { value: 'WARN',  label: 'Warn' },
  { value: 'ERROR', label: 'Error' },
  { value: 'DEBUG', label: 'Debug' },
];

function LevelTag({ level }) {
  const base = 'inline-block flex-shrink-0 w-[64px] text-caption font-medium uppercase';
  const style = { letterSpacing: 'var(--tracking-badge)' };
  if (level === 'WARN') {
    return (
      <span className={base} style={style}>
        <span className="bg-sunshine text-on-sunshine rounded-input px-4">WARN</span>
      </span>
    );
  }
  const color = level === 'ERROR' ? 'text-signal' : level === 'DEBUG' ? 'text-graphite' : 'text-ink';
  return <span className={`${base} ${color}`} style={style}>{level}</span>;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const time = d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
}

function isExtensionLog(entry) {
  if (!entry) return false;
  const ctx = (entry.context || '').toLowerCase();
  if (ctx.includes('extension') || ctx.includes('websocket')) return true;
  const msg = (entry.message || '').toLowerCase();
  if (
    msg.includes('extension') ||
    msg.includes('websocket') ||
    msg.includes('app_status') ||
    msg.includes('get_status')
  ) {
    return true;
  }
  if (entry.meta) {
    const metaStr = typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta);
    if (
      metaStr.includes('chrome-extension://') ||
      metaStr.includes('APP_STATUS') ||
      metaStr.includes('GET_STATUS') ||
      metaStr.includes('extension')
    ) {
      return true;
    }
  }
  return false;
}

function normalizeEntry(item) {
  if (typeof item !== 'string') return item;
  const match = item.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\](?:\s+\[([^\]]+)\])?\s+(.*?)(?:\s+(\{.*\}|\[.*\]))?$/);
  if (match) {
    let meta = null;
    try { if (match[5]) meta = JSON.parse(match[5]); } catch { meta = match[5]; }
    return {
      timestamp: match[1],
      level: match[2].toUpperCase(),
      context: match[3],
      message: match[4],
      meta,
    };
  }
  return { timestamp: new Date().toISOString(), level: 'INFO', message: item };
}

function formatLine(l) {
  return `[${l.timestamp}] [${l.level}] ${l.context ? `[${l.context}] ` : ''}${l.message}${l.meta ? ' ' + JSON.stringify(l.meta) : ''}`;
}

const capped = (list) => (list.length > MAX_LOGS ? list.slice(-MAX_LOGS) : list);

export default function LogsViewer() {
  const { confirm, addToast } = useApp();
  const bridge = typeof window !== 'undefined' ? window.meetmind : null;
  const hasLogsApi = !!bridge?.logs;
  const hasPush = !!bridge?.on;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(hasLogsApi);
  const [loadError, setLoadError] = useState(null);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [pausedCount, setPausedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hideExtensionLogs, setHideExtensionLogs] = useState(() => {
    try {
      return localStorage.getItem(HIDE_EXT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  const [openingLogDir, setOpeningLogDir] = useState(false);

  const isLiveRef = useRef(true);
  const pausedBufferRef = useRef([]);
  const logContainerRef = useRef(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    isLiveRef.current = isLive;
    // Resuming flushes whatever arrived while paused.
    if (isLive && pausedBufferRef.current.length) {
      const buffered = pausedBufferRef.current;
      pausedBufferRef.current = [];
      setLogs((prev) => capped([...prev, ...buffered]));
    }
    setPausedCount(0);
  }, [isLive]);

  const loadLogs = useCallback(async () => {
    if (!window.meetmind?.logs) return;
    try {
      const raw = window.meetmind.logs.getHistory
        ? await window.meetmind.logs.getHistory()
        : await window.meetmind.logs.get();
      if (Array.isArray(raw)) {
        setLogs(capped(raw.map(normalizeEntry)));
      }
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load logs history:', err);
      setLoadError(err?.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial history + live push. The history is fetched once; after that, pushed
  // `log:entry` events append. A full re-fetch poll only runs when push is
  // unavailable — polling alongside push used to overwrite the live entries.
  useEffect(() => {
    loadLogs();

    if (!window.meetmind?.on) return undefined;
    const unsub = window.meetmind.on('log:entry', (entry) => {
      if (!entry) return;
      const normalized = normalizeEntry(entry);
      if (!isLiveRef.current) {
        pausedBufferRef.current = capped([...pausedBufferRef.current, normalized]);
        setPausedCount(pausedBufferRef.current.length);
        return;
      }
      setLogs((prev) => capped([...prev, normalized]));
    });
    return () => unsub?.();
  }, [loadLogs]);

  useEffect(() => {
    if (hasPush || !isLive || !hasLogsApi) return undefined;
    const intervalId = setInterval(loadLogs, FALLBACK_POLL_MS);
    return () => clearInterval(intervalId);
  }, [hasPush, isLive, hasLogsApi, loadLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      pausedBufferRef.current = [];
      setPausedCount(0);
      await loadLogs();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  const counts = useMemo(() => {
    const c = { ALL: 0, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    for (const l of logs) {
      if (hideExtensionLogs && isExtensionLog(l)) continue;
      c.ALL++;
      const lvl = (l.level || 'INFO').toUpperCase();
      if (c[lvl] !== undefined) c[lvl]++;
    }
    return c;
  }, [logs, hideExtensionLogs]);

  const filteredLogs = useMemo(() => {
    const s = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (hideExtensionLogs && isExtensionLog(entry)) return false;
      const entryLevel = (entry.level || 'INFO').toUpperCase();
      if (levelFilter !== 'ALL' && entryLevel !== levelFilter) return false;
      if (s) {
        const msg = (entry.message || '').toLowerCase();
        const ctx = (entry.context || '').toLowerCase();
        const meta = entry.meta ? JSON.stringify(entry.meta).toLowerCase() : '';
        if (!msg.includes(s) && !ctx.includes(s) && !meta.includes(s)) return false;
      }
      return true;
    });
  }, [logs, levelFilter, search, hideExtensionLogs]);

  // Follow the tail only while the reader is already at (or near) the bottom.
  useEffect(() => {
    const el = logContainerRef.current;
    if (autoScroll && el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filteredLogs.map(formatLine).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      addToast?.(`Couldn't copy logs: ${err.message}`, 'error');
    }
  };

  const handleExport = () => {
    const text = logs.map(formatLine).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meetmind-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: 'Clear all logs?',
      message: 'This empties the log buffer and the log file. Export first if you need to keep them.',
      confirmLabel: 'Clear logs',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (window.meetmind?.logs?.clear) {
        await window.meetmind.logs.clear();
      }
      pausedBufferRef.current = [];
      setPausedCount(0);
      setLogs([]);
    } catch (err) {
      addToast?.(`Couldn't clear logs: ${err.message}`, 'error');
    }
  };

  const handleOpenLogFolder = async () => {
    if (!window.meetmind?.logs?.openFolder) return;
    setOpeningLogDir(true);
    try {
      await window.meetmind.logs.openFolder();
    } finally {
      setOpeningLogDir(false);
    }
  };

  const toggleHideExtension = (value) => {
    setHideExtensionLogs(value);
    try {
      localStorage.setItem(HIDE_EXT_KEY, value ? 'true' : 'false');
    } catch { /* storage unavailable — keep in-memory preference */ }
  };

  const levelOptions = LEVELS.map((l) => ({ ...l, count: counts[l.value] || 0 }));

  let body;
  if (!hasLogsApi) {
    body = (
      <div className="flex items-center justify-center h-full text-caption text-graphite">
        Logs are only available in the desktop app.
      </div>
    );
  } else if (loading) {
    body = (
      <div className="flex flex-col gap-8" aria-label="Loading logs">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className={`h-16 ${i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-full' : 'w-1/2'}`} />
        ))}
      </div>
    );
  } else if (loadError && logs.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center gap-16 h-full text-center">
        <p className="flex items-center gap-8 text-caption text-signal">
          <AlertCircle size={16} strokeWidth={1.75} />
          Couldn't load logs: {loadError}
        </p>
        <button type="button" className="btn-ghost btn-sm" onClick={handleRefresh}>Try again</button>
      </div>
    );
  } else if (filteredLogs.length === 0) {
    body = (
      <div className="flex items-center justify-center h-full text-caption text-graphite">
        {logs.length === 0 ? 'No logs recorded yet.' : 'No logs match your filters.'}
      </div>
    );
  } else {
    body = filteredLogs.map((entry, idx) => {
      const lvl = (entry.level || 'INFO').toUpperCase();
      return (
        <div
          key={`${entry.timestamp}-${idx}`}
          className="flex items-start gap-16 px-8 py-4 rounded-input hover:bg-ink/[0.04]"
        >
          <span className="tabular text-graphite flex-shrink-0 select-none">
            {formatTimestamp(entry.timestamp)}
          </span>
          <LevelTag level={lvl} />
          {entry.context && (
            <span className="text-graphite flex-shrink-0">[{entry.context}]</span>
          )}
          <span className="text-ink break-all flex-1">
            {entry.message}
            {entry.meta && (
              <span className="ml-8 text-graphite">
                {typeof entry.meta === 'object' ? JSON.stringify(entry.meta) : String(entry.meta)}
              </span>
            )}
          </span>
        </div>
      );
    });
  }

  return (
    <div className="h-full flex flex-col overflow-hidden fade-in">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-ink">
        <div className="mx-auto w-full max-w-[1200px] px-32 pt-32 pb-24">
          <div className="flex flex-wrap items-end justify-between gap-16">
            <div className="min-w-0">
              <h1 className="text-heading font-medium text-ink">Logs</h1>
              <p className="text-body-sm text-graphite mt-8">
                Diagnostic events from recording, transcription, note generation and Notion sync.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-8">
              <IconButton
                label={isLive ? 'Pause live updates' : 'Resume live updates'}
                pressed={isLive}
                onClick={() => setIsLive((prev) => !prev)}
              >
                <Radio size={16} strokeWidth={1.75} />
              </IconButton>
              <IconButton label="Reload logs" onClick={handleRefresh} disabled={refreshing || !hasLogsApi}>
                <RefreshCw size={16} strokeWidth={1.75} className={refreshing ? 'spinner' : ''} />
              </IconButton>
              <IconButton label="Open logs folder" onClick={handleOpenLogFolder} disabled={openingLogDir || !hasLogsApi}>
                <FolderOpen size={16} strokeWidth={1.75} />
              </IconButton>
              <button type="button" className="btn-ghost btn-sm" onClick={handleCopy} disabled={filteredLogs.length === 0}>
                {copied && <Check size={14} strokeWidth={2} />}
                {copied ? 'Copied' : 'Copy visible'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={handleExport} disabled={logs.length === 0}>
                Export all
              </button>
              <button type="button" className="btn-danger btn-sm" onClick={handleClear} disabled={!hasLogsApi}>
                Clear
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-16 mt-24">
            <SegmentedControl
              label="Filter by level"
              role="radiogroup"
              size="sm"
              options={levelOptions}
              value={levelFilter}
              onChange={setLevelFilter}
            />

            <div className="flex flex-wrap items-center gap-24">
              <div className="relative w-[240px]">
                <Search
                  size={16}
                  strokeWidth={1.75}
                  className="absolute left-8 top-1/2 -translate-y-1/2 text-graphite pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter logs…"
                  aria-label="Filter logs by text"
                  className="input pl-32"
                />
              </div>

              <label className="flex items-center gap-8 text-caption text-ink cursor-pointer select-none">
                <Switch checked={hideExtensionLogs} onChange={toggleHideExtension} label="Hide extension logs" />
                Hide extension logs
              </label>

              <label className="flex items-center gap-8 text-caption text-ink cursor-pointer select-none">
                <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll" />
                Auto-scroll
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Log panel */}
      <div className="flex-1 min-h-0 mx-auto w-full max-w-[1200px] px-32 py-24 flex flex-col gap-8">
        {!isLive && (
          <p className="flex items-center gap-8 text-caption text-graphite" role="status">
            <span className="dot dot-graphite" aria-hidden="true" />
            Paused{pausedCount > 0 ? ` · ${pausedCount} new ${pausedCount === 1 ? 'entry' : 'entries'} waiting` : ''}
            <button type="button" className="font-medium text-ink underline underline-offset-4" onClick={() => setIsLive(true)}>
              Resume
            </button>
          </p>
        )}
        {loadError && logs.length > 0 && (
          <p className="flex items-center gap-8 text-caption text-signal" role="alert">
            <AlertCircle size={14} strokeWidth={1.75} />
            Couldn't refresh logs: {loadError}
          </p>
        )}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="tile flex-1 min-h-0 overflow-y-auto p-16 font-mono text-caption select-text"
          role="log"
          aria-live="off"
        >
          {body}
        </div>
      </div>
    </div>
  );
}
