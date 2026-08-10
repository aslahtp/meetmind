import React, { useState, useEffect } from 'react';
import { Loader2, Square } from 'lucide-react';

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function RecordingBar({ sessionId, onStop }) {
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStop = async () => {
    setStopping(true);
    await onStop?.();
  };

  return (
    <div className="flex items-center justify-between px-6 py-3 bg-rose-950/60 border-b border-rose-900/50 backdrop-blur-md flex-shrink-0 shadow-lg shadow-rose-950/20 fade-in">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="recording-dot w-3 h-3 rounded-full bg-rose-500 flex-shrink-0 shadow-lg shadow-rose-500/50" />
          <span className="text-rose-200 text-sm font-semibold tracking-wide">Live Recording</span>
        </div>

        {/* Audio Waveform Animation */}
        <div className="flex items-center gap-1 h-5 px-2 py-0.5 rounded bg-rose-900/40 border border-rose-800/40">
          <div className="wave-bar w-1 bg-rose-400 rounded-full" style={{ animationDelay: '0ms' }} />
          <div className="wave-bar w-1 bg-rose-400 rounded-full" style={{ animationDelay: '150ms' }} />
          <div className="wave-bar w-1 bg-rose-400 rounded-full" style={{ animationDelay: '300ms' }} />
          <div className="wave-bar w-1 bg-rose-400 rounded-full" style={{ animationDelay: '450ms' }} />
          <div className="wave-bar w-1 bg-rose-400 rounded-full" style={{ animationDelay: '200ms' }} />
        </div>

        <span className="text-rose-300 text-sm font-mono font-medium tracking-wider px-2.5 py-0.5 rounded bg-rose-900/60 border border-rose-700/50 shadow-inner">
          {formatDuration(elapsed)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {sessionId && (
          <span className="text-rose-400/60 text-xs font-mono hidden sm:block">
            ID: {sessionId.slice(0, 8)}
          </span>
        )}
        <button
          onClick={handleStop}
          disabled={stopping}
          title="Stop recording"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stopping ? (
            <>
              <Loader2 size={16} strokeWidth={2} className="spinner" />
              Finalizing…
            </>
          ) : (
            <>
              <Square size={12} strokeWidth={2.5} fill="currentColor" className="flex-shrink-0" />
              Stop Recording
            </>
          )}
        </button>
      </div>
    </div>
  );
}
