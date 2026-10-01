import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Square, Mic, Monitor, AlertTriangle, X } from 'lucide-react';
import { formatClock } from '../lib/format.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of bars in each level meter. */
const BAR_COUNT = 5;

/** Seconds of consecutive system-audio silence before the warning appears. */
const SILENCE_THRESHOLD_SEC = 120; // 2 minutes

// ── Level Meter ──────────────────────────────────────────────────────────────

/**
 * A single channel's level meter: a row of vertical bars whose heights
 * animate in response to the current `level` (0–1). Each bar gets a staggered
 * base contribution from its index so the meter "breathes" rather than
 * snapping as a flat block.
 */
function LevelMeter({ level, label, icon: Icon, muted }) {
  // Clamp and apply an easing curve so quiet speech still shows motion.
  const clamped = Math.max(0, Math.min(1, level));
  const eased = Math.pow(clamped, 0.6);

  return (
    <div className="level-meter" role="meter" aria-label={label} aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
      <Icon size={12} strokeWidth={1.75} className={muted ? 'text-graphite' : 'text-ink'} aria-hidden="true" />
      <div className="level-bars" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          // Stagger: middle bars react more than the edges, creating a dome shape.
          const distance = Math.abs(i - (BAR_COUNT - 1) / 2);
          const weight = 1 - (distance / ((BAR_COUNT - 1) / 2)) * 0.4;
          // Each bar has a minimum height (4px) and scales up to 16px.
          const fraction = eased * weight;
          const height = 4 + fraction * 12;
          return (
            <span
              key={i}
              className="level-bar"
              style={{
                height: `${height}px`,
                opacity: muted ? 0.3 : 0.4 + fraction * 0.6,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Silence Warning ──────────────────────────────────────────────────────────

function SilenceWarning({ seconds, onDismiss }) {
  const mins = Math.floor(seconds / 60);
  return (
    <div className="silence-warning fade-in" role="alert">
      <AlertTriangle size={14} strokeWidth={2} className="text-signal flex-shrink-0" aria-hidden="true" />
      <span className="text-caption text-signal">
        No system audio for {mins} min{mins !== 1 ? 's' : ''} — loopback may have failed
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-signal hover:text-ink transition-colors duration-150 flex-shrink-0"
        aria-label="Dismiss silence warning"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

// ── Recording Bar ────────────────────────────────────────────────────────────

// Hairline band under the top bar while a recording is live. Elapsed time is
// derived from the App-level start timestamp, so it survives remounts.
// `audioLevels` is { mic: 0–1, system: 0–1 } updated ~30 fps from the capture
// AnalyserNodes in app.jsx.
export default function RecordingBar({ startedAt, onStop, audioLevels }) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  // Silence tracking: count consecutive seconds of system-audio silence.
  const [systemSilenceSec, setSystemSilenceSec] = useState(0);
  const [silenceDismissed, setSilenceDismissed] = useState(false);
  const lastSystemLevelRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Track system-audio silence on a 1-second tick.
  useEffect(() => {
    const tick = setInterval(() => {
      // Treat anything below a very small threshold as silence.
      if (lastSystemLevelRef.current < 0.01) {
        setSystemSilenceSec((prev) => prev + 1);
      } else {
        setSystemSilenceSec(0);
        setSilenceDismissed(false);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  // Keep ref in sync with the latest system level.
  useEffect(() => {
    lastSystemLevelRef.current = audioLevels?.system ?? 0;
  }, [audioLevels?.system]);

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;

  const handleStop = async () => {
    setStopping(true);
    try {
      await onStop?.();
    } finally {
      setStopping(false);
    }
  };

  const micLevel = audioLevels?.mic ?? 0;
  const sysLevel = audioLevels?.system ?? 0;
  const showSilenceWarning = systemSilenceSec >= SILENCE_THRESHOLD_SEC && !silenceDismissed;

  return (
    <div className="flex-shrink-0 border-b border-ink bg-paper fade-in">
      {/* ── Main row ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-16 px-24 py-8">
        <div className="flex items-center gap-16 min-w-0">
          <span className="dot dot-signal dot-live" aria-hidden="true" />
          <span className="eyebrow text-signal">Recording</span>

          {/* Level meters */}
          <div className="flex items-center gap-16">
            <LevelMeter level={micLevel} label="Microphone level" icon={Mic} muted={micLevel < 0.01} />
            <LevelMeter level={sysLevel} label="System audio level" icon={Monitor} muted={sysLevel < 0.01} />
          </div>

          <span role="timer" aria-label="Recording time" className="tabular text-body-sm font-medium text-ink">
            {formatClock(elapsed)}
          </span>
        </div>

        <button type="button" onClick={handleStop} disabled={stopping} className="btn-ink btn-sm">
          {stopping ? (
            <>
              <Loader2 size={14} strokeWidth={2} className="spinner" />
              Finalizing…
            </>
          ) : (
            <>
              <Square size={12} strokeWidth={2} fill="currentColor" />
              Stop recording
            </>
          )}
        </button>
      </div>

      {/* ── Silence warning ────────────────────────────────────────────────── */}
      {showSilenceWarning && (
        <SilenceWarning seconds={systemSilenceSec} onDismiss={() => setSilenceDismissed(true)} />
      )}
    </div>
  );
}
