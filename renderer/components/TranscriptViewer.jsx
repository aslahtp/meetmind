import React, { useState, useMemo } from 'react';

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SPEAKER_COLORS = [
  'text-blue-400',
  'text-purple-400',
  'text-yellow-400',
  'text-pink-400',
  'text-cyan-400',
  'text-orange-400',
];

function getSpeakerColor(speaker) {
  // Consistent color per speaker name
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
          <mark key={i} className="bg-yellow-500 text-black rounded px-0.5">{part}</mark>
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
      .map((seg) => `[${formatTime(seg.startTime)}] ${seg.speaker}: ${seg.text}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!transcript?.length) {
    return (
      <div className="py-8 text-center text-[#555] text-sm">
        No transcript available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search + copy bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555] w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search transcript…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-8 text-xs h-8"
          />
        </div>
        <button
          onClick={copyAll}
          className="btn-outline text-xs px-3 py-1.5 h-8"
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
              Copy
            </>
          )}
        </button>
      </div>

      {searchQuery && (
        <p className="text-[#666] text-xs">
          {segments.length} result{segments.length !== 1 ? 's' : ''} for "{searchQuery}"
        </p>
      )}

      {/* Transcript segments */}
      <div className="space-y-2 pr-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex gap-3 group">
            <span className="text-[#555] text-xs font-mono mt-0.5 flex-shrink-0 w-10 text-right">
              {formatTime(seg.startTime)}
            </span>
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-semibold ${getSpeakerColor(seg.speaker)} mr-1.5`}>
                {seg.speaker || 'Speaker'}:
              </span>
              <span className="text-[#c0c0c0] text-sm">
                <HighlightedText text={seg.text || ''} query={searchQuery} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
