import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Loader2, ArrowUpRight } from 'lucide-react';
import { IconButton, ProgressBar } from '../ui/index.jsx';
import { formatClock } from '../../lib/format.js';
import { useNow } from '../../lib/hooks.js';
import { STAGE_LABELS } from '../../lib/status.js';

// The floating meeting overlay. Main owns all state and pushes it on overlay:state; this
// component only renders it and sends the user's choice back. Modes: prompt, recording, ended,
// processing, complete, error (anything else renders nothing).

const api = window.meetmindOverlay;

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme !== 'dark');
}

function BrandMark() {
  return (
    <span className="tile inline-flex items-center justify-center flex-shrink-0 w-32 h-32 text-ink" aria-hidden="true">
      <Mic size={16} strokeWidth={1.75} />
    </span>
  );
}

function Header({ dot, label, onClose, closeLabel = 'Hide' }) {
  return (
    <div className="flex items-center gap-8">
      <BrandMark />
      {dot}
      <span className="eyebrow flex-1 min-w-0 truncate">{label}</span>
      <IconButton label={closeLabel} onClick={onClose}>
        <X size={16} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

function Elapsed({ startedAt }) {
  const now = useNow(1000);
  const seconds = startedAt ? (now - startedAt) / 1000 : 0;
  return (
    <span className="tabular text-body-sm font-medium text-ink" title="Recording time">
      {formatClock(seconds)}
    </span>
  );
}

function meetingCaption(meeting) {
  if (!meeting) return '';
  // Desktop apps without a meeting title already show the platform as the title.
  const platform = meeting.title !== meeting.platformLabel ? meeting.platformLabel : '';
  return [platform, meeting.appLabel].filter(Boolean).join(' · ');
}

export default function MeetingOverlay() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef(null);

  useEffect(() => {
    if (!api) return undefined;
    api.getState().then(setState).catch(() => {});
    const offState = api.onState((next) => setState(next));
    const offTheme = api.onTheme(applyTheme);
    return () => { offState(); offTheme(); };
  }, []);

  // A new mode starts clean: no leftover error or disabled buttons.
  const mode = state?.mode;
  useEffect(() => { setBusy(false); setError(''); }, [mode]);

  // The window is sized to the card; report the card's height whenever it changes.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !api) return undefined;
    const observer = new ResizeObserver(() => api.resize(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result && result.success === false) {
        setError(result.error || 'Something went wrong.');
        setBusy(false);
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  if (!state || !['prompt', 'recording', 'ended', 'processing', 'complete', 'error'].includes(mode)) return null;

  const { meeting, startedAt, sessionId } = state;
  const dismiss = () => api.dismiss();

  let body;
  if (mode === 'prompt') {
    body = (
      <>
        <Header dot={<span className="dot dot-sm dot-mint" aria-hidden="true" />} label="Meeting detected" onClose={dismiss} closeLabel="Dismiss" />
        <p className="mt-16 text-body-sm font-medium text-ink truncate" title={meeting?.title}>{meeting?.title || 'Meeting'}</p>
        <p className="text-caption text-graphite truncate">{meetingCaption(meeting)}</p>
        {error && <p className="mt-8 text-caption text-signal">{error}</p>}
        <div className="mt-16 flex items-center gap-8">
          <button type="button" className="btn btn-sunshine btn-sm" disabled={busy} onClick={() => run(api.start)}>
            {busy ? <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" /> : <span className="dot dot-sm dot-signal" aria-hidden="true" />}
            Start recording
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={dismiss}>Not now</button>
        </div>
      </>
    );
  } else if (mode === 'recording') {
    body = (
      <>
        <Header dot={<span className="dot dot-sm dot-signal dot-live" aria-hidden="true" />} label="Recording" onClose={dismiss} />
        <div className="mt-16 flex items-center gap-16">
          <p className="flex-1 min-w-0 text-caption text-graphite truncate" title={meeting?.title}>
            {meeting?.title || 'Recording system audio and mic'}
          </p>
          <Elapsed startedAt={startedAt} />
          <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => run(api.stop)}>
            {busy
              ? <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />
              : <Square size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
            Stop
          </button>
        </div>
        {error && <p className="mt-8 text-caption text-signal">{error}</p>}
      </>
    );
  } else if (mode === 'ended') {
    body = (
      <>
        <Header dot={<span className="dot dot-sm dot-graphite" aria-hidden="true" />} label="Meeting ended?" onClose={() => api.keepRecording()} closeLabel="Keep recording" />
        <div className="mt-16 flex items-center gap-16">
          <p className="flex-1 min-w-0 text-body-sm font-medium text-ink">The call looks finished.</p>
          <Elapsed startedAt={startedAt} />
        </div>
        <p className="text-caption text-graphite">Stop recording and write the notes?</p>
        {error && <p className="mt-8 text-caption text-signal">{error}</p>}
        <div className="mt-16 flex items-center gap-8">
          <button type="button" className="btn btn-sunshine btn-sm" disabled={busy} onClick={() => run(api.stop)}>
            {busy && <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />}
            Stop recording
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => api.keepRecording()}>Keep recording</button>
        </div>
      </>
    );
  } else if (mode === 'processing') {
    const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
    body = (
      <>
        <Header dot={<Loader2 size={14} strokeWidth={2} className="spinner text-graphite flex-shrink-0" aria-hidden="true" />} label="Processing" onClose={dismiss} />
        <div className="mt-16 flex items-center gap-16">
          <p className="flex-1 min-w-0 text-body-sm font-medium text-ink truncate">{STAGE_LABELS[state.stage] || 'Processing'}</p>
          <span className="tabular text-caption text-graphite">{pct}%</span>
        </div>
        <div className="mt-8"><ProgressBar value={pct} label="Processing progress" /></div>
      </>
    );
  } else if (mode === 'complete') {
    body = (
      <>
        <Header dot={<span className="dot dot-sm dot-mint" aria-hidden="true" />} label="Notes ready" onClose={dismiss} />
        <p className="mt-16 text-body-sm font-medium text-ink truncate">{meeting?.title || 'Your meeting notes are ready.'}</p>
        <div className="mt-16 flex items-center gap-8">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.openSession(sessionId)}>
            Open notes
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Header dot={<span className="dot dot-sm dot-signal" aria-hidden="true" />} label="Processing failed" onClose={dismiss} />
        <p className="mt-16 text-body-sm font-medium text-ink">Couldn’t write notes for this meeting.</p>
        {state.error && <p className="text-caption text-graphite line-clamp-2" title={state.error}>{state.error}</p>}
        <div className="mt-16 flex items-center gap-8">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.openSession(sessionId)}>Open MeetMind</button>
        </div>
      </>
    );
  }

  return (
    <section
      ref={cardRef}
      key={mode}
      aria-label="MeetMind meeting overlay"
      aria-live="polite"
      className="floating rounded-card p-16 fade-in select-none"
    >
      {body}
    </section>
  );
}
