import React, { useEffect, useState } from 'react';
import { AudioLines, Brain, Check, Settings2 } from 'lucide-react';
import NotionIcon from './NotionIcon.jsx';

const STAGES = [
  { id: 'transcribing', label: 'Transcribing audio speech…', Icon: AudioLines, range: [0, 60] },
  { id: 'generating',   label: 'Generating notes with AI…',  Icon: Brain,      range: [60, 85] },
  { id: 'uploading',    label: 'Uploading page to Notion…',  Icon: 'notion',    range: [85, 100] },
];

function getStageIndex(stageId) {
  return STAGES.findIndex((s) => s.id === stageId);
}

function StageIcon({ icon, size = 28 }) {
  if (icon === 'notion') return <NotionIcon size={size} />;
  const Icon = icon;
  return <Icon size={size} strokeWidth={2} />;
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
  const currentStage = STAGES[Math.max(0, currentStageIndex)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-md fade-in">
      <div className="relative w-full max-w-md p-8 bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Glow backdrop behind modal icon */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl glow-orb pointer-events-none" />

        {/* Icon + title */}
        <div className="text-center mb-8 relative z-10">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-inner">
            {currentStage ? (
              <StageIcon icon={currentStage.Icon} size={32} />
            ) : (
              <Settings2 size={32} strokeWidth={2} />
            )}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Processing Meeting</h2>
          <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1">
            {currentStage?.label || 'Please wait…'}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-7 relative z-10">
          <div className="flex justify-between mb-2 text-xs">
            <span className="text-slate-600 dark:text-zinc-400 font-medium">Pipeline Progress</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-mono font-semibold">{roundedPercent}%</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden p-0.5 border border-slate-200 dark:border-zinc-700/60">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 ease-out shadow-sm shadow-emerald-500/50"
              style={{ width: `${Math.min(100, roundedPercent)}%` }}
            />
          </div>
        </div>

        {/* Stage checklist */}
        <div className="space-y-3 relative z-10">
          {STAGES.map((s, i) => {
            const isComplete = currentStageIndex > i || (stage === 'complete');
            const isCurrent  = currentStageIndex === i;

            return (
              <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800/80">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                  isComplete ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40' :
                  isCurrent  ? 'bg-emerald-500/10 border-2 border-emerald-500' :
                               'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700'
                }`}>
                  {isComplete ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 spinner" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-zinc-600" />
                  )}
                </div>
                <span className={`text-sm font-medium transition-colors ${
                  isComplete ? 'text-emerald-600 dark:text-emerald-400' :
                  isCurrent  ? 'text-slate-900 dark:text-zinc-100' :
                               'text-slate-400 dark:text-zinc-500'
                }`}>
                  <span className="inline-flex items-center gap-1.5">
                    <StageIcon icon={s.Icon} size={14} />
                    {s.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-center text-slate-400 dark:text-zinc-600 text-xs mt-7 relative z-10">
          Auto-saving results to your MeetMind database
        </p>
      </div>
    </div>
  );
}
