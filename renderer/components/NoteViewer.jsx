import React, { useState } from 'react';
import TranscriptViewer from './TranscriptViewer.jsx';

const PRIORITY_STYLES = {
  high:   { cls: 'badge-red',    label: '🔴 High'   },
  medium: { cls: 'badge-yellow', label: '🟡 Medium' },
  low:    { cls: 'badge-green',  label: '🟢 Low'    },
};

const SENTIMENT_STYLES = {
  positive: { cls: 'badge-green',  label: '😊 Positive' },
  neutral:  { cls: 'badge-gray',   label: '😐 Neutral'  },
  mixed:    { cls: 'badge-yellow', label: '🤔 Mixed'    },
  tense:    { cls: 'badge-red',    label: '😬 Tense'    },
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

// ── Sub-components ────────────────────────────────────────────────────────────

function ActionItemsTable({ items }) {
  if (!items?.length) {
    return <p className="text-[#555] text-sm italic">No action items identified.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#2a2a2a]">
            <th className="text-left text-[#666] text-xs font-medium pb-2 px-1">Task</th>
            <th className="text-left text-[#666] text-xs font-medium pb-2 px-1">Owner</th>
            <th className="text-left text-[#666] text-xs font-medium pb-2 px-1">Due</th>
            <th className="text-left text-[#666] text-xs font-medium pb-2 px-1">Priority</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2a2a2a]">
          {items.map((item, i) => {
            const p = PRIORITY_STYLES[item.priority] || { cls: 'badge-gray', label: item.priority };
            return (
              <tr key={i} className="group hover:bg-[#252525] transition-colors">
                <td className="py-2.5 px-1 text-white max-w-xs">
                  <span className="line-clamp-2">{item.task}</span>
                </td>
                <td className="py-2.5 px-1 text-[#a0a0a0] whitespace-nowrap">{item.owner || '—'}</td>
                <td className="py-2.5 px-1 text-[#a0a0a0] whitespace-nowrap text-xs">{item.due || '—'}</td>
                <td className="py-2.5 px-1">
                  <span className={p.cls}>{p.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KeyPointsAccordion({ points }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (!points?.length) {
    return <p className="text-[#555] text-sm italic">No key points recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {points.map((point, i) => (
        <div key={i} className="border border-[#2a2a2a] rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#252525] transition-colors"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
          >
            <span className="font-medium text-sm">{point.heading}</span>
            <svg
              className={`w-4 h-4 text-[#666] transition-transform ${openIndex === i ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {openIndex === i && (
            <div className="px-4 pb-4 pt-1 text-[#a0a0a0] text-sm leading-relaxed border-t border-[#2a2a2a]">
              {point.summary}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BulletList({ items, empty }) {
  if (!items?.length) {
    return <p className="text-[#555] text-sm italic">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-[#c0c0c0]">
          <span className="text-[#555] mt-1.5 flex-shrink-0">•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-base">{title}</h2>
      {children}
    </div>
  );
}

// ── Main NoteViewer ───────────────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const notes = session.notes;
  const transcript = session.transcript;

  const sentiment = notes?.sentiment;
  const sentimentStyle = SENTIMENT_STYLES[sentiment] || null;
  const duration = formatDurationSeconds(session.duration_seconds);

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

  if (!notes) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#666] mb-4">Notes not yet generated for this session.</p>
          <button
            onClick={() => window.meetmind.processing.run(session.id)}
            className="btn-primary"
          >
            Generate Notes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="btn-ghost p-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 className="font-semibold text-lg flex-1 truncate">
            {notes.title || session.title || 'Meeting Notes'}
          </h1>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {session.started_at && (
            <span className="text-[#666] text-sm">{formatDate(session.started_at)}</span>
          )}
          {duration && (
            <>
              <span className="text-[#444]">·</span>
              <span className="text-[#666] text-sm">{duration}</span>
            </>
          )}
          {notes.attendees?.length > 0 && (
            <>
              <span className="text-[#444]">·</span>
              <div className="flex flex-wrap gap-1">
                {notes.attendees.slice(0, 5).map((a, i) => (
                  <span key={i} className="badge-gray text-xs">{a}</span>
                ))}
                {notes.attendees.length > 5 && (
                  <span className="badge-gray text-xs">+{notes.attendees.length - 5}</span>
                )}
              </div>
            </>
          )}
          {sentimentStyle && (
            <span className={sentimentStyle.cls}>{sentimentStyle.label}</span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">

        {/* Action Items */}
        <Section title="✅ Action Items">
          <ActionItemsTable items={notes.action_items} />
        </Section>

        {/* Key Points */}
        <Section title="📌 Key Points">
          <KeyPointsAccordion points={notes.key_points} />
        </Section>

        {/* Decisions */}
        <Section title="🔑 Decisions">
          <BulletList items={notes.decisions} empty="No decisions recorded." />
        </Section>

        {/* Open Questions */}
        <Section title="❓ Open Questions">
          <BulletList items={notes.questions_unresolved} empty="No open questions." />
        </Section>

        {/* Next Meeting */}
        {notes.next_meeting && (
          <Section title="📅 Next Meeting">
            <p className="text-[#a0a0a0] text-sm">{notes.next_meeting}</p>
          </Section>
        )}

        {/* Transcript toggle */}
        {transcript?.length > 0 && (
          <div className="border-t border-[#2a2a2a] pt-6">
            <button
              className="flex items-center gap-2 text-sm text-[#888] hover:text-white transition-colors mb-4"
              onClick={() => setShowTranscript((v) => !v)}
            >
              <svg
                className={`w-4 h-4 transition-transform ${showTranscript ? 'rotate-90' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              {showTranscript ? 'Hide Transcript' : 'View Transcript'}
              <span className="text-[#555]">({transcript.length} segments)</span>
            </button>
            {showTranscript && <TranscriptViewer transcript={transcript} />}
          </div>
        )}
      </div>

      {/* Footer — Notion upload */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-[#2a2a2a] flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {session.notion_page_url && !uploadResult && (
            <a
              href={session.notion_page_url}
              target="_blank"
              rel="noreferrer"
              className="text-green-500 text-xs hover:underline flex items-center gap-1 truncate"
              onClick={(e) => { e.preventDefault(); /* open via shell in prod */ }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4V4z"/></svg>
              View in Notion ↗
            </a>
          )}
          {uploadResult && (
            <span className="text-green-500 text-xs flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Uploaded to Notion
            </span>
          )}
          {uploadError && (
            <span className="text-red-400 text-xs">{uploadError}</span>
          )}
        </div>

        {!uploadResult && !session.notion_page_url && (
          <button
            onClick={handleUploadToNotion}
            disabled={uploading}
            className="btn-outline text-xs disabled:opacity-50"
          >
            {uploading ? (
              <>
                <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Uploading…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4V4z"/></svg>
                Upload to Notion
              </>
            )}
          </button>
        )}

        {(uploadResult || session.notion_page_url) && (
          <button
            onClick={handleUploadToNotion}
            disabled={uploading}
            className="btn-ghost text-xs disabled:opacity-50"
            title="Re-upload"
          >
            Re-upload
          </button>
        )}
      </div>
    </div>
  );
}
