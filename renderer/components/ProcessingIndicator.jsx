import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { StatusDot } from './ui/index.jsx';
import { STAGE_LABELS } from '../lib/status.js';

// How long the finished state ("Notes ready" / "Failed") stays up before the pill tucks away.
const HOLD_DONE_MS = 1600;
const HOLD_ERROR_MS = 2600;

function PillContent({ outcome, label, pct, showLabel, showPct }) {
  return (
    <>
      {outcome
        ? <StatusDot key={outcome} tone={outcome === 'done' ? 'ok' : 'error'} className="proc-pop" />
        : <Loader2 size={14} strokeWidth={2} className="spinner text-graphite" aria-hidden="true" />}
      {showLabel && <span key={label} className="proc-label">{label}</span>}
      {showPct && <span className="tabular text-graphite">{pct}%</span>}
    </>
  );
}

// Live pipeline status for the top bar. It stays mounted so it can animate: the slot widens
// from nothing, the pill glides out from behind the Record button, its background fills with
// progress, and when the run ends it shows the outcome before sliding back and collapsing.
// It shows as much as fits in the bar's free space (`spacerRef` is the flexible spacer beside
// it): full label, then spinner + percentage, then the spinner alone.
export default function ProcessingIndicator({ processing, onOpen, spacerRef }) {
  const [view, setView] = useState(null); // { sessionId, stage, percent, outcome }
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('full'); // 'full' | 'compact' | 'icon'
  const [widths, setWidths] = useState(null); // measured content width per mode
  const openRef = useRef(false);
  const outcomeRef = useRef(null);
  const hideTimer = useRef(null);
  const slotRef = useRef(null);
  const pillRef = useRef(null);
  const sizeRef = useRef(null);
  const fullRef = useRef(null);
  const compactRef = useRef(null);
  const iconRef = useRef(null);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    if (processing) {
      clearTimeout(hideTimer.current);
      outcomeRef.current = null;
      setView({ ...processing, percent: processing.percent ?? 0, outcome: null });
      setOpen(true);
    } else if (!outcomeRef.current) {
      // Tracking stopped without a finish event: just tuck away.
      hideTimer.current = setTimeout(() => {
        if (!outcomeRef.current) setOpen(false);
      }, 120);
    }
  }, [processing]);

  // Finish events arrive in the same tick the app clears `processing`, so the outcome is
  // recorded before the effect above runs and the pill holds on it instead of vanishing.
  useEffect(() => {
    if (!window.meetmind?.on) return undefined;
    const finish = (outcome, hold) => {
      if (!openRef.current) return;
      clearTimeout(hideTimer.current);
      outcomeRef.current = outcome;
      setView((v) => v && { ...v, outcome, percent: outcome === 'done' ? 100 : v.percent });
      hideTimer.current = setTimeout(() => setOpen(false), hold);
    };
    const offComplete = window.meetmind.on('processing:complete', () => finish('done', HOLD_DONE_MS));
    const offError = window.meetmind.on('processing:error', () => finish('error', HOLD_ERROR_MS));
    return () => {
      offComplete?.();
      offError?.();
      clearTimeout(hideTimer.current);
    };
  }, []);

  // Pick the richest variant that fits. Free space = the spacer plus this slot's own width,
  // which stays constant however the slot is currently sized, so the choice can't oscillate.
  const fit = useCallback(() => {
    const m = {
      full: fullRef.current?.offsetWidth ?? 0,
      compact: compactRef.current?.offsetWidth ?? 0,
      icon: iconRef.current?.offsetWidth ?? 0,
    };
    setWidths((prev) => (prev && prev.full === m.full && prev.compact === m.compact && prev.icon === m.icon ? prev : m));
    const pill = pillRef.current;
    const size = sizeRef.current;
    const spacer = spacerRef?.current;
    if (!pill || !size || !spacer) return;
    const chrome = pill.offsetWidth - size.offsetWidth + parseFloat(getComputedStyle(pill).marginLeft || '0');
    const free = spacer.getBoundingClientRect().width + slotRef.current.getBoundingClientRect().width;
    const next = m.full + chrome <= free + 0.5 ? 'full' : m.compact + chrome <= free + 0.5 ? 'compact' : 'icon';
    setMode((prev) => (prev === next ? prev : next));
  }, [spacerRef]);

  useLayoutEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    [spacerRef?.current, slotRef.current, fullRef.current, compactRef.current]
      .filter(Boolean)
      .forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [fit, spacerRef]);

  const outcome = view?.outcome;
  const pct = Math.max(0, Math.min(100, Math.round(view?.percent || 0)));
  const label = outcome === 'done'
    ? 'Notes ready'
    : outcome === 'error'
      ? 'Failed'
      : STAGE_LABELS[view?.stage] || 'Processing';
  const ariaLabel = outcome
    ? `${label}. Open meeting.`
    : `${label}, ${pct} percent. Open meeting.`;
  // Once finished there's no percentage, so the outcome shows as dot + label or the dot alone.
  const showLabel = mode === 'full';
  const showPct = !outcome && mode !== 'icon';
  const width = widths?.[mode];

  return (
    <div
      ref={slotRef}
      className={`proc-slot ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      inert={open ? undefined : ''}
    >
      <div className="proc-slot-inner">
        <button
          ref={pillRef}
          type="button"
          onClick={() => view?.sessionId && onOpen(view.sessionId)}
          disabled={!view?.sessionId}
          className={`proc-pill ${outcome === 'done' ? 'is-done' : ''} ${outcome === 'error' ? 'is-error' : ''}`}
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <span className="proc-fill" style={{ transform: `scaleX(${pct / 100})` }} aria-hidden="true" />
          <span ref={sizeRef} className="proc-size" style={width ? { width } : undefined}>
            <span className="proc-content">
              <PillContent outcome={outcome} label={label} pct={pct} showLabel={showLabel} showPct={showPct} />
            </span>
          </span>
          {/* Invisible copies of each variant, measured to decide which one fits. */}
          <span className="proc-measure" aria-hidden="true">
            <span ref={fullRef} className="proc-content">
              <PillContent outcome={outcome} label={label} pct={pct} showLabel showPct={!outcome} />
            </span>
            <span ref={compactRef} className="proc-content">
              <PillContent outcome={outcome} label={label} pct={pct} showLabel={false} showPct={!outcome} />
            </span>
            <span ref={iconRef} className="proc-content">
              <PillContent outcome={outcome} label={label} pct={pct} showLabel={false} showPct={false} />
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
