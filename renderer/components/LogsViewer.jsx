import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  RefreshCw,
  Radio,
  Copy,
  Check,
  FolderOpen,
  Trash2,
  Search,
  ScrollText,
  Layers,
  Info,
  AlertTriangle,
  XCircle,
  Bug,
} from 'lucide-react';

function formatLocalTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp.length >= 19 ? isoTimestamp.slice(11, 19) : isoTimestamp;
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function parseLogLine(line) {
  // Line format: [timestamp] [LEVEL] message data
  const match = line.match(/^\[(.*?)\]\s+\[(.*?)\]\s+(.*)$/);
  if (!match) {
    return { timestamp: '', level: 'INFO', message: line, raw: line };
  }
  const [, timestamp, level, rest] = match;
  return {
    timestamp,
    level: level.toUpperCase(),
    message: rest,
    raw: line,
  };
}

const LEVEL_META = {
  ALL: {
    icon: Layers,
    active: 'bg-zinc-700/90 text-white border-zinc-600/60',
    idle: 'bg-zinc-900/50 text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-800/60',
  },
  INFO: {
    icon: Info,
    active: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
    idle: 'bg-zinc-900/50 text-zinc-400 border-transparent hover:text-sky-300 hover:bg-sky-500/10',
    row: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  },
  WARN: {
    icon: AlertTriangle,
    active: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
    idle: 'bg-zinc-900/50 text-zinc-400 border-transparent hover:text-amber-300 hover:bg-amber-500/10',
    row: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  ERROR: {
    icon: XCircle,
    active: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
    idle: 'bg-zinc-900/50 text-zinc-400 border-transparent hover:text-rose-300 hover:bg-rose-500/10',
    row: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  },
  DEBUG: {
    icon: Bug,
    active: 'text-zinc-200 bg-zinc-700/50 border-zinc-600/50',
    idle: 'bg-zinc-900/50 text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-800/60',
    row: 'text-zinc-400 bg-zinc-800/60 border-zinc-700/50',
  },
};

export default function LogsViewer() {
  const [rawLogs, setRawLogs] = useState([]);
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const logsContainerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const fetchLogs = async () => {
    if (!window.meetmind?.logs?.get) return;
    try {
      setLoading(true);
      const lines = await window.meetmind.logs.get({ limit: 1000 });
      setRawLogs(lines || []);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const parsedLogs = useMemo(() => rawLogs.map(parseLogLine), [rawLogs]);

  const filteredLogs = useMemo(() => {
    return parsedLogs.filter((log) => {
      if (filterLevel !== 'ALL' && log.level !== filterLevel) return false;
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        return (
          log.message.toLowerCase().includes(query) ||
          log.timestamp.toLowerCase().includes(query) ||
          log.level.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [parsedLogs, filterLevel, searchTerm]);

  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredLogs]);

  const handleLogsScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  const counts = useMemo(() => {
    const map = { ALL: parsedLogs.length, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    parsedLogs.forEach((l) => {
      if (map[l.level] !== undefined) map[l.level]++;
    });
    return map;
  }, [parsedLogs]);

  const handleCopy = async () => {
    const text = filteredLogs.map((l) => l.raw).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = async () => {
    if (window.confirm('Are you sure you want to clear current logs?')) {
      await window.meetmind?.logs?.clear();
      setRawLogs([]);
    }
  };

  const handleOpenFolder = () => {
    window.meetmind?.logs?.openFolder();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950/40 fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-3 pb-3 border-b border-zinc-800/80 backdrop-blur-md titlebar-drag select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <ScrollText size={16} className="text-emerald-400" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Application Logs</h1>
              <p className="text-zinc-400 text-xs mt-0.5">
                System events, STT & AI process diagnostics ({filteredLogs.length} entries)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 titlebar-no-drag">
            <button
              onClick={fetchLogs}
              className="btn-ghost p-2 text-zinc-400 hover:text-white"
              title="Refresh logs"
            >
              <RefreshCw
                size={15}
                strokeWidth={2}
                className={loading ? 'animate-spin text-emerald-400' : ''}
              />
            </button>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5 ${
                autoRefresh ? 'border-emerald-500/40 text-emerald-400' : 'text-zinc-400'
              }`}
              title="Toggle auto-refresh every 3s"
            >
              <Radio
                size={13}
                strokeWidth={2}
                className={autoRefresh ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}
              />
              Auto-Live
            </button>

            <button
              onClick={handleCopy}
              className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5"
              title="Copy visible log entries to clipboard"
            >
              {copied ? (
                <>
                  <Check size={13} strokeWidth={2.5} className="text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={13} strokeWidth={2} />
                  Copy
                </>
              )}
            </button>

            <button
              onClick={handleOpenFolder}
              className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5"
              title="Open log files directory on computer"
            >
              <FolderOpen size={13} strokeWidth={2} />
              Open Folder
            </button>

            <button
              onClick={handleClear}
              className="btn-ghost text-xs px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 flex items-center gap-1.5"
              title="Clear current log file"
            >
              <Trash2 size={13} strokeWidth={2} />
              Clear
            </button>
          </div>
        </div>

        {/* Filter controls bar */}
        <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-zinc-800/40 titlebar-no-drag">
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'].map((level) => {
              const meta = LEVEL_META[level];
              const Icon = meta.icon;
              const isActive = filterLevel === level;
              return (
                <button
                  key={level}
                  onClick={() => setFilterLevel(level)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-all ${
                    isActive ? `${meta.active} font-semibold` : meta.idle
                  }`}
                >
                  <Icon size={12} strokeWidth={2} />
                  {level}
                  <span className="opacity-60 ml-0.5">({counts[level] || 0})</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-64">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter log entries..."
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-emerald-500/50"
            />
            <Search
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
          </div>
        </div>
      </div>

      {/* Log Console Body */}
      <div className="flex-1 overflow-hidden p-6">
        <div
          ref={logsContainerRef}
          onScroll={handleLogsScroll}
          className="h-full overflow-y-auto bg-zinc-950/90 border border-zinc-800/80 rounded-xl p-4 font-mono text-xs leading-relaxed space-y-0.5 shadow-inner select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-3 py-12">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <ScrollText size={22} strokeWidth={1.5} className="text-zinc-600" />
              </div>
              <p className="text-xs">No log entries found</p>
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const meta = LEVEL_META[log.level] || LEVEL_META.DEBUG;
              const LevelIcon = meta.icon;
              return (
                <div
                  key={i}
                  className="flex items-start gap-2.5 group hover:bg-zinc-900/60 px-2 py-1 rounded-md transition-colors"
                >
                  {log.timestamp && (
                    <span className="text-zinc-600 shrink-0 text-[11px] font-mono tabular-nums w-[4.5rem]">
                      {formatLocalTime(log.timestamp)}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 border ${meta.row || 'text-zinc-400'}`}
                  >
                    <LevelIcon size={10} strokeWidth={2.5} />
                    {log.level}
                  </span>
                  <span className="text-zinc-300 break-all flex-1 pt-px">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
