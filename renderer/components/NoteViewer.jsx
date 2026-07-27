import React, { useState, useRef } from 'react';
import TranscriptViewer from './TranscriptViewer.jsx';
import NotionIcon from './NotionIcon.jsx';

const PRIORITY_STYLES = {
  high:   { cls: 'badge-red',    label: '🔴 High' },
  medium: { cls: 'badge-yellow', label: '🟡 Medium' },
  low:    { cls: 'badge-green',  label: '🟢 Low' },
};

const SENTIMENT_STYLES = {
  positive: { cls: 'badge-green',  label: '✨ Positive' },
  neutral:  { cls: 'badge-gray',   label: '💬 Neutral' },
  mixed:    { cls: 'badge-yellow', label: '⚡ Mixed' },
  tense:    { cls: 'badge-red',    label: '🔥 Tense' },
};

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDurationSeconds(secs) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

// ── Audio Player Component ───────────────────────────────────────────────────

function AudioPlayerCard({ sessionId, title }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const changeSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  return (
    <div className="card p-6 bg-zinc-900/80 border-zinc-800 shadow-2xl backdrop-blur-md max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-sm text-zinc-100">{title || 'Session Audio'}</h3>
            <p className="text-zinc-500 text-xs font-mono">ID: {sessionId?.slice(0, 8)}</p>
          </div>
        </div>
        <button
          onClick={changeSpeed}
          className="px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs font-mono text-emerald-400 font-semibold hover:bg-zinc-700 transition-colors"
        >
          {speed}x
        </button>
      </div>

      <audio
        ref={audioRef}
        key={sessionId}
        controls
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className="w-full h-10 accent-emerald-500 rounded-lg"
        src={`meetmind-audio://${sessionId}`}
        preload="metadata"
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

// ── Main NoteViewer Component ────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'transcript' | 'audio'
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const notes = session.notes;
  const transcript = session.transcript;

  const sentiment = notes?.sentiment;
  const sentimentStyle = SENTIMENT_STYLES[sentiment] || null;
  const duration = formatDurationSeconds(session.duration_seconds);

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

  if (!notes) {
    const isError = session.status === 'error';
    const noSpeech = isError && !transcript?.length;
    const processingError = session._processingError || null;

    return (
      <div className="h-full flex flex-col bg-zinc-950/40 fade-in">
        {/* Back header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-zinc-800 flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-1.5 text-zinc-400 hover:text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="font-bold text-lg text-white flex-1 truncate">{session.title || 'Meeting'}</h1>
        </div>

        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center max-w-md card p-8 bg-zinc-900/90 border-zinc-800 shadow-2xl">
            {noSpeech ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-400">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </div>
                <h2 className="font-bold text-lg text-white mb-2">No speech detected</h2>
                {processingError && (
                  <p className="text-amber-400/90 text-xs font-mono bg-zinc-950 rounded-lg p-3 mb-4 text-left leading-relaxed border border-amber-500/20">
                    {processingError}
                  </p>
                )}
                <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                  The recording was saved but contained no audible speech.
                </p>
                <div className="text-left bg-zinc-950 border border-zinc-800 rounded-xl p-4 mb-6 text-xs text-zinc-400 space-y-2">
                  <p className="font-semibold text-zinc-200">How to ensure audio capture:</p>
                  <p>1. In MeetMind <strong className="text-white">Settings → Audio</strong>, run device probes.</p>
                  <p>2. Select your microphone or active speaker loopback device.</p>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => window.meetmind.processing.retry(session.id, 'all')}
                    className="btn-primary text-xs"
                  >
                    Retry Processing
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-zinc-400 mb-5">{isError ? 'Processing failed for this session.' : 'Notes not yet generated for this session.'}</p>
                <button
                  onClick={() => window.meetmind.processing.run(session.id)}
                  className="btn-primary px-6 py-2.5"
                >
                  Generate Notes
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950/40 fade-in">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/80 backdrop-blur-md">
        <div className="flex items-center gap-3 mb-2.5">
          <button onClick={onBack} className="btn-ghost p-1.5 text-zinc-400 hover:text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="font-bold text-xl text-white flex-1 truncate tracking-tight">
            {notes.title || session.title || 'Meeting Notes'}
          </h1>
          <button
            onClick={copyMarkdownSummary}
            className="btn-outline text-xs px-3 py-1.5"
            title="Copy formatted Markdown notes"
          >
            {copied ? '✓ Copied' : '📋 Copy Notes'}
          </button>
        </div>

        <div className="flex items-center flex-wrap gap-2 text-xs text-zinc-400">
          {session.started_at && (
            <span>{formatDate(session.started_at)}</span>
          )}
          {duration && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="font-mono bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-300">
                {duration}
              </span>
            </>
          )}
          {notes.attendees?.length > 0 && (
            <>
              <span className="text-zinc-600">·</span>
              <div className="flex flex-wrap gap-1">
                {notes.attendees.slice(0, 5).map((a, i) => (
                  <span key={i} className="badge-gray text-[11px]">{a}</span>
                ))}
                {notes.attendees.length > 5 && (
                  <span className="badge-gray text-[11px]">+{notes.attendees.length - 5}</span>
                )}
              </div>
            </>
          )}
          {sentimentStyle && (
            <span className={sentimentStyle.cls}>{sentimentStyle.label}</span>
          )}
        </div>

        {/* Tabs: Summary | Transcript | Audio */}
        <div className="flex gap-2 mt-4 border-t border-zinc-800/60 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'summary'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            AI Summary & Action Items
          </button>

          {transcript?.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('transcript')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'transcript'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              </svg>
              Transcript ({transcript.length})
            </button>
          )}

          {session.audio_path && (
            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'audio'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              Audio Playback
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 pb-24">
        {activeTab === 'summary' && (
          <div className="space-y-7 max-w-4xl">
            {/* Overview / Executive Summary */}
            {notes.summary && (
              <div className="card p-5 bg-zinc-900/50 border-zinc-800/80">
                <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">Executive Summary</h2>
                <p className="text-zinc-200 text-sm leading-relaxed">{notes.summary}</p>
              </div>
            )}

            {/* Action Items & Next Steps */}
            <div className="card p-5 bg-zinc-900/50 border-zinc-800/80">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3.5 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Action Items & Next Steps
              </h2>
              {notes.action_items?.length ? (
                <ul className="space-y-2.5">
                  {notes.action_items.map((item, idx) => {
                    const priorityStyle = PRIORITY_STYLES[item.priority] || { cls: 'badge-gray', label: item.priority };
                    return (
                      <li key={idx} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 group hover:border-zinc-700/60 transition-colors">
                        <div className="flex items-start gap-3 min-w-0">
                          <input type="checkbox" className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500 cursor-pointer" />
                          <div>
                            <span className="text-sm font-medium text-zinc-100 block">{item.task}</span>
                            {item.owner && (
                              <span className="text-xs text-zinc-400 mt-0.5 block">Owner: <strong className="text-zinc-200">{item.owner}</strong></span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {item.due && (
                            <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                              Due {item.due}
                            </span>
                          )}
                          {item.priority && (
                            <span className={priorityStyle.cls}>{priorityStyle.label}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-zinc-500 text-sm italic">No action items identified.</p>
              )}
            </div>

            {/* Key Points */}
            {notes.key_points?.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">Key Discussion Topics</h2>
                {notes.key_points.map((point, idx) => {
                  if (!point?.heading && !point?.summary) return null;
                  const lines = (point.summary || '')
                    .split(/\r?\n+/)
                    .map((l) => l.trim())
                    .filter(Boolean);
                  return (
                    <div key={idx} className="card p-5 bg-zinc-900/40 border-zinc-800/80 hover:border-zinc-700/80 transition-all">
                      <h3 className="font-semibold text-base text-zinc-100 mb-2">{point.heading || 'Topic'}</h3>
                      {lines.length > 0 && (
                        <ul className="space-y-2 text-sm text-zinc-300">
                          {lines.map((line, i) => (
                            <li key={i} className="flex gap-2.5 leading-relaxed">
                              <span className="text-emerald-400 flex-shrink-0 mt-1">•</span>
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'transcript' && transcript?.length > 0 && (
          <TranscriptViewer transcript={transcript} />
        )}

        {activeTab === 'audio' && session.audio_path && (
          <AudioPlayerCard sessionId={session.id} title={notes.title || session.title} />
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          {session.notion_page_url && !uploadResult && (
            <a
              href={session.notion_page_url}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 text-xs font-medium hover:underline flex items-center gap-1.5 truncate"
              onClick={(e) => { e.preventDefault(); window.open?.(session.notion_page_url, '_blank'); }}
            >
              <NotionIcon size={12} />
              View in Notion ↗
            </a>
          )}
          {uploadResult && (
            <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
              <NotionIcon size={12} />
              Synced to Notion
            </span>
          )}
          {uploadError && (
            <span className="text-rose-400 text-xs">{uploadError}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRegenerate}
            disabled={regenerating || uploading}
            className="btn-ghost text-xs text-zinc-400 hover:text-white disabled:opacity-50"
            title="Regenerate notes from transcript with current model"
          >
            {regenerating ? (
              <>
                <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Regenerating…
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Regenerate Notes
              </>
            )}
          </button>

          {!uploadResult && !session.notion_page_url && (
            <button
              onClick={handleUploadToNotion}
              disabled={uploading}
              className="btn-outline text-xs disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Syncing…
                </>
              ) : (
                <>
                  <NotionIcon size={12} />
                  Sync to Notion
                </>
              )}
            </button>
          )}

          {(uploadResult || session.notion_page_url) && (
            <button
              onClick={handleUploadToNotion}
              disabled={uploading}
              className="btn-ghost text-xs text-zinc-400 hover:text-white disabled:opacity-50"
              title="Re-upload to Notion"
            >
              <NotionIcon size={12} className="mr-1" />
              Re-sync Notion
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
