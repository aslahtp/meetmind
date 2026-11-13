import React, { useId, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { sessionStatus } from '../../lib/status';
import { highlightParts } from '../../lib/meetingSearch';

export { default as Dialog } from './Dialog';
export { useConfirmDialog } from './ConfirmDialog';
export { default as Menu, MenuItem, MenuRadioItem, MenuLabel } from './Menu';
export type { MenuTriggerProps } from './Menu';

// ── HighlightedText — wraps matches in <mark> ─────────────────────────────────
// `query` marks literal substrings; `terms` (search keys from searchSessions) marks whole
// words that match, including stemmed forms, synonyms and corrected typos.
export interface HighlightedTextProps {
  text?: string | null;
  query?: string;
  terms?: ReadonlySet<string>;
}

export function HighlightedText({ text, query, terms }: HighlightedTextProps) {
  if (!text) return null;
  if (terms) {
    return highlightParts(text, terms).map((part, i) =>
      part.hit ? <mark key={i}>{part.text}</mark> : <React.Fragment key={i}>{part.text}</React.Fragment>,
    );
  }
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

// ── ExpandingButton — icon at rest, labelled pill on hover/focus ──────────────
// The label stays in the DOM (only clipped), so it's still the accessible name.
export interface ExpandingButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  icon: React.ReactNode;
  label: React.ReactNode;
}

export function ExpandingButton({ icon, label, className = '', ...rest }: ExpandingButtonProps) {
  return (
    <button type="button" className={`icon-pill ${className}`} {...rest}>
      {icon}
      <span className="icon-pill-label">{label}</span>
    </button>
  );
}

// ── IconButton — icon-only buttons must carry an accessible label ─────────────
export interface IconButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  label: string;
  pressed?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, className = '', pressed, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
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
});

// ── Switch ───────────────────────────────────────────────────────────────────
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The accessible name. */
  label: string;
  id?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, id, disabled }: SwitchProps) {
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
// `iconOnly`: icons without text; each label becomes the button's accessible name and tooltip.
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number | null;
}

export interface SegmentedControlProps<T extends string | number> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  role?: 'tablist' | 'radiogroup';
  size?: 'sm' | 'md';
  revealIcon?: boolean;
  iconOnly?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options, value, onChange, label, role = 'tablist', size = 'md',
  revealIcon = false, iconOnly = false, disabled = false, className = '',
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const isTabs = role === 'tablist';

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
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
      className={`inline-flex items-center gap-4 rounded-full border border-ink p-4 ${className}`}
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
            aria-label={iconOnly ? opt.label : undefined}
            title={iconOnly ? opt.label : undefined}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={`inline-flex items-center rounded-full font-medium ${
              revealIcon ? 'transition-colors duration-200 ease-out' : 'gap-8 transition-colors duration-150'
            } ${
              iconOnly ? 'p-8' : size === 'sm' ? 'px-16 py-4 text-caption' : 'px-16 py-8 text-caption'
            } ${selected ? 'bg-ink text-paper' : 'text-graphite hover:text-ink'} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {Icon && iconOnly ? (
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            ) : Icon && revealIcon ? (
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
            {!iconOnly && opt.label}
            {!iconOnly && opt.count != null && (
              <span className={`tabular ${revealIcon ? 'ml-8' : ''} ${selected ? 'text-paper/70' : 'text-graphite'}`}>{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── TextField / PasswordField — label is always tied to its input ────────────
interface FieldChromeProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

export type TextFieldProps =
  | (FieldChromeProps & { multiline?: false } & React.ComponentPropsWithoutRef<'input'>)
  | (FieldChromeProps & { multiline: true } & React.ComponentPropsWithoutRef<'textarea'>);

export function TextField({ label, hint, id, className = '', multiline = false, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={className}>
      {label && <label htmlFor={fieldId} className="label">{label}</label>}
      {multiline ? (
        <textarea
          id={fieldId}
          aria-describedby={hintId}
          className="input"
          {...(rest as React.ComponentPropsWithoutRef<'textarea'>)}
        />
      ) : (
        <input
          id={fieldId}
          aria-describedby={hintId}
          className="input"
          {...(rest as React.ComponentPropsWithoutRef<'input'>)}
        />
      )}
      {hint && <p id={hintId} className="hint mt-8">{hint}</p>}
    </div>
  );
}

export interface PasswordFieldProps extends React.ComponentPropsWithoutRef<'input'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
}

export function PasswordField({ label, hint, id, className = '', ...rest }: PasswordFieldProps) {
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
export type DotTone = 'live' | 'busy' | 'ok' | 'error' | 'neutral' | 'warning' | 'ink';

const DOT_CLASS: Record<Exclude<DotTone, 'busy'>, string> = {
  live: 'dot-signal dot-live',
  error: 'dot-signal',
  ok: 'dot-mint',
  neutral: 'dot-graphite',
  warning: 'dot-sunshine',
  ink: 'dot-ink',
};

export function StatusDot({ tone, className = '' }: { tone?: DotTone; className?: string }) {
  if (tone === 'busy') {
    return <Loader2 size={14} strokeWidth={2} className={`spinner text-graphite flex-shrink-0 ${className}`} aria-hidden="true" />;
  }
  const cls = (tone && DOT_CLASS[tone]) || 'dot-graphite';
  return <span className={`dot ${cls} ${className}`} aria-hidden="true" />;
}

export function StatusPill({ status, label, tone }: { status?: string | null; label?: string; tone?: DotTone }) {
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
export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  className?: string;
}

export function SaveBar({ dirty, saving, saved, onSave, onDiscard, saveLabel = 'Save changes', className = '' }: SaveBarProps) {
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
export interface StepBadgeProps {
  n: number;
  children?: React.ReactNode;
  done?: boolean;
  as?: React.ElementType;
  className?: string;
}

export function StepBadge({ n, children, done = false, as: Tag = 'span', className = '' }: StepBadgeProps) {
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
export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: PageHeaderProps) {
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
export function AvatarTile({ children, size = 48, className = '' }: { children?: React.ReactNode; size?: number; className?: string }) {
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
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  message?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, message, action, compact = false }: EmptyStateProps) {
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
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-ink/[0.07] animate-pulse rounded-input ${className}`} aria-hidden="true" />;
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value, label }: { value?: number; label: string }) {
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
export interface CheckBoxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  children?: React.ReactNode;
}

export function CheckBox({ checked, onChange, label, children }: CheckBoxProps) {
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
