import React, { useCallback, useEffect, useRef, useState } from 'react';
import { resamplePeaks, timeAtOffset } from './waveform.js';

const HEIGHT = 64;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MIN_BAR = 2;
const REVEAL_MS = 450;
const KEY_STEP = 5;
const PAGE_STEP = 30;

function readRgbVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '0 0 0';
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Mirrored bar waveform that doubles as the seek control: played bars in ink, the rest in
 * graphite, a darker preview up to the hovered point. Click or drag to scrub; arrow keys
 * step 5 s, Page Up/Down 30 s, Home/End jump to the ends.
 */
export default function Waveform({ peaks, currentTime, duration, disabled, onSeek, formatTime }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState(null);
  const [reveal, setReveal] = useState(peaks ? 1 : 0);
  const [themeTick, setThemeTick] = useState(0);

  // Track container width so the bar count always fills the row.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw with the new palette when the theme class on <html> flips.
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // Grow the bars in from the centre line once peaks arrive.
  useEffect(() => {
    if (!peaks) {
      setReveal(0);
      return undefined;
    }
    if (prefersReducedMotion()) {
      setReveal(1);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / REVEAL_MS);
      setReveal(1 - (1 - t) ** 3);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const count = Math.max(1, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
    const bars = resamplePeaks(peaks, count);
    // Centre the bar run so leftover pixels split evenly on both sides.
    const offset = (width - (count * (BAR_WIDTH + BAR_GAP) - BAR_GAP)) / 2;

    const path = new Path2D();
    for (let i = 0; i < count; i++) {
      const h = Math.max(MIN_BAR, bars[i] * reveal * (HEIGHT - 4));
      path.roundRect(offset + i * (BAR_WIDTH + BAR_GAP), (HEIGHT - h) / 2, BAR_WIDTH, h, BAR_WIDTH / 2);
    }

    const ink = readRgbVar('--color-ink');
    const graphite = readRgbVar('--color-graphite');
    const playedX = duration ? Math.min(1, currentTime / duration) * width : 0;

    const fillRegion = (x0, x1, color) => {
      if (x1 <= x0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, HEIGHT);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.restore();
    };

    const idle = !peaks || disabled;
    fillRegion(0, width, `rgb(${graphite} / ${idle ? 0.25 : 0.4})`);
    if (idle) return;
    if (hoverX != null && hoverX > playedX) fillRegion(playedX, hoverX, `rgb(${graphite} / 0.85)`);
    fillRegion(0, playedX, `rgb(${ink})`);
    if (hoverX != null && hoverX < playedX) fillRegion(hoverX, playedX, `rgb(${ink} / 0.55)`);
  }, [peaks, width, currentTime, duration, hoverX, reveal, disabled, themeTick]);

  const interactive = !disabled && !!peaks && duration > 0;

  const offsetFromEvent = useCallback((e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return Math.min(rect.width, Math.max(0, e.clientX - rect.left));
  }, []);

  const onPointerDown = (e) => {
    if (!interactive || e.button !== 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeAtOffset(offsetFromEvent(e), width, duration));
  };

  const onPointerMove = (e) => {
    if (!interactive) return;
    const x = offsetFromEvent(e);
    setHoverX(x);
    if (draggingRef.current) onSeek(timeAtOffset(x, width, duration));
  };

  const endDrag = (e) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e) => {
    if (!interactive) return;
    const steps = {
      ArrowLeft: -KEY_STEP,
      ArrowDown: -KEY_STEP,
      ArrowRight: KEY_STEP,
      ArrowUp: KEY_STEP,
      PageDown: -PAGE_STEP,
      PageUp: PAGE_STEP,
    };
    let next;
    if (e.key in steps) next = currentTime + steps[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration;
    else return;
    e.preventDefault();
    onSeek(Math.min(duration, Math.max(0, next)));
  };

  const hoverTime = hoverX != null ? timeAtOffset(hoverX, width, duration) : null;

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={interactive ? 0 : -1}
      aria-label="Seek"
      aria-disabled={!interactive}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration || 0)}
      aria-valuenow={Math.round(Math.min(currentTime, duration || 0))}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => { if (!draggingRef.current) setHoverX(null); }}
      onKeyDown={onKeyDown}
      className={`relative w-full rounded-input select-none touch-none ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
      style={{ height: HEIGHT }}
    >
      <canvas ref={canvasRef} className="block" style={{ width: '100%', height: HEIGHT }} aria-hidden="true" />
      {hoverTime != null && interactive && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 px-8 py-[2px] rounded-full bg-ink text-paper text-caption tabular -translate-x-1/2 whitespace-nowrap"
          style={{ left: Math.min(width - 24, Math.max(24, hoverX)) }}
        >
          {formatTime(hoverTime)}
        </span>
      )}
    </div>
  );
}
