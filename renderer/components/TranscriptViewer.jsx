import React, { useState, useMemo } from 'react';
import { Search, Check, Copy, Mic, X, ScrollText } from 'lucide-react';

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SPEAKER_COLORS = [
  { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', dot: 'bg-emerald-400' },
  { text: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/25', dot: 'bg-sky-400' },
  { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/25', dot: 'bg-amber-400' },
  { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/25', dot: 'bg-violet-400' },
  { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/25', dot: 'bg-rose-400' },
  { text: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/25', dot: 'bg-teal-400' },
];

function getSpeakerColor(speaker) {
  let hash = 0;
  for (let i = 0; i < (speaker || '').length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length];
}

function HighlightedText({ text, query }) {
  if (!query) return <span>{text}</span>;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber-400/25 text-amber-100 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export default function TranscriptViewer({ transcript }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState(null);
  const [copied, setCopied] = useState(false);

  const speakers = useMemo(() => {
    if (!Array.isArray(transcript)) return [];
    const seen = new Set();
    const list = [];
    for (const seg of transcript) {
      const name = seg.speaker || 'Speaker';
      if (!seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
    }
    return list;
  }, [transcript]);

  const segments = useMemo(() => {
    if (!Array.isArray(transcript)) return [];
    return transcript.filter((seg) => {
      const speaker = seg.speaker || 'Speaker';
      if (speakerFilter && speaker !== speakerFilter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return seg.text?.toLowerCase().includes(q) || speaker.toLowerCase().includes(q);
    });
  }, [transcript, searchQuery, speakerFilter]);

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
      <div className="flex items-center justify-center min-h-[360px]">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-zinc-500">
            <ScrollText size={26} strokeWidth={1.75} />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">No transcript yet</h3>
          <p className="text-zinc-500 text-sm leading-relaxed">
            Transcript entries will appear here after speech-to-text finishes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Toolbar — flush sticky under header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-2.5 mb-4 bg-zinc-950 border-b border-zinc-800/70">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search
                size={14}
                strokeWidth={2}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search transcript or speakers…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-8 pr-8 text-xs h-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                  aria-label="Clear search"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </div>
            <button onClick={copyAll} className="btn-outline text-xs px-2.5 h-8 flex-shrink-0">
              {copied ? (
                <>
                  <Check size={12} strokeWidth={2.5} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={12} strokeWidth={2} />
                  Copy All
                </>
              )}
            </button>
          </div>

          {speakers.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setSpeakerFilter(null)}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                  !speakerFilter
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                All
              </button>
              {speakers.map((speaker) => {
                const color = getSpeakerColor(speaker);
                const active = speakerFilter === speaker;
                return (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() => setSpeakerFilter(active ? null : speaker)}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                      active
                        ? `${color.bg} ${color.text} ${color.border}`
                        : 'bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.dot}`} />
                    <span className="truncate max-w-[140px]">{speaker}</span>
                  </button>
                );
              })}
            </div>
          )}

          {(searchQuery || speakerFilter) && (
            <p className="text-zinc-500 text-[11px] px-0.5">
              Showing {segments.length} of {transcript.length} segment{transcript.length !== 1 ? 's' : ''}
              {speakerFilter ? ` · ${speakerFilter}` : ''}
              {searchQuery ? ` · “${searchQuery}”` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="max-w-3xl mx-auto pb-2">
      {segments.length === 0 ? (
        <div className="py-16 text-center">
          <Mic size={22} strokeWidth={1.75} className="mx-auto mb-3 text-zinc-600" />
          <p className="text-zinc-500 text-sm">No segments match your filters.</p>
          <button
            type="button"
            onClick={() => { setSearchQuery(''); setSpeakerFilter(null); }}
            className="mt-3 text-xs text-emerald-400 hover:text-emerald-300 font-medium"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="relative space-y-0">
          <div className="absolute left-[19px] top-3 bottom-3 w-px bg-zinc-800/80 pointer-events-none" />
          {segments.map((seg, i) => {
            const speaker = seg.speaker || 'Speaker';
            const color = getSpeakerColor(speaker);
            return (
              <div key={i} className="relative flex gap-4 py-3 pl-1 group">
                <div className="relative z-10 flex-shrink-0 w-10 flex flex-col items-center pt-0.5">
                  <span className={`w-2.5 h-2.5 rounded-full ring-4 ring-zinc-950 ${color.dot}`} />
                  <span className="mt-2 text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400 transition-colors">
                    {formatTime(seg.startTime)}
                  </span>
                </div>
                <div className="flex-1 min-w-0 rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3 group-hover:border-zinc-700/70 group-hover:bg-zinc-900/50 transition-all">
                  <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border mb-2 ${color.text} ${color.bg} ${color.border}`}>
                    {speaker}
                  </span>
                  <p className="text-zinc-200 text-sm leading-relaxed">
                    <HighlightedText text={seg.text || ''} query={searchQuery} />
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
