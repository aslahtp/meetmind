import React, { useEffect, useState } from 'react';

const STAGES = [
  { id: 'transcribing', label: 'Transcribing audio…',            icon: '🎙️', range: [0, 60]  },
  { id: 'generating',   label: 'Generating notes with Gemini…', icon: '🧠', range: [60, 85] },
  { id: 'uploading',    label: 'Uploading to Notion…',          icon: '📤', range: [85, 100] },
];

function getStageIndex(stageId) {
  return STAGES.findIndex((s) => s.id === stageId);
}

export default function ProcessingOverlay({ stage, percent }) {
  const [displayPercent, setDisplayPercent] = useState(percent || 0);

  // Smooth progress animation
  useEffect(() => {
    if (percent == null) return;
    const target = percent;
    const step = (target - displayPercent) / 10;
    if (Math.abs(step) < 0.5) {
      setDisplayPercent(target);
      return;
    }
    const timer = setInterval(() => {
      setDisplayPercent((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= target) || (step < 0 && next <= target)) {
          clearInterval(timer);
          return target;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [percent]);

  const currentStageIndex = getStageIndex(stage);
  const roundedPercent = Math.round(displayPercent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#212121] border border-[#333] rounded-2xl p-8 w-full max-w-md shadow-2xl fade-in">
        {/* Icon + title */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">
            {STAGES[Math.max(0, currentStageIndex)]?.icon || '⚙️'}
          </div>
          <h2 className="text-lg font-semibold">Processing Meeting</h2>
          <p className="text-[#666] text-sm mt-1">
            {STAGES[Math.max(0, currentStageIndex)]?.label || 'Please wait…'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-xs text-[#666]">Progress</span>
            <span className="text-xs text-[#888] font-mono">{roundedPercent}%</span>
          </div>
          <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, roundedPercent)}%` }}
            />
          </div>
        </div>

        {/* Stage checklist */}
        <div className="space-y-3">
          {STAGES.map((s, i) => {
            const isComplete = currentStageIndex > i || (stage === 'complete');
            const isCurrent  = currentStageIndex === i;

            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  isComplete ? 'bg-green-600' :
                  isCurrent  ? 'bg-green-900 border-2 border-green-600' :
                               'bg-[#2a2a2a] border border-[#333]'
                }`}>
                  {isComplete ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-green-400 spinner" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-[#555]" />
                  )}
                </div>
                <span className={`text-sm transition-colors ${
                  isComplete ? 'text-green-400' :
                  isCurrent  ? 'text-white' :
                               'text-[#555]'
                }`}>
                  {s.icon} {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[#444] text-xs mt-8">
          This may take a few minutes depending on the meeting length
        </p>
      </div>
    </div>
  );
}
