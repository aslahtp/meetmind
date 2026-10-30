import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpCircle, Download, ExternalLink, RotateCcw, X } from 'lucide-react';
import { IconButton, ProgressBar, StatusDot } from './ui/index.jsx';

// App update status for the top bar: a pill that slides out (the processing pill's motion, see
// .proc-* in globals.css) only while there is something to act on or watch, and opens a small
// panel with the details and actions when clicked. Main owns the state (updater:status).
//   available    "Update available"   panel: Download (or Download from GitHub on macOS)
//   downloading  "Updating 42%"       the pill fills with progress; panel: MB and speed
//   downloaded   "Update ready"       panel: Restart now / Later
//   error        "Update failed"      only when a download failed (not a failed check); panel: Retry

const MB = 1024 * 1024;

function pillFor(state) {
  if (!state?.isPackaged || !state.updateInfo?.version) return null;
  switch (state.status) {
    case 'available': return { kind: 'available', label: 'Update available', fill: 0 };
    case 'downloading': {
      const pct = Math.max(0, Math.min(100, Math.round(state.downloadProgress?.percent || 0)));
      return { kind: 'downloading', label: 'Updating', pct, fill: pct / 100 };
    }
    case 'downloaded': return { kind: 'ready', label: 'Update ready', fill: 1 };
    case 'error': return state.errorPhase === 'download' ? { kind: 'error', label: 'Update failed', fill: 1 } : null;
    default: return null;
  }
}

function PillIcon({ kind }) {
  if (kind === 'ready') return <StatusDot key="ready" tone="ok" className="proc-pop" />;
  if (kind === 'error') return <StatusDot key="error" tone="error" className="proc-pop" />;
  return <ArrowUpCircle size={14} strokeWidth={1.75} aria-hidden="true" />;
}

function UpdatePanel({ id, state, pill, onClose, triggerRef }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const updater = window.meetmind?.updater;
  const version = state.updateInfo?.version;
  const progress = state.downloadProgress;
  const [busy, setBusy] = useState(false);

  // Focus the panel's first action when it opens.
  useEffect(() => {
    panelRef.current?.querySelector('[data-autofocus]')?.focus();
  }, []);

  // Escape or a click outside closes it.
  useEffect(() => {
    const onPointerDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) onClose();
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, triggerRef]);

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  let body;
  let primary = null;
  if (pill.kind === 'available') {
    body = state.canSelfUpdate === false
      ? 'Download the new version from GitHub.'
      : 'Download it now, or turn on automatic updates in Settings › General.';
    primary = (
      <button type="button" data-autofocus onClick={() => run(() => updater?.download())} disabled={busy} className="btn-ink btn-sm">
        <Download size={14} strokeWidth={1.75} aria-hidden="true" />
        {state.canSelfUpdate === false ? 'Download from GitHub' : 'Download'}
      </button>
    );
  } else if (pill.kind === 'downloading') {
    body = (
      <div className="space-y-8">
        <div className="flex items-center justify-between gap-16">
          <p className="text-caption text-ink">Downloading…</p>
          <span className="text-caption text-graphite tabular">{pill.pct}%</span>
        </div>
        <ProgressBar value={pill.pct} label="Update download progress" />
        {progress?.total > 0 && (
          <p className="hint tabular">
            {(progress.transferred / MB).toFixed(1)} MB of {(progress.total / MB).toFixed(1)} MB
            {progress.bytesPerSecond > 0 && ` · ${(progress.bytesPerSecond / MB).toFixed(1)} MB/s`}
          </p>
        )}
      </div>
    );
  } else if (pill.kind === 'ready') {
    body = state.autoInstall
      ? 'Downloaded and verified. It installs by itself when MeetMind is idle in the tray, or when it quits.'
      : 'Downloaded and verified. Restart MeetMind to finish installing.';
    primary = (
      <>
        <button type="button" data-autofocus onClick={() => updater?.install()} className="btn-ink btn-sm">
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
          Restart now
        </button>
        <button type="button" onClick={onClose} className="btn-quiet btn-sm">Later</button>
      </>
    );
  } else {
    body = <span className="text-signal">{state.errorMessage || 'The download didn’t finish.'}</span>;
    primary = (
      <button type="button" data-autofocus onClick={() => run(() => updater?.download())} disabled={busy} className="btn-ink btn-sm">
        <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
        Retry
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      className="absolute right-0 top-[calc(100%+16px)] z-[70] w-[320px] max-w-[calc(100vw-32px)] floating rounded-card p-24 fade-in"
    >
      <div className="flex items-start justify-between gap-16">
        <div className="min-w-0">
          <p className="eyebrow">{pill.label}</p>
          <h2 id={titleId} className="text-subheading font-medium text-ink mt-8 tabular">MeetMind v{version}</h2>
          <p className="text-caption text-graphite mt-4 tabular">You have v{state.currentVersion}</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="text-caption text-graphite mt-16">{body}</div>
      <div className="flex flex-wrap items-center gap-8 mt-24">
        {primary}
        <button
          type="button"
          data-autofocus={primary ? undefined : true}
          onClick={() => window.meetmind?.shell?.openExternal(state.releaseUrl)}
          className="btn-quiet btn-sm"
        >
          What’s new
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function UpdateIndicator({ state }) {
  const pill = pillFor(state);
  const [expanded, setExpanded] = useState(false);
  const lastPillRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const close = useCallback(() => setExpanded(false), []);

  // Keep the last pill's content while it slides away.
  if (pill) lastPillRef.current = pill;
  const shown = pill || lastPillRef.current;

  const visible = !!pill;
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  const ariaLabel = shown
    ? `${shown.label}${shown.kind === 'downloading' ? `, ${shown.pct} percent` : ''}: MeetMind v${state?.updateInfo?.version || ''}`
    : '';

  return (
    <div className="relative flex items-center">
      <div className={`proc-slot ${pill ? 'is-open' : ''}`} aria-hidden={!pill} inert={pill ? undefined : ''}>
        <div className="proc-slot-inner">
          {shown && (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              aria-label={ariaLabel}
              title={ariaLabel}
              className={`proc-pill ${shown.kind === 'ready' ? 'is-done' : ''} ${shown.kind === 'error' ? 'is-error' : ''} ${expanded ? 'bg-ink/[0.04]' : ''}`}
            >
              <span className="proc-fill" style={{ transform: `scaleX(${shown.fill})` }} aria-hidden="true" />
              <span className="proc-content">
                <PillIcon kind={shown.kind} />
                {/* Icon (and percentage) only on narrow windows. */}
                <span className="hidden lg:inline-flex">
                  <span key={shown.label} className="proc-label">{shown.label}</span>
                </span>
                {shown.kind === 'downloading' && <span className="tabular text-graphite">{shown.pct}%</span>}
              </span>
            </button>
          )}
        </div>
      </div>
      {expanded && pill && (
        <UpdatePanel id={panelId} state={state} pill={pill} onClose={close} triggerRef={triggerRef} />
      )}
    </div>
  );
}
