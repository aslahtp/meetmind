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
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'notes' | 'transcript' | 'audio'
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

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

  if (!notes) {
    const isError = session.status === 'error';
    const noSpeech = isError && !transcript?.length;
    const processingError = session._processingError || null;

    return (
      <div className="h-full flex flex-col">
        {/* Back header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-[#2a2a2a] flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <h1 className="font-semibold text-lg flex-1 truncate">{session.title || 'Meeting'}</h1>
        </div>

        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center max-w-md">
            {noSpeech ? (
              <>
                <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>
                  </svg>
                </div>
                <h2 className="font-semibold text-base mb-2">No speech detected</h2>
                {processingError && (
                  <p className="text-yellow-400/80 text-xs font-mono bg-[#1a1a1a] rounded px-3 py-2 mb-3 text-left leading-relaxed">
                    {processingError}
                  </p>
                )}
                <p className="text-[#888] text-sm leading-relaxed mb-2">
                  The recording was saved but contained only silence.
                </p>
                <div className="text-left bg-[#1a1a1a] border border-[#333] rounded-lg p-4 mb-5 text-xs text-[#a0a0a0] space-y-1.5">
                  <p className="font-medium text-[#ccc]">How to fix:</p>
                  <p>1. Open <strong className="text-white">Windows Sound → Recording</strong> and enable <strong className="text-white">Stereo Mix</strong> (right-click → Enable if hidden).</p>
                  <p>2. In MeetMind <strong className="text-white">Settings → Audio</strong>, click <strong className="text-white">Detect Devices</strong> and select Stereo Mix as the system device.</p>
                  <p>3. Make sure no other app has <em>exclusive control</em> of the device (Sound settings → Properties → Advanced).</p>
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  {session.audio_path && (
                    <button
                      onClick={() => setActiveTab('audio')}
                      className="btn-ghost text-xs"
                    >
                      Check Audio Tab
                    </button>
                  )}
                  <button
                    onClick={() => window.meetmind.processing.retry(session.id, 'all')}
                    className="btn-primary text-sm"
                  >
                    Retry with correct device →
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[#666] mb-4">{isError ? 'Processing failed for this session.' : 'Notes not yet generated for this session.'}</p>
                <button
                  onClick={() => window.meetmind.processing.run(session.id)}
                  className="btn-primary"
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

        {/* Tabs: Summary | Notes | Transcript (pill-style) */}
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'summary'
                ? 'bg-[#2a2a2a] text-white'
                : 'text-[#888] hover:text-[#b0b0b0] hover:bg-[#1f1f1f]'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'notes'
                ? 'bg-[#2a2a2a] text-white'
                : 'text-[#888] hover:text-[#b0b0b0] hover:bg-[#1f1f1f]'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              <path d="M12 18v-6"/><path d="M9 15h6"/>
            </svg>
            Notes
          </button>
          {transcript?.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('transcript')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'transcript'
                  ? 'bg-[#2a2a2a] text-white'
                  : 'text-[#888] hover:text-[#b0b0b0] hover:bg-[#1f1f1f]'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>
              </svg>
              Transcript
            </button>
          )}
          {session.audio_path && (
            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'audio'
                  ? 'bg-[#2a2a2a] text-white'
                  : 'text-[#888] hover:text-[#b0b0b0] hover:bg-[#1f1f1f]'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
              Audio
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === 'summary' && (
          <div className="space-y-8">
            <Section title="✅ Action Items">
              <ActionItemsTable items={notes.action_items} />
            </Section>
            <Section title="📌 Key Points">
              <KeyPointsAccordion points={notes.key_points} />
            </Section>
            <Section title="🔑 Decisions">
              <BulletList items={notes.decisions} empty="No decisions recorded." />
            </Section>
            <Section title="❓ Open Questions">
              <BulletList items={notes.questions_unresolved} empty="No open questions." />
            </Section>
            {notes.next_meeting && (
              <Section title="📅 Next Meeting">
                <p className="text-[#a0a0a0] text-sm">{notes.next_meeting}</p>
              </Section>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-6 text-sm text-[#c0c0c0]">
            {notes.key_points?.length > 0 && (
              <div>
                <h3 className="text-[#888] text-xs font-medium uppercase tracking-wider mb-2">Key points</h3>
                <ul className="space-y-1.5">
                  {notes.key_points.map((p, i) => (
                    <li key={i}>• {p.heading} — {p.summary}</li>
                  ))}
                </ul>
              </div>
            )}
            {notes.action_items?.length > 0 && (
              <div>
                <h3 className="text-[#888] text-xs font-medium uppercase tracking-wider mb-2">Action items</h3>
                <ul className="space-y-1.5">
                  {notes.action_items.map((item, i) => (
                    <li key={i}>• {item.task}{item.owner ? ` (${item.owner})` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            {notes.decisions?.length > 0 && (
              <div>
                <h3 className="text-[#888] text-xs font-medium uppercase tracking-wider mb-2">Decisions</h3>
                <ul className="space-y-1.5">
                  {notes.decisions.map((d, i) => (
                    <li key={i}>• {d}</li>
                  ))}
                </ul>
              </div>
            )}
            {(!notes.key_points?.length && !notes.action_items?.length && !notes.decisions?.length) && (
              <p className="text-[#555] italic">No notes to show.</p>
            )}
          </div>
        )}

        {activeTab === 'transcript' && transcript?.length > 0 && (
          <TranscriptViewer transcript={transcript} />
        )}

        {activeTab === 'audio' && session.audio_path && (
          <div className="space-y-4">
            <p className="text-[#888] text-sm">Recorded audio for this session.</p>
            <audio
              key={session.id}
              controls
              className="w-full max-w-lg"
              src={`meetmind-audio://${session.id}`}
              preload="metadata"
            >
              Your browser does not support the audio element.
            </audio>
          </div>
        )}
      </div>

      {/* Footer — Regenerate + Notion upload */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-[#2a2a2a] flex items-center justify-between gap-3 flex-wrap">
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

        <div className="flex items-center gap-2">
          <button
            onClick={handleRegenerate}
            disabled={regenerating || uploading}
            className="btn-ghost text-xs disabled:opacity-50"
            title="Regenerate notes from transcript with current model"
          >
            {regenerating ? (
              <>
                <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Regenerating…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                Regenerate
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
    </div>
  );
}
