import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Loader2 } from 'lucide-react';
import { IconButton, ProgressBar } from '../ui/index.jsx';
import { formatClock } from '../../lib/format.js';
import { useNow } from '../../lib/hooks.js';
import { STAGE_LABELS } from '../../lib/status.js';

// The floating meeting overlay: one compact row (brand tile, two-line status, one action, close).
// Main owns all state and pushes it on overlay:state; this component only renders it and sends the
// user's choice back. Modes: prompt, recording, ended, processing, complete, error (anything else
// renders nothing).

const api = window.meetmindOverlay;

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme !== 'dark');
}

// The mic tile carries the state as a corner Status Dot (DESIGN.md), ringed in paper so it
// reads against the tile's hairline; while processing, the mic becomes a spinner instead.
function BrandMark({ dot, busy }) {
  return (
    <span className="tile relative inline-flex items-center justify-center flex-shrink-0 w-32 h-32 text-ink" aria-hidden="true">
      {busy
        ? <Loader2 size={16} strokeWidth={1.75} className="spinner" />
        : <Mic size={16} strokeWidth={1.75} />}
      {dot && <span className={`dot ${dot} absolute -top-4 -right-4 border-2 border-paper`} />}
    </span>
  );
}

// Two short lines: the status, and a graphite detail line (or any node).
function Status({ label, detail, title }) {
  return (
    <div className="flex-1 min-w-0 leading-tight" title={title}>
      <p className="text-caption leading-tight font-medium text-ink whitespace-nowrap">{label}</p>
      {typeof detail === 'string'
        ? <p className="text-caption leading-tight text-graphite truncate">{detail}</p>
        : detail}
    </div>
  );
}

function Close({ label = 'Hide', onClick }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <X size={14} strokeWidth={2} />
    </IconButton>
  );
}

function Elapsed({ startedAt }) {
  const now = useNow(1000);
  return <span className="tabular">{formatClock(startedAt ? (now - startedAt) / 1000 : 0)}</span>;
}

const Spinner = () => <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />;

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
  const meetingName = meeting?.title || meeting?.platformLabel || '';

  const BADGES = {
    prompt: 'dot-mint',
    recording: 'dot-signal dot-live',
    ended: 'dot-graphite',
    complete: 'dot-mint',
    error: 'dot-signal',
  };

  let row;
  if (mode === 'prompt') {
    row = (
      <>
        <Status
          label="Meeting detected"
          detail={error || meetingName}
          title={[meeting?.title, meeting?.platformLabel, meeting?.appLabel].filter(Boolean).join(' · ')}
        />
        <button type="button" className="btn btn-sunshine btn-sm" disabled={busy} onClick={() => run(api.start)}>
          {busy ? <Spinner /> : <span className="dot dot-sm dot-signal" aria-hidden="true" />}
          Record
        </button>
        <Close label="Not now" onClick={dismiss} />
      </>
    );
  } else if (mode === 'recording') {
    row = (
      <>
        <Status
          label={<>Recording · <Elapsed startedAt={startedAt} /></>}
          detail={error || meetingName || 'System audio and mic'}
        />
        <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => run(api.stop)}>
          {busy ? <Spinner /> : <Square size={10} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
          Stop
        </button>
        <Close onClick={dismiss} />
      </>
    );
  } else if (mode === 'ended') {
    row = (
      <>
        <Status
          label="Meeting ended?"
          detail={error || <p className="text-caption leading-tight text-graphite truncate">Recorded <Elapsed startedAt={startedAt} /></p>}
        />
        <button type="button" className="btn btn-sunshine btn-sm" disabled={busy} onClick={() => run(api.stop)}>
          {busy && <Spinner />}
          Stop
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => api.keepRecording()}>Keep</button>
      </>
    );
  } else if (mode === 'processing') {
    const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
    row = (
      <>
        <Status
          label={<>{STAGE_LABELS[state.stage] || 'Processing'} · <span className="tabular text-graphite">{pct}%</span></>}
          detail={<div className="mt-4"><ProgressBar value={pct} label="Processing progress" /></div>}
        />
        <Close onClick={dismiss} />
      </>
    );
  } else if (mode === 'complete') {
    row = (
      <>
        <Status label="Notes ready" detail={meetingName} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.openSession(sessionId)}>Open</button>
        <Close onClick={dismiss} />
      </>
    );
  } else {
    row = (
      <>
        <Status
          label="Processing failed"
          detail={state.error || 'Couldn’t write notes for this meeting.'}
          title={state.error}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.openSession(sessionId)}>Open</button>
        <Close onClick={dismiss} />
      </>
    );
  }

  return (
    <section
      ref={cardRef}
      key={mode}
      aria-label="MeetMind meeting overlay"
      aria-live="polite"
      className="floating rounded-card p-8 flex items-center gap-8 fade-in select-none"
    >
      <BrandMark dot={BADGES[mode]} busy={mode === 'processing'} />
      {row}
    </section>
  );
}
