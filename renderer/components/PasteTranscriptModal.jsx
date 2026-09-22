import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  FileText,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ClipboardPaste,
} from 'lucide-react';
import { useApp } from '../app.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultTitle() {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  }) + ' Meeting';
}

const STAGE_LABELS = {
  generating: 'Generating notes with AI…',
  uploading:  'Uploading to Notion…',
  complete:   'Done!',
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PasteTranscriptModal({ onClose }) {
  const { openSession, addToast, refreshSessions } = useApp();

  const [title, setTitle]                 = useState(defaultTitle);
  const [transcript, setTranscript]       = useState('');
  const [status, setStatus]               = useState('idle'); // 'idle' | 'loading' | 'done' | 'error'
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMessage, setErrorMessage]   = useState('');
  const textareaRef = useRef(null);
  const overlayRef  = useRef(null);

  // Focus textarea on open
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && status === 'idle') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [status, onClose]);

  // Track live processing stage from the existing IPC event
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsub = window.meetmind.on('processing:progress', ({ stage }) => {
      setProgressLabel(STAGE_LABELS[stage] || 'Processing…');
    });
    return unsub;
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setTranscript(text);
      textareaRef.current?.focus();
    } catch { /* user can paste manually */ }
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = transcript.trim();
    if (!trimmed) return;

    setStatus('loading');
    setProgressLabel('Generating notes with AI…');
    setErrorMessage('');

    try {
      const result = await window.meetmind.sessions.createFromTranscript({
        title: title.trim() || defaultTitle(),
        transcriptText: trimmed,
      });

      if (!result?.success) throw new Error(result?.error || 'Unknown error');

      setStatus('done');
      await refreshSessions();
      const session = await window.meetmind.sessions.get(result.sessionId);
      onClose();
      if (session) openSession(session);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Failed to process transcript.');
      addToast('Failed to create meeting from transcript.', 'warning');
    }
  }, [title, transcript, openSession, addToast, refreshSessions, onClose]);

  const canSubmit = transcript.trim().length > 0 && status === 'idle';

  return (
    /* Backdrop */
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current && status === 'idle') onClose(); }}
    >
      {/* Panel — uses the same card surface as Settings, NoteViewer, etc. */}
      <div
        className="relative w-full max-w-2xl flex flex-col overflow-hidden fade-in
                   bg-white dark:bg-[rgb(var(--color-background-secondary))]
                   border border-slate-200 dark:border-[rgb(var(--color-border))]
                   rounded-2xl shadow-2xl shadow-black/30"
        style={{ maxHeight: 'calc(100vh - 64px)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-[rgb(var(--color-border-muted))] flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <FileText size={15} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[rgb(var(--color-foreground))] leading-tight">
              Create Meeting from Transcript
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[rgb(var(--color-foreground-subtle))] mt-0.5">
              Paste a raw transcript and AI will generate structured notes
            </p>
          </div>
          {status === 'idle' && (
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost p-1.5"
              aria-label="Close"
            >
              <X size={15} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">

          {/* Title */}
          <div>
            <label className="section-heading">Meeting Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={status === 'loading'}
              placeholder="e.g. Monday Standup"
              className="input disabled:opacity-50"
            />
          </div>

          {/* Transcript */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="section-heading mb-0">Transcript</label>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                disabled={status === 'loading'}
                className="flex items-center gap-1.5 text-[11px] font-medium
                           text-emerald-600 dark:text-emerald-400
                           hover:text-emerald-700 dark:hover:text-emerald-300
                           disabled:opacity-40 transition-colors"
              >
                <ClipboardPaste size={12} strokeWidth={2} />
                Paste from clipboard
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={status === 'loading'}
              placeholder={`Paste your meeting transcript here…\n\nYou can use any format — raw text, timestamped lines, speaker-labelled dialogue, etc. AI will extract the key information.`}
              rows={13}
              className="input font-mono resize-none disabled:opacity-50"
              style={{ minHeight: '200px' }}
            />
            {transcript.length > 0 && (
              <p className="mt-1.5 text-[10px] text-slate-400 dark:text-[rgb(var(--color-foreground-subtle))] text-right">
                {transcript.trim().split(/\s+/).length.toLocaleString()} words ·{' '}
                {transcript.length.toLocaleString()} characters
              </p>
            )}
          </div>

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl
                            border border-rose-500/25 bg-rose-500/5
                            text-rose-600 dark:text-[rgb(var(--color-error))]">
              <AlertTriangle size={14} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-snug flex-1">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-5 py-3.5
                        border-t border-slate-100 dark:border-[rgb(var(--color-border-muted))]
                        bg-slate-50/60 dark:bg-[rgb(var(--color-background-tertiary))]/30
                        flex-shrink-0">
          {/* Left: progress / status */}
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-[rgb(var(--color-foreground-muted))] min-w-0">
            {status === 'loading' && (
              <>
                <Loader2 size={13} strokeWidth={2} className="animate-spin text-emerald-500 flex-shrink-0" />
                <span className="truncate">{progressLabel}</span>
              </>
            )}
            {status === 'done' && (
              <>
                <CheckCircle2 size={13} strokeWidth={2} className="text-emerald-500 flex-shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400">Done — opening session…</span>
              </>
            )}
            {status === 'error' && (
              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs"
              >
                Try again
              </button>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {status === 'idle' && (
              <button type="button" onClick={onClose} className="btn-secondary text-xs">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || status === 'loading' || status === 'done'}
              className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Sparkles size={13} strokeWidth={2} />
                  Generate Notes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
