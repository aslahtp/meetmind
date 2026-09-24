import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, Loader2, ClipboardPaste } from 'lucide-react';
import { useApp } from '../lib/app-context.js';
import { Dialog, TextField, StatusDot } from './ui/index.jsx';
import { STAGE_LABELS } from '../lib/status.js';

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

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PasteTranscriptModal({ onClose }) {
  const { openSession, refreshSessions, trackProcessing } = useApp();

  const [title, setTitle]                 = useState(defaultTitle);
  const [transcript, setTranscript]       = useState('');
  const [status, setStatus]               = useState('idle'); // 'idle' | 'loading' | 'error'
  const [progressLabel, setProgressLabel] = useState('');
  const [errorMessage, setErrorMessage]   = useState('');
  const textareaRef = useRef(null);

  // Track live processing stage from the existing IPC event
  useEffect(() => {
    if (!window.meetmind?.on) return;
    const unsub = window.meetmind.on('processing:progress', ({ stage }) => {
      setProgressLabel(STAGE_LABELS[stage] || 'Processing');
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
    setProgressLabel(STAGE_LABELS.generating);
    setErrorMessage('');

    try {
      const result = await window.meetmind.sessions.createFromTranscript({
        title: title.trim() || defaultTitle(),
        transcriptText: trimmed,
      });

      if (!result?.success) throw new Error(result?.error || 'Unknown error');

      // Notes are generated in the background; the top-bar chip follows progress.
      trackProcessing(result.sessionId);
      await refreshSessions();
      const session = await window.meetmind.sessions.get(result.sessionId);
      onClose();
      if (session) openSession(session);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Failed to process transcript.');
    }
  }, [title, transcript, openSession, refreshSessions, onClose, trackProcessing]);

  const busy = status === 'loading';
  const canSubmit = transcript.trim().length > 0 && !busy;
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title="Create a meeting from a transcript"
      description="Paste a raw transcript and MeetMind will write structured notes from it."
      initialFocusRef={textareaRef}
      footer={
        <div className="flex items-center justify-between gap-16 w-full">
          <div className="flex items-center gap-8 text-caption text-graphite min-w-0" aria-live="polite">
            {busy && (
              <>
                <Loader2 size={14} strokeWidth={2} className="spinner flex-shrink-0" />
                <span className="truncate">{progressLabel}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-8 flex-shrink-0">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost btn-sm">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="btn-sunshine btn-sm">
              {busy ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="spinner" />
                  Processing…
                </>
              ) : (
                <>
                  <Sparkles size={14} strokeWidth={1.75} />
                  Generate notes
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-24">
        <TextField
          label="Meeting title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          placeholder="e.g. Monday standup"
        />

        <div>
          <div className="flex items-center justify-between gap-16 mb-8">
            <label htmlFor="paste-transcript-text" className="label mb-0">Transcript</label>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              disabled={busy}
              className="inline-flex items-center gap-8 text-caption font-medium text-graphite hover:text-ink disabled:opacity-40 transition-colors duration-150"
            >
              <ClipboardPaste size={14} strokeWidth={1.75} />
              Paste from clipboard
            </button>
          </div>
          <textarea
            id="paste-transcript-text"
            ref={textareaRef}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={busy}
            placeholder={'Paste your meeting transcript here…\n\nAny format works: raw text, timestamped lines or speaker-labelled dialogue.'}
            rows={12}
            className="input resize-none min-h-[200px]"
          />
          {transcript.length > 0 && (
            <p className="mt-8 text-caption text-graphite text-right tabular">
              {wordCount.toLocaleString()} words · {transcript.length.toLocaleString()} characters
            </p>
          )}
        </div>

        {status === 'error' && (
          <div role="alert" className="flex items-start gap-8 text-caption text-ink">
            <StatusDot tone="error" className="mt-4" />
            <p className="flex-1">{errorMessage}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
