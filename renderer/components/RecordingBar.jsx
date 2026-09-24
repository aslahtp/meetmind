import React, { useState, useEffect } from 'react';
import { Loader2, Square } from 'lucide-react';
import { formatClock } from '../lib/format.js';

// Hairline band under the top bar while a recording is live. Elapsed time is
// derived from the App-level start timestamp, so it survives remounts.
export default function RecordingBar({ startedAt, onStop }) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;

  const handleStop = async () => {
    setStopping(true);
    try {
      await onStop?.();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex-shrink-0 flex items-center justify-between gap-16 px-24 py-8 border-b border-ink bg-paper fade-in">
      <div className="flex items-center gap-16 min-w-0">
        <span className="dot dot-signal dot-live" aria-hidden="true" />
        <span className="eyebrow text-signal">Recording</span>

        <div className="flex items-center gap-4 h-16" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="wave-bar w-[2px] rounded-full bg-ink"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
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
  );
}
