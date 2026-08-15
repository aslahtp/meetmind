import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Terminal,
  Trash2,
  Copy,
  Check,
  Search,
  Filter,
  Download,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  RefreshCw,
  FolderOpen,
  Radio,
} from 'lucide-react';

const LEVEL_META = {
  ALL: {
    label: 'All',
    color: 'text-slate-700 dark:text-zinc-300',
    activeClass: 'bg-slate-200 dark:bg-zinc-700/90 text-slate-900 dark:text-white border-slate-300 dark:border-zinc-600/60',
    idleClass: 'bg-white dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-transparent hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/60',
  },
  INFO: {
    label: 'Info',
    icon: Info,
    color: 'text-sky-600 dark:text-sky-400',
    activeClass: 'bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-500/40 font-semibold',
    idleClass: 'bg-white dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-transparent hover:text-sky-600 dark:hover:text-sky-300 hover:bg-sky-500/10',
    badge: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/20',
  },
  WARN: {
    label: 'Warn',
    icon: AlertTriangle,
    color: 'text-amber-600 dark:text-amber-400',
    activeClass: 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40 font-semibold',
    idleClass: 'bg-white dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-transparent hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-500/10',
    badge: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  ERROR: {
    label: 'Error',
    icon: XCircle,
    color: 'text-rose-600 dark:text-rose-400',
    activeClass: 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/40 font-semibold',
    idleClass: 'bg-white dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-transparent hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/10',
    badge: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
  },
  DEBUG: {
    label: 'Debug',
    icon: Terminal,
    color: 'text-slate-500 dark:text-zinc-500',
    activeClass: 'text-slate-800 dark:text-zinc-200 bg-slate-200 dark:bg-zinc-700/50 border-slate-300 dark:border-zinc-600/50',
    idleClass: 'bg-white dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-transparent hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/60',
    badge: 'text-slate-600 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700/50',
  },
};

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
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

export default function LogsViewer() {
  const [logs, setLogs] = useState([]);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isLiveRef = useRef(true);
  const [hideExtensionLogs, setHideExtensionLogs] = useState(() => {
    try {
      return localStorage.getItem('meetmind:hide-extension-logs') === 'true';
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  const [openingLogDir, setOpeningLogDir] = useState(false);
  const logContainerRef = useRef(null);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  const loadLogs = useCallback(async () => {
    if (!window.meetmind?.logs) return;
    try {
      const raw = window.meetmind.logs.getHistory
        ? await window.meetmind.logs.getHistory()
        : await window.meetmind.logs.get();
      if (Array.isArray(raw)) {
        const normalized = raw.map((item) => {
          if (typeof item === 'string') {
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
          return item;
        });
        setLogs(normalized);
      }
    } catch (err) {
      console.error('Failed to load logs history:', err);
    }
  }, []);

  useEffect(() => {
    loadLogs();

    let unsub = null;
    if (window.meetmind?.on) {
      unsub = window.meetmind.on('log:entry', (entry) => {
        if (!entry) return;
        if (!isLiveRef.current) return;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      });
    }

    let intervalId = null;
    if (isLive) {
      intervalId = setInterval(() => {
        loadLogs();
      }, 3000);
    }

    return () => {
      unsub?.();
      if (intervalId) clearInterval(intervalId);
    };
  }, [loadLogs, isLive]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadLogs();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

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

  const handleCopy = async () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.context ? `[${l.context}] ` : ''}${l.message}${l.meta ? ' ' + JSON.stringify(l.meta) : ''}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.context ? `[${l.context}] ` : ''}${l.message}${l.meta ? ' ' + JSON.stringify(l.meta) : ''}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meetmind-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (window.meetmind?.logs?.clear) {
      await window.meetmind.logs.clear();
    }
    setLogs([]);
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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40 fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-3 pb-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-100/50 dark:bg-transparent backdrop-blur-md titlebar-drag select-none">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Application Logs</h1>
            <p className="text-slate-500 dark:text-zinc-400 text-xs mt-0.5">
              Live diagnostic events, STT status, notes generation, and Notion sync logs
            </p>
          </div>

          <div className="flex items-center gap-1.5 titlebar-no-drag">
            {/* Live Mode toggle */}
            <button
              type="button"
              onClick={() => setIsLive((prev) => !prev)}
              className={`p-2 rounded-lg border transition-all flex items-center justify-center ${
                isLive
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/10'
                  : 'bg-white dark:bg-zinc-900/60 border-slate-200 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300'
              }`}
              title={isLive ? 'Live Streaming: Active (Click to pause)' : 'Live Streaming: Paused (Click to resume)'}
            >
              <Radio size={14} className={isLive ? 'animate-pulse' : ''} strokeWidth={2.2} />
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm dark:shadow-none flex items-center justify-center disabled:opacity-50"
              title="Refresh Logs"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-emerald-500' : ''} strokeWidth={2} />
            </button>

            {/* Open Folder */}
            <button
              type="button"
              onClick={handleOpenLogFolder}
              disabled={openingLogDir}
              className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm dark:shadow-none flex items-center justify-center disabled:opacity-50"
              title="Open Logs Folder"
            >
              <FolderOpen size={14} strokeWidth={2} />
            </button>

            {/* Export */}
            <button
              type="button"
              onClick={handleExport}
              className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm dark:shadow-none flex items-center justify-center"
              title="Export Logs (.log)"
            >
              <Download size={14} strokeWidth={2} />
            </button>

            {/* Copy */}
            <button
              type="button"
              onClick={handleCopy}
              className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm dark:shadow-none flex items-center justify-center"
              title={copied ? 'Copied to clipboard' : 'Copy Filtered Logs'}
            >
              {copied ? (
                <Check size={14} className="text-emerald-500" strokeWidth={2.5} />
              ) : (
                <Copy size={14} strokeWidth={2} />
              )}
            </button>

            {/* Clear */}
            <button
              type="button"
              onClick={handleClear}
              className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-300 dark:hover:border-rose-800 transition-all shadow-sm dark:shadow-none flex items-center justify-center"
              title="Clear Log Buffer"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Toolbar: Level Filter + Search */}
        <div className="flex items-center justify-between gap-2.5 pt-2.5 border-t border-slate-200 dark:border-zinc-800/40 titlebar-no-drag overflow-x-auto no-scrollbar flex-nowrap">
          <div className="flex items-center gap-1 shrink-0 flex-nowrap">
            {Object.keys(LEVEL_META).map((key) => {
              const meta = LEVEL_META[key];
              const active = levelFilter === key;
              const count = counts[key] || 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLevelFilter(key)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border whitespace-nowrap shrink-0 transition-all ${
                    active ? meta.activeClass : meta.idleClass
                  }`}
                >
                  <span>{meta.label}</span>
                  {count > 0 && (
                    <span className="text-[10px] opacity-75 font-semibold">({count})</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-nowrap">
            <div className="relative w-36 sm:w-44">
              <Search
                size={12}
                strokeWidth={2}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter logs…"
                className="w-full bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 rounded-lg pl-6 pr-2 py-0.5 text-xs text-slate-800 dark:text-zinc-200 placeholder-slate-400 dark:placeholder-zinc-500 outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20"
              />
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={hideExtensionLogs}
                onChange={(e) => {
                  setHideExtensionLogs(e.target.checked);
                  try {
                    localStorage.setItem('meetmind:hide-extension-logs', e.target.checked ? 'true' : 'false');
                  } catch {}
                }}
                className="rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-emerald-500 focus:ring-0"
              />
              Hide Extension Logs
            </label>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-emerald-500 focus:ring-0"
              />
              Auto-scroll
            </label>
          </div>
        </div>
      </div>

      {/* Log Console Body */}
      <div className="flex-1 p-6 overflow-hidden">
        <div
          ref={logContainerRef}
          className="h-full overflow-y-auto bg-white dark:bg-zinc-950/90 border border-slate-200 dark:border-zinc-800/80 rounded-xl p-4 font-mono text-xs text-slate-800 dark:text-zinc-300 space-y-1 select-text scrollbar-wide shadow-inner"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400 dark:text-zinc-600 text-xs">
              {logs.length === 0 ? 'No logs recorded yet.' : 'No logs match your filter criteria.'}
            </div>
          ) : (
            filteredLogs.map((entry, idx) => {
              const lvl = (entry.level || 'INFO').toUpperCase();
              const meta = LEVEL_META[lvl] || LEVEL_META.INFO;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 py-0.5 leading-relaxed hover:bg-slate-100 dark:hover:bg-zinc-900/60 px-2 rounded -mx-2 transition-colors"
                >
                  <span className="text-[11px] text-slate-400 dark:text-zinc-600 flex-shrink-0 select-none">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded border flex-shrink-0 ${
                      meta.badge || 'text-slate-600 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700'
                    }`}
                  >
                    {lvl}
                  </span>
                  {entry.context && (
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-semibold flex-shrink-0">
                      [{entry.context}]
                    </span>
                  )}
                  <span className="text-slate-800 dark:text-zinc-300 break-all flex-1">
                    {entry.message}
                    {entry.meta && (
                      <span className="ml-2 text-slate-500 dark:text-zinc-400 text-[11px]">
                        {typeof entry.meta === 'object'
                          ? JSON.stringify(entry.meta)
                          : String(entry.meta)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
