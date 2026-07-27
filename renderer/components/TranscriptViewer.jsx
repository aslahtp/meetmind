import React, { useState, useMemo } from 'react';

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SPEAKER_STYLES = [
  'text-emerald-400 border-emerald-500/20 bg-emerald-500/10',
  'text-sky-400 border-sky-500/20 bg-sky-500/10',
  'text-amber-400 border-amber-500/20 bg-amber-500/10',
  'text-purple-400 border-purple-500/20 bg-purple-500/10',
  'text-rose-400 border-rose-500/20 bg-rose-500/10',
  'text-teal-400 border-teal-500/20 bg-teal-500/10',
];

function getSpeakerStyle(speaker) {
  let hash = 0;
  for (let i = 0; i < (speaker || '').length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SPEAKER_STYLES[Math.abs(hash) % SPEAKER_STYLES.length];
}

function HighlightedText({ text, query }) {
  if (!query) return <span>{text}</span>;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber-400/30 text-amber-200 border border-amber-400/40 rounded px-1">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export default function TranscriptViewer({ transcript }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => {
    if (!Array.isArray(transcript)) return [];
    if (!searchQuery) return transcript;
    return transcript.filter((seg) =>
      seg.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seg.speaker?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [transcript, searchQuery]);

  const copyAll = async () => {
    const text = transcript
      .map((seg) => `[${formatTime(seg.startTime)}] ${seg.speaker || 'Speaker'}: ${seg.text}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!transcript?.length) {
    return (
      <div className="py-12 text-center text-zinc-500 text-sm">
        No transcript entries found for this session.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Search + copy bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search transcript text or speakers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9 text-xs h-9"
          />
        </div>
        <button
          onClick={copyAll}
          className="btn-outline text-xs px-3.5 py-2 h-9"
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy Full Transcript
            </>
          )}
        </button>
      </div>

      {searchQuery && (
        <p className="text-zinc-400 text-xs px-1">
          Showing {segments.length} matching segment{segments.length !== 1 ? 's' : ''} for "{searchQuery}"
        </p>
      )}

      {/* Transcript segments */}
      <div className="space-y-2.5">
        {segments.map((seg, i) => {
          const speakerStyle = getSpeakerStyle(seg.speaker);
          return (
            <div key={i} className="flex gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/80 transition-all group">
              <span className="text-zinc-500 text-xs font-mono mt-0.5 flex-shrink-0 w-12 text-right">
                {formatTime(seg.startTime)}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border mb-1 ${speakerStyle}`}>
                  {seg.speaker || 'Speaker'}
                </span>
                <p className="text-zinc-200 text-sm leading-relaxed">
                  <HighlightedText text={seg.text || ''} query={searchQuery} />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
