import React, { useRef } from 'react';
import { Check, ChevronRight, ExternalLink as ExternalLinkIcon, Loader2 } from 'lucide-react';
import { StatusDot } from '../ui/index.jsx';
import { KEY_GUIDES } from './data.js';

export function openExternal(url) {
  window.meetmind?.shell?.openExternal(url);
}

// ── Group card: a titled section of settings ──────────────────────────────────
export function SettingsGroup({ title, description, icon, aside, children }) {
  return (
    <section className="card">
      <header className="flex items-start justify-between gap-16">
        <div className="flex items-start gap-16 min-w-0">
          {icon && <span className="mt-4 flex-shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-subheading font-medium text-ink">{title}</h2>
            {description && <p className="text-caption text-graphite mt-4">{description}</p>}
          </div>
        </div>
        {aside && <div className="flex-shrink-0">{aside}</div>}
      </header>
      <div className="mt-24 space-y-24">{children}</div>
    </section>
  );
}

// ── Row: label + description on the left, control on the right ────────────────
export function SettingRow({ label, description, htmlFor, children }) {
  return (
    <div className="flex items-center justify-between gap-24">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body-sm font-medium text-ink cursor-pointer">{label}</label>
        ) : (
          <p className="text-body-sm font-medium text-ink">{label}</p>
        )}
        {description && <p className="text-caption text-graphite mt-4">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function RowList({ children }) {
  return <div className="divide-y divide-graphite/40 [&>*]:py-16 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">{children}</div>;
}

// ── Quiet external link ───────────────────────────────────────────────────────
export function ExternalLink({ href, children }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(href)}
      className="inline-flex items-center gap-4 text-caption font-medium text-ink underline underline-offset-4 hover:text-graphite"
    >
      {children}
      <ExternalLinkIcon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">(opens in browser)</span>
    </button>
  );
}

// ── "How to get a key" disclosure with numbered steps ─────────────────────────
export function KeyGuide({ provider, title = 'How to get a key' }) {
  const steps = KEY_GUIDES[provider];
  if (!steps) return null;
  return (
    <details className="group">
      <summary className="inline-flex items-center gap-8 cursor-pointer list-none text-caption font-medium text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} strokeWidth={2} className="transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
        {title}
      </summary>
      <ol className="mt-16 space-y-16">
        {steps.map((s, idx) => (
          <li key={idx} className="flex items-start gap-16">
            <span className="step-badge-num border border-ink flex-shrink-0" aria-hidden="true">{idx + 1}</span>
            <div className="min-w-0 text-caption text-graphite">
              <span className="sr-only">Step {idx + 1}: </span>
              <span className="text-ink">{s.text}</span>
              {s.url && (
                <span className="ml-8">
                  <ExternalLink href={s.url}>Open</ExternalLink>
                </span>
              )}
              {s.hint && <p className="mt-4">{s.hint}</p>}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ── Test button + inline result ───────────────────────────────────────────────
export function TestResult({ result, successLabel = 'Connected' }) {
  if (!result) return null;
  return result.success ? (
    <span className="inline-flex items-center gap-8 text-caption text-ink" role="status">
      <StatusDot tone="ok" />
      {successLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-8 text-caption text-signal" role="alert">
      <StatusDot tone="error" />
      {result.error || 'Connection failed'}
    </span>
  );
}

export function TestAction({ onClick, testing, label, result, successLabel }) {
  return (
    <div className="flex flex-wrap items-center gap-16">
      <button type="button" onClick={onClick} disabled={testing} className="btn-ghost btn-sm">
        {testing ? (
          <>
            <Loader2 size={14} strokeWidth={2} className="spinner" />
            Testing…
          </>
        ) : (
          label
        )}
      </button>
      <TestResult result={result} successLabel={successLabel} />
    </div>
  );
}

// ── Radio card group — keyboard operable (arrows move + select) ───────────────
export function RadioCardGroup({ label, options, value, onChange, renderOption, className = '' }) {
  const refs = useRef([]);
  const selectedIdx = Math.max(0, options.findIndex((o) => o.id === value));

  const onKeyDown = (e, idx) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const next = (idx + dir + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].id);
  };

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((opt, idx) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => { refs.current[idx] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={idx === selectedIdx ? 0 : -1}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={`w-full text-left flex items-start gap-16 rounded-card bg-paper transition-colors duration-150 ${
              selected ? 'border-2 border-ink p-[23px]' : 'border border-ink p-24 hover:bg-ink/[0.04]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-4 inline-flex items-center justify-center w-24 h-24 flex-shrink-0 rounded-full border border-ink ${
                selected ? 'bg-ink text-paper' : 'bg-paper'
              }`}
            >
              {selected && <Check size={14} strokeWidth={2.5} />}
            </span>
            <span className="flex-1 min-w-0">{renderOption(opt, selected)}</span>
          </button>
        );
      })}
    </div>
  );
}
