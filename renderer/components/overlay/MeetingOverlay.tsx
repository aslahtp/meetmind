import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, X, Loader2 } from 'lucide-react';
import { IconButton, ProgressBar } from '../ui/index';
import { formatClock } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { STAGE_LABELS } from '../../lib/status';
import { errorMessage } from '../../lib/errors';
import type { Outcome, OverlayMode, OverlayState, ProcessingProgressStage } from '@shared';

// The floating meeting overlay: one compact row (brand tile, two-line status, one action, close).
// Main owns all state and pushes it on overlay:state; this component only renders it, animates it
// in and out (styles/overlay.css), and sends the user's choice back. Modes: prompt, recording,
// ended, processing, complete, error. Any other mode collapses the bar, then tells main to close
// the window.

const api = window.meetmindOverlay;
const VISIBLE_MODES = new Set<OverlayMode>(['prompt', 'recording', 'ended', 'processing', 'complete', 'error']);
const OPEN_CONTENT_DELAY_MS = 420;   // the row's content waits for the bar to unfold

/** open: showing; closing: the collapse animation is playing; closed: unmounted. */
type Phase = 'open' | 'closing' | 'closed';

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme !== 'dark');
}

// The mic tile carries the state as a corner Status Dot (DESIGN.md), ringed in paper so it
// reads against the tile's hairline; while processing, the mic becomes a spinner instead.
interface BrandMarkProps {
  /** Class of the corner Status Dot, e.g. 'dot-mint'. */
  dot?: string;
  busy: boolean;
}

function BrandMark({ dot, busy }: BrandMarkProps) {
  return (
    <span className="tile relative inline-flex items-center justify-center flex-shrink-0 w-32 h-32 text-ink" aria-hidden="true">
      {busy
        ? <Loader2 size={16} strokeWidth={1.75} className="spinner" />
        : <Mic size={16} strokeWidth={1.75} />}
      {dot && (
        <span className="overlay-badge absolute -top-4 -right-4 flex">
          <span className={`dot ${dot} border-2 border-paper`} />
        </span>
      )}
    </span>
  );
}

// Two short lines: the status, and a graphite detail line (or any node).
interface StatusProps {
  label: React.ReactNode;
  detail?: React.ReactNode;
  title?: string;
}

function Status({ label, detail, title }: StatusProps) {
  return (
    <div className="flex-1 min-w-0 leading-tight" title={title}>
      <p className="text-caption leading-tight font-medium text-ink whitespace-nowrap">{label}</p>
      {typeof detail === 'string'
        ? <p className="text-caption leading-tight text-graphite truncate">{detail}</p>
        : detail}
    </div>
  );
}

interface CloseProps {
  label?: string;
  onClick: () => void;
}

function Close({ label = 'Hide', onClick }: CloseProps) {
  return (
    <IconButton label={label} onClick={onClick}>
      <X size={14} strokeWidth={2} />
    </IconButton>
  );
}

function Elapsed({ startedAt }: { startedAt?: number }) {
  const now = useNow(1000);
  return <span className="tabular">{formatClock(startedAt ? (now - startedAt) / 1000 : 0)}</span>;
}

// The row's content after the tile. Keyed by mode, so each state slides in; only the content
// mounted as the bar opens waits for it to unfold.
interface RevealProps {
  opening: boolean;
  children?: React.ReactNode;
}

function Reveal({ opening, children }: RevealProps) {
  const [delay] = useState(() => (opening ? OPEN_CONTENT_DELAY_MS : 0));
  return (
    <div className="overlay-rest flex-1 min-w-0 flex items-center gap-8" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const Spinner = () => <Loader2 size={14} strokeWidth={2} className="spinner" aria-hidden="true" />;

export default function MeetingOverlay() {
  const [state, setState] = useState<OverlayState | null>(null);       // last visible state, kept while the bar collapses
  const [phase, setPhase] = useState<Phase>('closed');
  const [openKey, setOpenKey] = useState(0);      // remounts the bar so the opening animation replays
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLElement>(null);
  const phaseRef = useRef<Phase>('closed');
  const openedAtRef = useRef(0);

  // Horizontal drag state — the bar is centred by default; dragging sends deltas to main.
  const dragRef = useRef({ active: false, startX: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Let buttons / interactive children handle their own clicks.
    if ((e.target as Element).closest('button, [role="button"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, startX: e.screenX };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const delta = e.screenX - d.startX;
    if (delta !== 0) {
      d.startX = e.screenX;
      api.move(delta);
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const goTo = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  const close = useCallback(() => {
    if (phaseRef.current === 'open') goTo('closing');
  }, []);

  const apply = useCallback((next: OverlayState | null) => {
    if (next && VISIBLE_MODES.has(next.mode)) {
      setState(next);
      if (phaseRef.current !== 'open') {
        openedAtRef.current = Date.now();
        setOpenKey((k) => k + 1);
        goTo('open');
      }
    } else {
      close();
    }
  }, [close]);

  useEffect(() => {
    if (!api) return undefined;
    api.ready().then(apply).catch(() => {});
    const offState = api.onState(apply);
    const offTheme = api.onTheme(applyTheme);
    return () => { offState(); offTheme(); };
  }, [apply]);

  // The last closing animation has finished: unmount, and let main close the window.
  const onAnimationEnd = (e: React.AnimationEvent<HTMLElement>) => {
    if (e.target !== cardRef.current || e.animationName !== 'overlayBarLift') return;
    if (phaseRef.current !== 'closing') return;
    goTo('closed');
    setState(null);
    api.closed();
  };

  // A new mode starts clean: no leftover error or disabled buttons.
  const mode = state?.mode;
  useEffect(() => { setBusy(false); setError(''); }, [mode]);

  // The window is sized to the card; report the card's height whenever it changes. The first
  // report also acknowledges the state to main, which replaces a window that never does.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !api) return undefined;
    const observer = new ResizeObserver(() => {
      api.resize(el.offsetHeight);
      if (el.offsetHeight > 0 && mode) api.shown(mode);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode, openKey]);

  const run = async (action: () => Promise<Outcome>) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result && result.success === false) {
        setError(result.error || 'Something went wrong.');
        setBusy(false);
      }
    } catch (err) {
      setError(errorMessage(err) || 'Something went wrong.');
      setBusy(false);
    }
  };

  if (phase === 'closed' || !state) return null;

  const { meeting, startedAt, sessionId } = state;
  // Collapse straight away on click; main confirms with a hidden state, which is then a no-op.
  const dismiss = () => { close(); api.dismiss(); };
  const meetingName = meeting?.title || meeting?.platformLabel || '';

  const BADGES: Partial<Record<OverlayMode, string>> = {
    prompt: 'dot-mint',
    recording: 'dot-signal dot-live',
    ended: 'dot-graphite',
    complete: 'dot-mint',
    error: 'dot-signal',
  };

  let row: React.ReactNode;
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
    // OverlayState.stage is a plain string; main sends a ProcessingProgressStage.
    const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
    row = (
      <>
        <Status
          label={<>{(state.stage && STAGE_LABELS[state.stage as ProcessingProgressStage]) || 'Processing'} · <span className="tabular text-graphite">{pct}%</span></>}
          detail={<div className="mt-4"><ProgressBar value={pct} label="Processing progress" /></div>}
        />
        <Close onClick={dismiss} />
      </>
    );
  } else if (mode === 'complete') {
    row = (
      <>
        <Status label="Notes ready" detail={meetingName} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => sessionId && api.openSession(sessionId)}>Open</button>
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => sessionId && api.openSession(sessionId)}>Open</button>
        <Close onClick={dismiss} />
      </>
    );
  }

  return (
    <section
      ref={cardRef}
      key={openKey}
      aria-label="MeetMind meeting overlay"
      aria-live="polite"
      onAnimationEnd={onAnimationEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`overlay-bar overlay-draggable floating rounded-card p-8 select-none ${phase === 'closing' ? 'is-closing' : 'is-opening'}`}
    >
      <div className="overlay-row flex items-center gap-8">
        <BrandMark dot={mode && BADGES[mode]} busy={mode === 'processing'} />
        <Reveal key={mode} opening={Date.now() - openedAtRef.current < OPEN_CONTENT_DELAY_MS}>{row}</Reveal>
      </div>
    </section>
  );
}
