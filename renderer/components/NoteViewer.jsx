import React, { useState, useRef, useMemo } from 'react';
import {
  Volume2,
  ChevronLeft,
  Copy,
  Check,
  FileText,
  Mic,
  ListChecks,
  MicOff,
  Loader2,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  Sparkles,
  MessageCircle,
  Zap,
  Flame,
  ArrowUp,
  Minus,
  ArrowDown,
  CalendarDays,
  Clock,
  Timer,
  Users,
  User,
  Play,
  Pause,
  AlertTriangle,
} from 'lucide-react';
import TranscriptViewer from './TranscriptViewer.jsx';
import NotionIcon from './NotionIcon.jsx';

const PRIORITY_STYLES = {
  high:   {
    cls: 'badge-red',
    label: 'High',
    Icon: ArrowUp,
    ring: 'hover:border-rose-500/30',
  },
  medium: {
    cls: 'badge-yellow',
    label: 'Medium',
    Icon: Minus,
    ring: 'hover:border-amber-500/30',
  },
  low:    {
    cls: 'badge-green',
    label: 'Low',
    Icon: ArrowDown,
    ring: 'hover:border-emerald-500/30',
  },
};

const SENTIMENT_STYLES = {
  positive: { cls: 'badge-green',  label: 'Positive', Icon: Sparkles },
  neutral:  { cls: 'badge-gray',   label: 'Neutral',  Icon: MessageCircle },
  mixed:    { cls: 'badge-yellow', label: 'Mixed',    Icon: Zap },
  tense:    { cls: 'badge-red',    label: 'Tense',    Icon: Flame },
};

const TABS = [
  { id: 'summary', label: 'Summary', Icon: FileText },
  { id: 'transcript', label: 'Transcript', Icon: Mic },
  { id: 'audio', label: 'Audio', Icon: Volume2 },
];

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatStartTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDurationSeconds(secs) {
  if (secs == null || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SectionLabel({ icon: Icon, colorClass, children, count }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${colorClass}`}>
        <Icon size={14} strokeWidth={2} />
      </div>
      <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">{children}</h2>
      {count != null && (
        <span className="text-[11px] font-medium text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  );
}

function ActionItemsList({ items }) {
  const [checked, setChecked] = useState(() => ({}));

  const toggle = (idx) => {
    setChecked((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const doneCount = items.reduce((n, _, idx) => n + (checked[idx] ? 1 : 0), 0);

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center">
        <ListChecks size={22} strokeWidth={1.75} className="mx-auto mb-2 text-zinc-600" />
        <p className="text-zinc-500 text-sm">No action items were identified in this meeting.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel
          icon={ListChecks}
          colorClass="bg-amber-500/10 border-amber-500/25 text-amber-400"
        >
          Action Items
        </SectionLabel>
        <span className="text-[11px] font-medium text-zinc-500 tabular-nums mb-4 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800">
          {doneCount}/{items.length} done
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const priorityStyle = PRIORITY_STYLES[item.priority] || null;
          const PriorityIcon = priorityStyle?.Icon;
          const isDone = !!checked[idx];

          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => toggle(idx)}
                className={`w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl border border-zinc-800/70 bg-zinc-900/25 transition-all ${
                  priorityStyle?.ring || 'hover:border-zinc-700/80'
                } ${isDone ? 'opacity-55' : 'hover:bg-zinc-900/45'}`}
              >
                <span
                  className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500 text-zinc-950'
                      : 'border-zinc-600 bg-zinc-950/60 text-transparent'
                  }`}
                  aria-hidden
                >
                  <Check size={12} strokeWidth={3} />
                </span>

                <div className="flex-1 min-w-0 space-y-2">
                  <p className={`text-sm font-medium leading-snug ${
                    isDone ? 'text-zinc-500 line-through' : 'text-zinc-100'
                  }`}>
                    {item.task}
                  </p>

                  {(item.owner || item.due || priorityStyle) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {item.owner && (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <span className="w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                            <User size={10} strokeWidth={2} />
                          </span>
                          {item.owner}
                        </span>
                      )}
                      {item.due && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                          <CalendarDays size={11} strokeWidth={2} />
                          {item.due}
                        </span>
                      )}
                      {priorityStyle && (
                        <span className={priorityStyle.cls}>
                          <PriorityIcon size={11} strokeWidth={2.5} />
                          {priorityStyle.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayerCard({ sessionId, title, durationLabel }) {
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openMessage, setOpenMessage] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioSrc = sessionId ? `meetmind-audio://session/${sessionId}` : '';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const changeSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  const togglePlay = async () => {
    if (!audioRef.current || error) return;
    try {
      if (audioRef.current.paused) await audioRef.current.play();
      else audioRef.current.pause();
    } catch {
      setError('Unable to start playback. Try opening the recording file instead.');
    }
  };

  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  const openRecordingFile = async () => {
    if (!sessionId || opening) return;
    setOpening(true);
    setOpenMessage(null);
    try {
      const result = await window.meetmind.sessions.openRecording(sessionId);
      if (!result?.success) {
        setOpenMessage(result?.error || 'Recording file not found for this session.');
      }
    } catch (err) {
      setOpenMessage(err.message || 'Failed to open recording file.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 shadow-2xl shadow-black/40">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative px-8 pt-10 pb-8 space-y-8">
          <div className="text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shadow-inner">
              <Volume2 size={28} strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white tracking-tight truncate px-4">
                {title || 'Session Audio'}
              </h3>
              <p className="text-zinc-500 text-xs mt-1">
                {durationLabel ? `${durationLabel} recording` : 'Session recording'}
                {sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}
              </p>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm leading-relaxed flex gap-3">
              <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!ready}
                  className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? (
                    <Pause size={22} strokeWidth={2.5} fill="currentColor" />
                  ) : (
                    <Play size={22} strokeWidth={2.5} fill="currentColor" className="ml-0.5" />
                  )}
                </button>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={seek}
                  className="group relative w-full h-2 rounded-full bg-zinc-800 overflow-hidden cursor-pointer"
                  aria-label="Seek"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-[width] duration-75"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `calc(${progress}% - 7px)` }}
                  />
                </button>
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                  <span>{formatPlayerTime(currentTime)}</span>
                  <span>{formatPlayerTime(duration)}</span>
                </div>
              </div>

              <audio
                ref={audioRef}
                key={sessionId}
                className="hidden"
                src={audioSrc}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
                onLoadedMetadata={() => {
                  setReady(true);
                  setError(null);
                  setDuration(audioRef.current?.duration || 0);
                  if (audioRef.current) audioRef.current.playbackRate = speed;
                }}
                onCanPlay={() => setReady(true)}
                onEnded={() => setPlaying(false)}
                onError={() => {
                  setReady(false);
                  setPlaying(false);
                  setError('Audio file could not be loaded. The recording may be missing or still converting.');
                }}
              />

              {!ready && (
                <p className="text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
                  <Loader2 size={12} className="spinner" />
                  Loading audio…
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={changeSpeed}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-emerald-400 font-semibold hover:bg-zinc-800 hover:border-zinc-700 transition-colors"
              title="Playback speed"
            >
              {speed}x
            </button>
            <button
              onClick={openRecordingFile}
              disabled={opening}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
              title="Show recording file in Explorer"
            >
              {opening ? (
                <Loader2 size={13} strokeWidth={2} className="spinner" />
              ) : (
                <FolderOpen size={13} strokeWidth={2} />
              )}
              Open File
            </button>
          </div>

          {openMessage && (
            <p className="text-center text-rose-400 text-xs">{openMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary content ──────────────────────────────────────────────────────────

function SummaryContent({ notes, session, noSpeech, isError, processingError }) {
  if (!notes) {
    return (
      <div className="flex items-center justify-center min-h-[420px]">
        <div className="text-center max-w-md w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-10 shadow-2xl">
          {noSpeech ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5 text-amber-400">
                <MicOff size={28} strokeWidth={2} />
              </div>
              <h2 className="font-semibold text-lg text-white mb-2">No speech detected</h2>
              {processingError && (
                <p className="text-amber-300/90 text-xs font-mono bg-zinc-950/80 rounded-xl p-3 mb-4 text-left leading-relaxed border border-amber-500/20">
                  {processingError}
                </p>
              )}
              <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                The recording was saved but contained no audible speech.
              </p>
              <button
                onClick={() => window.meetmind.processing.retry(session.id, 'all')}
                className="btn-primary text-xs"
              >
                Retry Processing
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5 text-emerald-400">
                <Sparkles size={26} strokeWidth={2} />
              </div>
              <h2 className="font-semibold text-lg text-white mb-2">
                {isError ? 'Processing failed' : 'Notes not ready yet'}
              </h2>
              <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                {isError
                  ? 'Something went wrong while generating notes for this session.'
                  : 'Generate an AI summary, action items, and key topics from the transcript.'}
              </p>
              <button
                onClick={() => window.meetmind.processing.run(session.id)}
                className="btn-primary px-6 py-2.5 text-xs"
              >
                Generate Notes
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const actionItems = notes.action_items || [];
  const keyPoints = (notes.key_points || []).filter((p) => p?.heading || p?.summary);

  return (
    <div className="max-w-3xl mx-auto space-y-10 fade-in">
      {notes.summary && (
        <section>
          <SectionLabel
            icon={Sparkles}
            colorClass="bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
          >
            Executive Summary
          </SectionLabel>
          <p className="text-zinc-200 text-[15px] leading-7">{notes.summary}</p>
        </section>
      )}

      <section>
        <ActionItemsList items={actionItems} />
      </section>

      {keyPoints.length > 0 && (
        <section>
          <SectionLabel
            icon={FileText}
            colorClass="bg-sky-500/10 border-sky-500/25 text-sky-400"
            count={keyPoints.length}
          >
            Key Topics
          </SectionLabel>

          <div className="space-y-7">
            {keyPoints.map((point, idx) => {
              const lines = (point.summary || '')
                .split(/\r?\n+/)
                .map((l) => l.trim())
                .filter(Boolean);
              return (
                <article key={idx}>
                  <div className="flex items-baseline gap-2.5 mb-2.5 pl-3">
                    <span className="text-[11px] font-bold text-zinc-500 tabular-nums">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-semibold text-[15px] text-zinc-100 leading-snug">
                      {point.heading || 'Topic'}
                    </h3>
                  </div>
                  {lines.length > 0 && (
                    <ul className="space-y-2 pl-8">
                      {lines.map((line, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-zinc-300 leading-relaxed">
                          <span className="mt-2 w-1 h-1 rounded-full bg-zinc-600 flex-shrink-0" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Main NoteViewer ──────────────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const notes = session.notes;
  const rawTranscript = session.transcript;

  const normalizedTranscript = useMemo(() => {
    if (!rawTranscript) return [];
    if (Array.isArray(rawTranscript)) return rawTranscript;
    if (typeof rawTranscript === 'string') {
      try {
        const parsed = JSON.parse(rawTranscript);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        if (rawTranscript.trim()) {
          return [{ speaker: 'Speaker 1', text: rawTranscript.trim(), startTime: 0 }];
        }
      }
    }
    return [];
  }, [rawTranscript]);

  const sentiment = notes?.sentiment;
  const sentimentStyle = SENTIMENT_STYLES[sentiment] || null;
  const duration = formatDurationSeconds(session.duration_seconds);
  const startTime = formatStartTime(session.started_at);
  const SentimentIcon = sentimentStyle?.Icon;
  const isError = session.status === 'error';
  const noSpeech = isError && !normalizedTranscript.length;
  const processingError = session._processingError || null;
  const notionUrl = uploadResult || session.notion_page_url;

  const handleRegenerate = async () => {
    setRegenerating(true);
    setUploadError(null);
    try {
      const result = await window.meetmind.processing.retry(session.id, 'notes');
      if (result?.success) onRefresh?.();
      else if (result?.error) setUploadError(result.error);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleUploadToNotion = async () => {
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await window.meetmind.notion.upload(session.id);
      if (result.success) {
        setUploadResult(result.url);
        onRefresh?.();
      } else {
        setUploadError(result.error || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const copyMarkdownSummary = async () => {
    if (!notes) return;
    let md = `# ${notes.title || session.title || 'Meeting Summary'}\n\n`;
    if (notes.summary) md += `## Overview\n${notes.summary}\n\n`;
    if (notes.action_items?.length) {
      md += `## Action Items\n`;
      notes.action_items.forEach((item) => {
        md += `- [ ] ${item.task}${item.owner ? ` (@${item.owner})` : ''}${item.due ? ` (Due: ${item.due})` : ''}\n`;
      });
      md += `\n`;
    }
    if (notes.key_points?.length) {
      md += `## Key Points\n`;
      notes.key_points.forEach((kp) => {
        md += `### ${kp.heading}\n${kp.summary}\n\n`;
      });
    }
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950/40 fade-in">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-zinc-800/80 bg-zinc-950/50 backdrop-blur-md titlebar-drag select-none">
        <div className="px-6 pt-3 pb-4 space-y-4">
          <div className="flex items-start gap-3 titlebar-no-drag">
            <button
              onClick={onBack}
              className="btn-ghost p-2 mt-0.5 text-zinc-400 hover:text-white rounded-xl"
              title="Back to sessions"
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>

            <div className="flex-1 min-w-0 space-y-2.5">
              <h1 className="font-bold text-xl text-white truncate tracking-tight leading-tight">
                {notes?.title || session.title || 'Meeting Notes'}
              </h1>

              <div className="flex items-center flex-wrap gap-1.5">
                {session.started_at && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-900/80 border border-zinc-800 px-2 py-1 rounded-lg">
                    <CalendarDays size={11} strokeWidth={2} />
                    {formatDate(session.started_at)}
                  </span>
                )}
                {startTime && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-900/80 border border-zinc-800 px-2 py-1 rounded-lg">
                    <Clock size={11} strokeWidth={2} />
                    {startTime}
                  </span>
                )}
                {duration && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 px-2 py-1 rounded-lg">
                    <Timer size={11} strokeWidth={2} />
                    {duration}
                  </span>
                )}
                {notes?.attendees?.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-900/80 border border-zinc-800 px-2 py-1 rounded-lg max-w-[280px]">
                    <Users size={11} strokeWidth={2} className="flex-shrink-0" />
                    <span className="truncate">
                      {notes.attendees.slice(0, 3).join(', ')}
                      {notes.attendees.length > 3 ? ` +${notes.attendees.length - 3}` : ''}
                    </span>
                  </span>
                )}
                {sentimentStyle && (
                  <span className={sentimentStyle.cls}>
                    <SentimentIcon size={12} strokeWidth={2} />
                    {sentimentStyle.label}
                  </span>
                )}
              </div>
            </div>

            {notes && (
              <button
                onClick={copyMarkdownSummary}
                className="btn-outline text-xs px-3 py-2 flex-shrink-0"
                title="Copy formatted Markdown notes"
              >
                {copied ? (
                  <>
                    <Check size={13} strokeWidth={2.5} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} strokeWidth={2} />
                    Copy
                  </>
                )}
              </button>
            )}
          </div>

          {/* Segmented tabs */}
          <div className="titlebar-no-drag inline-flex p-1 rounded-xl bg-zinc-900/80 border border-zinc-800/80">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              const count = id === 'transcript' && normalizedTranscript.length > 0
                ? normalizedTranscript.length
                : null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-400 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <Icon size={14} strokeWidth={2} />
                  {label}
                  {count != null && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <div
        className={`flex-1 overflow-y-auto px-6 pb-28 ${
          activeTab === 'transcript' ? 'pt-0 scrollbar-wide' : 'pt-6'
        }`}
      >
        {activeTab === 'summary' && (
          <SummaryContent
            notes={notes}
            session={session}
            noSpeech={noSpeech}
            isError={isError}
            processingError={processingError}
          />
        )}
        {activeTab === 'transcript' && (
          <TranscriptViewer transcript={normalizedTranscript} />
        )}
        {activeTab === 'audio' && (
          <AudioPlayerCard
            sessionId={session.id}
            title={notes?.title || session.title}
            durationLabel={duration}
          />
        )}
      </div>

      {/* Footer actions */}
      <footer className="flex-shrink-0 px-6 py-3.5 border-t border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {notionUrl ? (
              <a
                href={notionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium hover:text-emerald-300 transition-colors truncate max-w-full"
                onClick={(e) => { e.preventDefault(); window.open?.(notionUrl, '_blank'); }}
              >
                <NotionIcon size={12} />
                {uploadResult ? 'Synced to Notion' : 'View in Notion'}
                <ExternalLink size={11} strokeWidth={2} />
              </a>
            ) : (
              <span className="text-zinc-600 text-xs">Not synced to Notion yet</span>
            )}
            {uploadError && (
              <p className="text-rose-400 text-xs mt-1 truncate">{uploadError}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRegenerate}
              disabled={regenerating || uploading}
              className="btn-ghost text-xs text-zinc-400 hover:text-white disabled:opacity-50"
              title="Regenerate notes from transcript"
            >
              {regenerating ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="spinner" />
                  Regenerating…
                </>
              ) : (
                <>
                  <RefreshCw size={13} strokeWidth={2} />
                  Regenerate
                </>
              )}
            </button>

            <button
              onClick={handleUploadToNotion}
              disabled={uploading}
              className={`${notionUrl ? 'btn-ghost' : 'btn-outline'} text-xs disabled:opacity-50`}
              title={notionUrl ? 'Re-upload to Notion' : 'Upload notes to Notion'}
            >
              {uploading ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="spinner" />
                  Syncing…
                </>
              ) : (
                <>
                  <NotionIcon size={12} />
                  {notionUrl ? 'Re-sync' : 'Sync to Notion'}
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
