import React, { useState, useEffect } from 'react';

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
    <div className="flex items-center justify-between px-5 py-2.5 bg-red-950 border-b border-red-900 flex-shrink-0">
      <div className="flex items-center gap-3">
        <span className="recording-dot w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
        <span className="text-red-300 text-sm font-medium">Recording</span>
        <span className="text-red-400 text-sm font-mono">{formatDuration(elapsed)}</span>
      </div>

      <div className="flex items-center gap-3">
        {sessionId && (
          <span className="text-red-700 text-xs font-mono hidden sm:block">
            {sessionId.slice(0, 8)}…
          </span>
        )}
        <button
          onClick={handleStop}
          disabled={stopping}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600
                     text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stopping ? (
            <>
              <svg className="spinner w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              Stopping…
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 bg-white rounded-sm" />
              Stop
            </>
          )}
        </button>
      </div>
    </div>
  );
}
