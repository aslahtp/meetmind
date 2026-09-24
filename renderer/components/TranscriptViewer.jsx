import React, { useState, useMemo } from 'react';
import { Search, Check, Copy, Mic, X, ScrollText } from 'lucide-react';
import { AvatarTile, EmptyState } from './ui/index.jsx';
import { initials } from '../lib/format.js';

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return '';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function HighlightedText({ text, query }) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

export default function TranscriptViewer({ transcript }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState(null);
  const [copied, setCopied] = useState(false);

  // Stable keys: position in the full transcript never changes while filtering.
  const indexed = useMemo(() => {
    if (!Array.isArray(transcript)) return [];
    return transcript.map((seg, idx) => ({
      ...seg,
      _speaker: seg.speaker || 'Speaker',
      _key: `${seg.speaker || 'Speaker'}-${seg.startTime ?? ''}-${idx}`,
    }));
  }, [transcript]);

  const speakers = useMemo(() => [...new Set(indexed.map((seg) => seg._speaker))], [indexed]);

  const segments = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return indexed.filter((seg) => {
      if (speakerFilter && seg._speaker !== speakerFilter) return false;
      if (!q) return true;
      return seg.text?.toLowerCase().includes(q) || seg._speaker.toLowerCase().includes(q);
    });
  }, [indexed, searchQuery, speakerFilter]);

  const copyAll = async () => {
    const text = indexed
      .map((seg) => `[${formatTime(seg.startTime)}] ${seg._speaker}: ${seg.text}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSpeakerFilter(null);
  };

  if (!indexed.length) {
    return (
      <div className="pt-32">
        <EmptyState
          compact
          icon={<ScrollText size={24} strokeWidth={1.75} />}
          title="No transcript yet"
          message="Transcript entries will appear here after speech-to-text finishes."
        />
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Toolbar — sticks to the top of the scrolling body */}
      <div className="sticky top-0 z-10 bg-paper pt-24 pb-16 border-b border-ink space-y-16">
        <div className="flex items-center gap-8">
          <div className="relative flex-1 min-w-0">
            <Search
              size={16}
              strokeWidth={1.75}
              className="absolute left-16 top-1/2 -translate-y-1/2 text-graphite pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search transcript"
              placeholder="Search transcript or speakers…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-48 pr-48"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 icon-btn"
                aria-label="Clear search"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            )}
          </div>
          <button type="button" onClick={copyAll} className="btn-ghost btn-sm flex-shrink-0">
            {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
            {copied ? 'Copied' : 'Copy all'}
          </button>
        </div>

        {speakers.length > 1 && (
          <div role="group" aria-label="Filter by speaker" className="flex items-center gap-8 flex-wrap">
            <button
              type="button"
              aria-pressed={!speakerFilter}
              onClick={() => setSpeakerFilter(null)}
              className={!speakerFilter ? 'chip-dark' : 'pill'}
            >
              All
            </button>
            {speakers.map((speaker) => {
              const active = speakerFilter === speaker;
              return (
                <button
                  key={speaker}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSpeakerFilter(active ? null : speaker)}
                  className={active ? 'chip-dark' : 'pill'}
                >
                  <span className="truncate max-w-[160px]">{speaker}</span>
                  {active && <X size={14} strokeWidth={2} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        {(searchQuery || speakerFilter) && (
          <p className="text-caption text-graphite" aria-live="polite">
            Showing {segments.length} of {indexed.length} segment{indexed.length !== 1 ? 's' : ''}
            {speakerFilter ? ` · ${speakerFilter}` : ''}
            {searchQuery ? ` · “${searchQuery}”` : ''}
          </p>
        )}
      </div>

      {segments.length === 0 ? (
        <div className="py-64 text-center">
          <Mic size={24} strokeWidth={1.75} className="mx-auto mb-16 text-graphite" />
          <p className="text-body-sm text-graphite">No segments match your filters.</p>
          <button type="button" onClick={clearFilters} className="btn-quiet btn-sm mt-8 underline underline-offset-4">
            Clear filters
          </button>
        </div>
      ) : (
        <ol className="divide-y divide-graphite/40">
          {segments.map((seg) => (
            <li key={seg._key} className="flex gap-16 py-24">
              <AvatarTile size={32} className="text-caption">{initials(seg._speaker)}</AvatarTile>
              <div className="flex-1 min-w-0">
                <p className="flex items-baseline gap-8 flex-wrap">
                  <span className="text-body-sm font-medium text-ink">
                    <HighlightedText text={seg._speaker} query={searchQuery} />
                  </span>
                  <span className="text-caption text-graphite tabular">{formatTime(seg.startTime)}</span>
                </p>
                <p className="text-body-sm text-graphite mt-4">
                  <HighlightedText text={seg.text || ''} query={searchQuery} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
