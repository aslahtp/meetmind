import React, { useId, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Check } from 'lucide-react';
import { sessionStatus } from '../../lib/status.js';

export { default as Dialog } from './Dialog.jsx';
export { useConfirmDialog } from './ConfirmDialog.jsx';

// ── IconButton — icon-only buttons must carry an accessible label ─────────────
export function IconButton({ label, children, className = '', pressed, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`icon-btn ${pressed ? 'text-ink border-ink' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────
export function Switch({ checked, onChange, label, id, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-24 w-48 flex-shrink-0 items-center rounded-full border border-ink transition-colors duration-150 disabled:opacity-40 ${
        checked ? 'bg-ink' : 'bg-paper'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-16 w-16 rounded-full transition-transform duration-150 ${
          checked ? 'translate-x-24 bg-paper' : 'translate-x-4 bg-ink'
        }`}
      />
    </button>
  );
}

// ── SegmentedControl / Tabs — role="tablist" with arrow-key navigation ────────
// `revealIcon`: show each option's icon only while it is selected, animating it in and out.
export function SegmentedControl({ options, value, onChange, label, role = 'tablist', size = 'md', revealIcon = false, disabled = false }) {
  const refs = useRef([]);
  const isTabs = role === 'tablist';

  const onKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % options.length;
    if (e.key === 'ArrowLeft') next = (idx - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className="inline-flex items-center gap-4 rounded-full border border-ink p-4"
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[idx] = el; }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={`inline-flex items-center rounded-full font-medium ${
              revealIcon ? 'transition-colors duration-200 ease-out' : 'gap-8 transition-colors duration-150'
            } ${
              size === 'sm' ? 'px-16 py-4 text-caption' : 'px-16 py-8 text-caption'
            } ${selected ? 'bg-ink text-paper' : 'text-graphite hover:text-ink'} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {Icon && revealIcon ? (
              // Same technique as the top-bar nav: the icon stays mounted and its width, gap and
              // opacity animate, so the pill (and the whole control) resizes smoothly.
              <span
                aria-hidden="true"
                className={`inline-flex items-center overflow-hidden transition-[max-width,margin-right,opacity] duration-200 ease-out ${
                  selected ? 'max-w-[14px] mr-8 opacity-100' : 'max-w-[0px] mr-0 opacity-0'
                }`}
              >
                <Icon size={14} strokeWidth={1.75} className="flex-shrink-0" />
              </span>
            ) : (
              Icon && <Icon size={14} strokeWidth={1.75} />
            )}
            {opt.label}
            {opt.count != null && (
              <span className={`tabular ${selected ? 'text-paper/70' : 'text-graphite'}`}>{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── TextField / PasswordField — label is always tied to its input ────────────
export function TextField({ label, hint, id, className = '', multiline = false, ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      <Tag id={fieldId} aria-describedby={hintId} className="input" {...rest} />
      {hint && <p id={hintId} className="hint mt-8">{hint}</p>}
    </div>
  );
}

export function PasswordField({ label, hint, id, className = '', ...rest }) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const [visible, setVisible] = useState(false);
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          className="input pr-48"
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide value' : 'Show value'}
          aria-pressed={visible}
          className="absolute right-4 top-1/2 -translate-y-1/2 icon-btn"
        >
          {visible ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      </div>
      {hint && <p id={hintId} className="hint mt-8">{hint}</p>}
    </div>
  );
}

// ── Status visuals ───────────────────────────────────────────────────────────
export function StatusDot({ tone, className = '' }) {
  if (tone === 'busy') {
    return <Loader2 size={14} strokeWidth={2} className={`spinner text-graphite flex-shrink-0 ${className}`} aria-hidden="true" />;
  }
  const cls = {
    live: 'dot-signal dot-live',
    error: 'dot-signal',
    ok: 'dot-mint',
    neutral: 'dot-graphite',
    warning: 'dot-sunshine',
    ink: 'dot-ink',
  }[tone] || 'dot-graphite';
  return <span className={`dot ${cls} ${className}`} aria-hidden="true" />;
}

export function StatusPill({ status, label, tone }) {
  const info = status ? sessionStatus(status) : { label, tone };
  return (
    <span className="pill">
      <StatusDot tone={tone || info.tone} />
      {label || info.label}
    </span>
  );
}

// ── Save bar — sticky "Unsaved changes · Discard · Save" ─────────────────────
// Render it while there are unsaved edits (and briefly after a save, with `saved`).
export function SaveBar({ dirty, saving, saved, onSave, onDiscard, saveLabel = 'Save changes', className = '' }) {
  return (
    <div
      className={`sticky bottom-24 floating rounded-card px-24 py-16 flex flex-wrap items-center justify-between gap-16 fade-in ${className}`}
      role="region"
      aria-label="Save changes"
    >
      {saved && !dirty ? (
        <p className="inline-flex items-center gap-8 text-body-sm text-ink" role="status">
          <StatusDot tone="ok" />
          Saved
        </p>
      ) : (
        <>
          <p className="inline-flex items-center gap-8 text-body-sm text-ink">
            <StatusDot tone="warning" />
            Unsaved changes
          </p>
          <div className="flex items-center gap-8">
            <button type="button" onClick={onDiscard} disabled={saving} className="btn-ghost btn-sm">
              Discard
            </button>
            <button type="button" onClick={onSave} disabled={saving} className="btn-sunshine btn-sm">
              {saving ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="spinner" />
                  Saving…
                </>
              ) : (
                saveLabel
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Numbered Step Badge ──────────────────────────────────────────────────────
export function StepBadge({ n, children, done = false, as: Tag = 'span', className = '' }) {
  return (
    <Tag className={`step-badge ${done ? 'step-badge-done' : ''} ${className}`}>
      <span className="step-badge-num" aria-hidden={done ? 'true' : undefined}>
        {done ? <Check size={14} strokeWidth={2.5} /> : n}
      </span>
      {done && <span className="sr-only">Step {n} done:</span>}
      {children}
    </Tag>
  );
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-16 mb-48">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-8">{eyebrow}</p>}
        <h1 className="text-heading font-medium text-ink">{title}</h1>
        {subtitle && <p className="text-body-sm text-graphite mt-8">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-8">{actions}</div>}
    </header>
  );
}

// ── Bordered Avatar Tile ─────────────────────────────────────────────────────
export function AvatarTile({ children, size = 48, className = '' }) {
  return (
    <span
      className={`tile inline-flex items-center justify-center flex-shrink-0 text-ink font-medium ${className}`}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

// ── CTA Block / empty state ──────────────────────────────────────────────────
export function EmptyState({ icon, title, message, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center text-center fade-in ${compact ? 'py-48' : 'py-64'}`}>
      {icon && <AvatarTile size={compact ? 48 : 64}>{icon}</AvatarTile>}
      <h2
        className={`font-medium text-ink ${compact ? 'text-heading mt-24' : 'text-display mt-32'}`}
        style={compact ? undefined : { letterSpacing: 'var(--tracking-display)' }}
      >
        {title}
      </h2>
      {message && <p className="text-body text-graphite mt-16 max-w-[640px]">{message}</p>}
      {action && <div className="mt-32 flex flex-wrap items-center justify-center gap-8">{action}</div>}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ className = '' }) {
  return <div className={`bg-ink/[0.07] animate-pulse rounded-input ${className}`} aria-hidden="true" />;
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-8 w-full rounded-full border border-ink overflow-hidden"
    >
      <div className="h-full bg-ink transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Checkbox (visual) ────────────────────────────────────────────────────────
export function CheckBox({ checked, onChange, label, children }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex items-start gap-16 text-left"
    >
      <span
        aria-hidden="true"
        className={`mt-4 inline-flex items-center justify-center w-16 h-16 flex-shrink-0 rounded-input border border-ink ${
          checked ? 'bg-ink text-paper' : 'bg-paper'
        }`}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}
