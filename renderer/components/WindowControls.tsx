import React from 'react';
import { X, Minus, Square } from 'lucide-react';

// Minimize / maximize / close for the frameless window (Windows and Linux; macOS keeps its native
// traffic lights). Its own file so the crash screen can show them when the top bar is gone.
export default function WindowControls() {
  const base = 'h-64 w-48 flex items-center justify-center text-graphite transition-colors duration-150';
  return (
    <div className="titlebar-no-drag flex items-stretch h-full flex-shrink-0">
      <button type="button" onClick={() => window.meetmind?.window?.minimize()} className={`${base} hover:text-ink hover:bg-ink/[0.06]`} aria-label="Minimize window">
        <Minus size={14} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => window.meetmind?.window?.maximize()} className={`${base} hover:text-ink hover:bg-ink/[0.06]`} aria-label="Maximize or restore window">
        <Square size={12} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => window.meetmind?.window?.close()} className={`${base} hover:text-paper hover:bg-signal`} aria-label="Close window">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
