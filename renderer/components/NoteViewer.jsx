import React, { useState, useRef, useMemo } from 'react';
import {
  Volume2,
  ChevronLeft,
  Copy,
  Check,
  FileText,
  Mic,
  ListChecks,
  MicOff,
  Loader2,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  Sparkles,
  MessageCircle,
  Zap,
  Flame,
  ArrowUp,
  Minus,
  ArrowDown,
  CalendarDays,
  Clock,
  Timer,
  Users,
  User,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Target,
  Info,
  UserCheck,
  Braces,
} from 'lucide-react';
import TranscriptViewer from './TranscriptViewer.jsx';
import NotionIcon from './NotionIcon.jsx';

const CONFIDENCE_STYLES = {
  confirmed: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  inferred:  'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  unknown:   'bg-slate-100 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400',
};

function parseInlineMarkdown(text) {
  if (!text) return text;
  // Matches images ![alt](src), links [text](url), code `code`, bold **b** / __b__, strike ~~s~~, italic *i* / _i_
  const regex = /(!?\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
  const parts = [];
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }

    const [full, , linkText, linkUrl, codeText, boldText1, boldText2, strikeText, italicText1, italicText2] = match;

    if (full.startsWith('![')) {
      parts.push(
        <img
          key={match.index}
          src={linkUrl}
          alt={linkText}
          className="my-2 rounded-lg max-h-80 object-cover border border-slate-200 dark:border-zinc-800"
        />
      );
    } else if (full.startsWith('[')) {
      parts.push(
        <a
          key={match.index}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 underline underline-offset-2 transition-colors font-medium"
          onClick={(e) => {
            if (linkUrl.startsWith('http')) {
              e.preventDefault();
              window.meetmind.shell.openExternal(linkUrl);
            }
          }}
        >
          {linkText}
        </a>
      );
    } else if (codeText != null) {
      parts.push(
        <code key={match.index} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-emerald-700 dark:text-emerald-300 font-mono text-[12px]">
          {codeText}
        </code>
      );
    } else if (boldText1 != null || boldText2 != null) {
      parts.push(
        <strong key={match.index} className="font-semibold text-slate-900 dark:text-zinc-100">
          {boldText1 ?? boldText2}
        </strong>
      );
    } else if (strikeText != null) {
      parts.push(
        <del key={match.index} className="line-through text-slate-400 dark:text-zinc-500">
          {strikeText}
        </del>
      );
    } else if (italicText1 != null || italicText2 != null) {
      parts.push(
        <em key={match.index} className="italic text-slate-800 dark:text-zinc-200">
          {italicText1 ?? italicText2}
        </em>
      );
    }

    lastIdx = match.index + full.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts.length === 1 ? parts[0] : parts;
}

function FormattedText({ content, className = '' }) {
  if (!content) return null;

  const lines = content.split(/\r?\n/);
  const blocks = [];
  let inCodeBlock = false;
  let currentCodeLines = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ type: 'code', lang: codeLang, code: currentCodeLines.join('\n') });
        inCodeBlock = false;
        currentCodeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      currentCodeLines.push(line);
    } else {
      blocks.push({ type: 'line', text: line });
    }
  }

  if (inCodeBlock && currentCodeLines.length > 0) {
    blocks.push({ type: 'code', lang: codeLang, code: currentCodeLines.join('\n') });
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div key={idx} className="my-3 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-950 p-3.5 font-mono text-xs text-emerald-700 dark:text-emerald-300 overflow-x-auto shadow-inner">
              {block.lang && (
                <div className="text-[10px] uppercase font-sans font-bold text-slate-500 dark:text-zinc-500 mb-1.5 tracking-wider">
                  {block.lang}
                </div>
              )}
              <pre className="whitespace-pre leading-relaxed">{block.code}</pre>
            </div>
          );
        }

        const line = block.text;
        const trimmed = line.trim();
        if (!trimmed) return null;

        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('\u2022 ');
        const isNumbered = /^\d+\.\s/.test(trimmed);

        let textToFormat = trimmed;
        if (isBullet) {
          textToFormat = trimmed.replace(/^[-*\u2022]\s+/, '');
        } else if (isNumbered) {
          textToFormat = trimmed.replace(/^\d+\.\s+/, '');
        }

        return (
          <div
            key={idx}
            className={
              isBullet
                ? 'flex items-start gap-2.5 pl-2'
                : isNumbered
                ? 'flex items-start gap-2.5 pl-2'
                : ''
            }
          >
            {isBullet && (
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400/80 flex-shrink-0" />
            )}
            {isNumbered && (
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5">
                {trimmed.match(/^\d+\./)[0]}
              </span>
            )}
            <span className="leading-relaxed text-slate-800 dark:text-zinc-300 text-sm">
              {parseInlineMarkdown(textToFormat)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Markdown prose renderer (used for _rawMarkdown mode notes) ────────────────

function isTableSeparator(line) {
  const trimmed = line.trim();
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed);
}

function parseTableAlignments(sepLine) {
  return sepLine
    .split('|')
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    .map((col) => {
      const c = col.trim();
      if (c.startsWith(':') && c.endsWith(':')) return 'center';
      if (c.endsWith(':')) return 'right';
      return 'left';
    });
}

function parseTableRow(rowLine) {
  return rowLine
    .split('|')
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    .map((c) => c.trim());
}

function MarkdownNoteView({ markdown }) {
  if (!markdown) return null;

  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ type: 'code', lang: codeLang, code: codeLines.join('\n') });
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = raw.trim().slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(raw);
      continue;
    }
    blocks.push({ type: 'line', text: raw });
  }
  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({ type: 'code', lang: codeLang, code: codeLines.join('\n') });
  }

  const rendered = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];

    if (b.type === 'code') {
      rendered.push(
        <div key={`code-${i}`} className="my-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-950 p-4 font-mono text-xs text-emerald-700 dark:text-emerald-300 overflow-x-auto shadow-inner">
          {b.lang && <div className="text-[10px] uppercase font-sans font-bold text-slate-500 dark:text-zinc-500 mb-2 tracking-wider">{b.lang}</div>}
          <pre className="whitespace-pre leading-relaxed">{b.code}</pre>
        </div>
      );
      i++;
      continue;
    }

    const line = b.text;
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Table detection
    if (
      trimmed.startsWith('|') &&
      trimmed.endsWith('|') &&
      i + 1 < blocks.length &&
      blocks[i + 1].type === 'line' &&
      isTableSeparator(blocks[i + 1].text)
    ) {
      const headerRow = parseTableRow(trimmed);
      const aligns = parseTableAlignments(blocks[i + 1].text);
      i += 2; // skip header and separator

      const rows = [];
      while (i < blocks.length && blocks[i].type === 'line') {
        const t = blocks[i].text.trim();
        if (!t.startsWith('|') || !t.endsWith('|')) break;
        rows.push(parseTableRow(t));
        i++;
      }

      rendered.push(
        <div key={`table-${i}`} className="my-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/70 shadow-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 dark:bg-zinc-900/90 border-b border-slate-200 dark:border-zinc-800 text-slate-800 dark:text-zinc-200">
              <tr>
                {headerRow.map((h, colIdx) => (
                  <th
                    key={colIdx}
                    style={{ textAlign: aligns[colIdx] || 'left' }}
                    className="px-4 py-3 font-semibold uppercase tracking-wider text-[11px] text-slate-700 dark:text-zinc-300"
                  >
                    {parseInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-slate-50 dark:hover:bg-zinc-900/40 transition-colors">
                  {headerRow.map((_, colIdx) => (
                    <td
                      key={colIdx}
                      style={{ textAlign: aligns[colIdx] || 'left' }}
                      className="px-4 py-2.5 leading-relaxed"
                    >
                      {parseInlineMarkdown(row[colIdx] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ATX headings
    const h1 = trimmed.match(/^#\s+(.+)/);
    const h2 = trimmed.match(/^##\s+(.+)/);
    const h3 = trimmed.match(/^###\s+(.+)/);
    const h4 = trimmed.match(/^####\s+(.+)/);

    if (h1 && !h2) {
      rendered.push(<h1 key={`h1-${i}`} className="text-2xl font-bold text-slate-900 dark:text-white mt-3 mb-4 leading-tight tracking-tight">{parseInlineMarkdown(h1[1])}</h1>);
      i++; continue;
    }
    if (h2 && !h3) {
      rendered.push(
        <div key={`h2-${i}`} className="mt-8 mb-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-sky-500 dark:bg-sky-400 flex-shrink-0 inline-block" />
            {parseInlineMarkdown(h2[1])}
          </h2>
          <div className="h-px bg-slate-200 dark:bg-zinc-800/70 mt-2" />
        </div>
      );
      i++; continue;
    }
    if (h3 && !h4) {
      rendered.push(<h3 key={`h3-${i}`} className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mt-5 mb-2">{parseInlineMarkdown(h3[1])}</h3>);
      i++; continue;
    }
    if (h4) {
      rendered.push(<h4 key={`h4-${i}`} className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400 mt-4 mb-1">{parseInlineMarkdown(h4[1])}</h4>);
      i++; continue;
    }

    // Blockquote (grouping consecutive > lines)
    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < blocks.length && blocks[i].type === 'line') {
        const t = blocks[i].text.trim();
        if (!t.startsWith('>')) break;
        quoteLines.push(t.replace(/^>\s?/, ''));
        i++;
      }
      rendered.push(
        <blockquote key={`quote-${i}`} className="border-l-2 border-sky-500/60 bg-sky-500/5 px-4 py-3 rounded-r-xl my-3 text-slate-800 dark:text-zinc-300 text-sm italic space-y-1.5">
          {quoteLines.map((ql, qidx) => (
            <p key={qidx}>{parseInlineMarkdown(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      rendered.push(<hr key={`hr-${i}`} className="border-slate-200 dark:border-zinc-800 my-6" />);
      i++; continue;
    }

    // List items (nested bullets, numbered, task lists)
    const isTaskDone = trimmed.match(/^-\s+\[x\]\s+(.*)/i);
    const isTaskOpen = trimmed.match(/^-\s+\[\s?\]\s+(.*)/);
    const isBullet = !isTaskDone && !isTaskOpen && trimmed.match(/^[-*\u2022+]\s+(.*)/);
    const isNumbered = !isTaskDone && !isTaskOpen && trimmed.match(/^(\d+)\.\s+(.*)/);

    if (isTaskDone || isTaskOpen || isBullet || isNumbered) {
      const rawIndent = line.match(/^(\s*)/)[1].replace(/\t/g, '  ').length;
      const indentLevel = Math.floor(rawIndent / 2);

      let contentText = '';
      if (isTaskDone) contentText = isTaskDone[1];
      else if (isTaskOpen) contentText = isTaskOpen[1];
      else if (isBullet) contentText = isBullet[1];
      else if (isNumbered) contentText = isNumbered[2];

      const paddingLeft = indentLevel > 0 ? `${indentLevel * 1.5}rem` : undefined;

      rendered.push(
        <div key={`item-${i}`} style={paddingLeft ? { paddingLeft } : undefined} className="flex items-start gap-2.5 my-1.5">
          {isTaskDone && (
            <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded bg-emerald-500 border border-emerald-500 flex items-center justify-center text-zinc-950">
              <Check size={10} strokeWidth={3} />
            </span>
          )}
          {isTaskOpen && (
            <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-950/60" />
          )}
          {isBullet && indentLevel === 0 && (
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400 flex-shrink-0" />
          )}
          {isBullet && indentLevel === 1 && (
            <span className="mt-2 w-1.5 h-1.5 rounded-full border border-sky-500 dark:border-sky-400/80 flex-shrink-0" />
          )}
          {isBullet && indentLevel >= 2 && (
            <span className="mt-2 w-1 h-1 bg-slate-400 dark:bg-zinc-400 flex-shrink-0" />
          )}
          {isNumbered && (
            <span className="text-xs font-mono font-bold text-sky-600 dark:text-sky-400 flex-shrink-0 mt-0.5 min-w-[1.2rem]">
              {isNumbered[1]}.
            </span>
          )}
          <span className={`text-sm leading-relaxed ${isTaskDone ? 'text-slate-400 dark:text-zinc-400 line-through' : 'text-slate-800 dark:text-zinc-300'}`}>
            {parseInlineMarkdown(contentText)}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Regular paragraph
    rendered.push(
      <p key={`p-${i}`} className="text-sm text-slate-800 dark:text-zinc-300 leading-relaxed my-2">{parseInlineMarkdown(trimmed)}</p>
    );
    i++;
  }

  return (
    <div className="max-w-3xl mx-auto fade-in">
      <div className="space-y-1">{rendered}</div>
    </div>
  );
}

const PRIORITY_STYLES = {
  high: {
    cls: 'badge-red',
    label: 'High',
    Icon: ArrowUp,
    ring: 'hover:border-rose-500/40',
  },
  medium: {
    cls: 'badge-yellow',
    label: 'Medium',
    Icon: Minus,
    ring: 'hover:border-amber-500/40',
  },
  low: {
    cls: 'badge-green',
    label: 'Low',
    Icon: ArrowDown,
    ring: 'hover:border-emerald-500/40',
  },
};

const SENTIMENT_STYLES = {
  positive: { cls: 'badge-green',  label: 'Positive', Icon: Sparkles },
  neutral:  { cls: 'badge-gray',   label: 'Neutral',  Icon: MessageCircle },
  mixed:    { cls: 'badge-yellow', label: 'Mixed',    Icon: Zap },
  tense:    { cls: 'badge-red',    label: 'Tense',    Icon: Flame },
};

const TABS = [
  { id: 'summary', label: 'Summary', Icon: FileText },
  { id: 'transcript', label: 'Transcript', Icon: Mic },
  { id: 'audio', label: 'Audio', Icon: Volume2 },
];

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatStartTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDurationSeconds(secs) {
  if (secs == null || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function SectionLabel({ icon: Icon, colorClass, children, count }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${colorClass}`}>
        <Icon size={14} strokeWidth={2} />
      </div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">{children}</h2>
      {count != null && (
        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-2 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  );
}

function ActionItemsList({ items }) {
  const [checked, setChecked] = useState(() => ({}));

  const toggle = (idx) => {
    setChecked((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const doneCount = items.reduce((n, _, idx) => n + (checked[idx] ? 1 : 0), 0);

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 px-4 py-8 text-center bg-white dark:bg-transparent">
        <ListChecks size={22} strokeWidth={1.75} className="mx-auto mb-2 text-slate-400 dark:text-zinc-600" />
        <p className="text-slate-500 dark:text-zinc-500 text-sm">No action items were identified in this meeting.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel
          icon={ListChecks}
          colorClass="bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400"
        >
          Action Items
        </SectionLabel>
        <span className="text-[11px] font-medium text-slate-600 dark:text-zinc-500 tabular-nums mb-4 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
          {doneCount}/{items.length} done
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const isDone = !!checked[idx];
          const priority = (item.priority || 'medium').toLowerCase();
          const priorityStyle = PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
          const PriorityIcon = priorityStyle.Icon;

          return (
            <li key={idx}>
              <button
                type="button"
                onClick={() => toggle(idx)}
                className={`w-full text-left flex items-start gap-3 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-zinc-800/70 bg-white dark:bg-zinc-900/25 transition-all shadow-sm dark:shadow-none ${
                  priorityStyle?.ring || 'hover:border-slate-300 dark:hover:border-zinc-700/80'
                } ${isDone ? 'opacity-55' : 'hover:bg-slate-50 dark:hover:bg-zinc-900/45'}`}
              >
                <span
                  className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all ${
                    isDone
                      ? 'bg-emerald-500 border border-emerald-500 text-zinc-950'
                      : 'border border-slate-300 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-950/60 text-transparent'
                  }`}
                >
                  <Check size={10} strokeWidth={3} />
                </span>

                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm leading-snug font-medium transition-colors ${
                      isDone ? 'text-slate-400 dark:text-zinc-500 line-through' : 'text-slate-900 dark:text-zinc-100'
                    }`}
                  >
                    {item.task || item.description || item.action}
                  </p>

                  {(item.owner || item.due || item.priority) && (
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                      {item.owner && (
                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-zinc-400 font-medium">
                          <User size={11} strokeWidth={2} />
                          {item.owner}
                        </span>
                      )}
                      {item.due && (
                        <span className="inline-flex items-center gap-1 text-slate-400 dark:text-zinc-500">
                          <Clock size={11} strokeWidth={2} />
                          Due: {item.due}
                        </span>
                      )}
                      {item.priority && (
                        <span className={priorityStyle.cls}>
                          <PriorityIcon size={11} strokeWidth={2.5} />
                          {priorityStyle.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayerCard({ sessionId, title, durationLabel }) {
  const audioRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openMessage, setOpenMessage] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioSrc = sessionId ? `meetmind-audio://session/${sessionId}` : '';
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const changeSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setSpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  const togglePlay = async () => {
    if (!audioRef.current || error) return;
    try {
      if (audioRef.current.paused) await audioRef.current.play();
      else audioRef.current.pause();
    } catch {
      setError('Unable to start playback. Try opening the recording file instead.');
    }
  };

  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  };

  const openRecordingFile = async () => {
    if (!sessionId || opening) return;
    setOpening(true);
    setOpenMessage(null);
    try {
      const result = await window.meetmind.sessions.openRecording(sessionId);
      if (!result?.success) {
        setOpenMessage(result?.error || 'Recording file not found for this session.');
      }
    } catch (err) {
      setOpenMessage(err.message || 'Failed to open recording file.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white dark:bg-gradient-to-b dark:from-zinc-900/90 dark:to-zinc-950/90 shadow-2xl shadow-black/10 dark:shadow-black/40">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative px-8 pt-10 pb-8 space-y-8">
          <div className="text-center space-y-3">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-inner">
              <Volume2 size={28} strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight truncate px-4">
                {title || 'Session Audio'}
              </h3>
              <p className="text-slate-500 dark:text-zinc-500 text-xs mt-1">
                {durationLabel ? `${durationLabel} recording` : 'Session recording'}
                {sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}
              </p>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm leading-relaxed flex gap-3">
              <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!ready}
                  className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? (
                    <Pause size={22} strokeWidth={2.5} fill="currentColor" />
                  ) : (
                    <Play size={22} strokeWidth={2.5} fill="currentColor" className="ml-0.5" />
                  )}
                </button>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={seek}
                  className="group relative w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden cursor-pointer"
                  aria-label="Seek"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-[width] duration-75"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `calc(${progress}% - 7px)` }}
                  />
                </button>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-zinc-500">
                  <span>{formatPlayerTime(currentTime)}</span>
                  <span>{formatPlayerTime(duration)}</span>
                </div>
              </div>

              <audio
                ref={audioRef}
                key={sessionId}
                className="hidden"
                src={audioSrc}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
                onLoadedMetadata={() => {
                  setReady(true);
                  setError(null);
                  setDuration(audioRef.current?.duration || 0);
                  if (audioRef.current) audioRef.current.playbackRate = speed;
                }}
                onCanPlay={() => setReady(true)}
                onEnded={() => setPlaying(false)}
                onError={() => {
                  setReady(false);
                  setPlaying(false);
                  setError('Audio file could not be loaded. The recording may be missing or still converting.');
                }}
              />

              {!ready && (
                <p className="text-center text-slate-500 dark:text-zinc-500 text-xs flex items-center justify-center gap-2">
                  <Loader2 size={12} className="spinner" />
                  Loading audio…
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={changeSpeed}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold hover:bg-slate-200 dark:hover:bg-zinc-800 hover:border-slate-300 dark:hover:border-zinc-700 transition-colors"
              title="Playback speed"
            >
              {speed}x
            </button>
            <button
              onClick={openRecordingFile}
              disabled={opening}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
              title="Show recording file in Explorer"
            >
              {opening ? (
                <Loader2 size={13} strokeWidth={2} className="spinner" />
              ) : (
                <FolderOpen size={13} strokeWidth={2} />
              )}
              Open File
            </button>
          </div>

          {openMessage && (
            <p className="text-center text-rose-500 dark:text-rose-400 text-xs">{openMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary content ──────────────────────────────────────────────────────────

function SummaryContent({ notes, session, noSpeech, isError, processingError }) {
  if (!notes) {
    return (
      <div className="flex items-center justify-center min-h-[420px]">
        <div className="text-center max-w-md w-full rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 p-10 shadow-2xl">
          {noSpeech ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5 text-amber-500 dark:text-amber-400">
                <MicOff size={28} strokeWidth={2} />
              </div>
              <h2 className="font-semibold text-lg text-slate-900 dark:text-white mb-2">No speech detected</h2>
              {processingError && (
                <p className="text-amber-700 dark:text-amber-300/90 text-xs font-mono bg-slate-100 dark:bg-zinc-950/80 rounded-xl p-3 mb-4 text-left leading-relaxed border border-amber-500/20">
                  {processingError}
                </p>
              )}
              <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed mb-6">
                The recording was saved but contained no audible speech.
              </p>
              <button
                onClick={() => window.meetmind.processing.retry(session.id, 'all')}
                className="btn-primary text-xs"
              >
                Retry Processing
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5 text-emerald-500 dark:text-emerald-400">
                <Sparkles size={26} strokeWidth={2} />
              </div>
              <h2 className="font-semibold text-lg text-slate-900 dark:text-white mb-2">
                {isError ? 'Processing failed' : 'Notes not ready yet'}
              </h2>
              <p className="text-slate-600 dark:text-zinc-400 text-sm leading-relaxed mb-6">
                {isError
                  ? 'Something went wrong while generating notes for this session.'
                  : 'Generate an AI summary, action items, and key topics from the transcript.'}
              </p>
              <button
                onClick={() => window.meetmind.processing.run(session.id)}
                className="btn-primary px-6 py-2.5 text-xs"
              >
                Generate Notes
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Markdown mode: raw markdown output ───────────────────────────────────
  if (notes._rawMarkdown) {
    return <MarkdownNoteView markdown={notes._rawMarkdown} />;
  }

  // ── JSON mode: rich structured UI ────────────────────────────────────────
  const actionItems = notes.action_items || [];
  const topics = (notes.sections?.length ? notes.sections : notes.topics?.length ? notes.topics : notes.key_points || []).filter((p) => p?.heading || p?.content || p?.summary);
  const participants = notes.participants || [];
  const statusUpdate = notes.status_update;
  const notableMentions = notes.notable_mentions || [];

  return (
    <div className="max-w-3xl mx-auto space-y-9 fade-in">
      {/* Participants Card */}
      {participants.length > 0 && (
        <section>
          <SectionLabel
            icon={Users}
            colorClass="bg-purple-500/10 border-purple-500/25 text-purple-600 dark:text-purple-400"
            count={participants.length}
          >
            Participants
          </SectionLabel>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {participants.map((p, idx) => {
              const confCls = CONFIDENCE_STYLES[p.identity_confidence] || CONFIDENCE_STYLES.inferred;
              return (
                <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-zinc-800/70 bg-white dark:bg-zinc-900/30">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700/80 flex items-center justify-center text-slate-700 dark:text-zinc-300 flex-shrink-0 font-bold text-xs">
                    {(p.name || p.label || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-zinc-200 truncate">
                        {p.name || p.label}
                      </span>
                      {p.name && p.label && p.name !== p.label && (
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">({p.label})</span>
                      )}
                    </div>
                    {p.role && <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">{p.role}</p>}
                  </div>
                  {p.identity_confidence && (
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize flex-shrink-0 ${confCls}`}>
                      {p.identity_confidence}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Status Update Card */}
      {statusUpdate && (statusUpdate.completion_estimate || statusUpdate.remaining_scope?.length > 0) && (
        <section className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-3">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-sky-500 dark:text-sky-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-300">Status Update</h3>
            {statusUpdate.completion_estimate && (
              <span className="ml-auto text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-300">
                {statusUpdate.completion_estimate}
              </span>
            )}
          </div>
          {statusUpdate.remaining_scope?.length > 0 && (
            <div className="space-y-1 pl-6">
              <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-zinc-400 tracking-wider">Remaining Scope:</p>
              <ul className="space-y-1">
                {statusUpdate.remaining_scope.map((item, i) => (
                  <li key={i} className="text-xs text-slate-800 dark:text-zinc-300 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-sky-500 dark:bg-sky-400 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Action Items */}
      <section>
        <ActionItemsList items={actionItems} />
      </section>

      {/* Topics */}
      {topics.length > 0 && (
        <section>
          <SectionLabel
            icon={FileText}
            colorClass="bg-sky-500/10 border-sky-500/25 text-sky-600 dark:text-sky-400"
            count={topics.length}
          >
            Key Topics
          </SectionLabel>

          <div className="space-y-8">
            {topics.map((topic, idx) => (
              <article key={idx} className="p-4 rounded-2xl border border-slate-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/20 space-y-4">
                <div className="flex items-baseline gap-2.5 border-b border-slate-200 dark:border-zinc-800/60 pb-3">
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-semibold text-[15px] text-slate-900 dark:text-zinc-100 leading-snug">
                    {topic.heading || 'Topic'}
                  </h3>
                </div>

                {/* Summary */}
                {topic.summary && (
                  <FormattedText content={topic.summary} />
                )}

                {/* Options Discussed */}
                {topic.options_discussed?.length > 0 && (
                  <div className="pl-3 border-l-2 border-slate-300 dark:border-zinc-700/50 space-y-1.5 pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Options / Perspectives Discussed:</p>
                    <ul className="space-y-1">
                      {topic.options_discussed.map((opt, i) => (
                        <li key={i} className="text-xs text-slate-800 dark:text-zinc-300 flex items-start gap-2">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 dark:bg-zinc-500 flex-shrink-0" />
                          <span>{parseInlineMarkdown(opt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Final Decision */}
                {topic.decision && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 text-xs leading-relaxed">
                    <CheckCircle2 size={16} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300 block mb-0.5">Decision:</span>
                      {parseInlineMarkdown(topic.decision)}
                    </div>
                  </div>
                )}

                {/* Open Questions */}
                {topic.open_questions?.length > 0 && (
                  <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/10 space-y-1.5 text-xs text-amber-800 dark:text-amber-200">
                    <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                      <HelpCircle size={14} strokeWidth={2} className="flex-shrink-0" />
                      <span>Pending / Open Questions:</span>
                    </div>
                    <ul className="space-y-1 pl-5 list-disc marker:text-amber-500 dark:marker:text-amber-400">
                      {topic.open_questions.map((q, i) => (
                        <li key={i}>{parseInlineMarkdown(q)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Notable Mentions */}
      {notableMentions.length > 0 && (
        <section className="p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 space-y-2.5">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800 dark:text-zinc-300">Notable Mentions &amp; Risks</h3>
          </div>
          <ul className="space-y-1.5 pl-6 list-disc text-xs text-slate-700 dark:text-zinc-300">
            {notableMentions.map((item, idx) => (
              <li key={idx}>{parseInlineMarkdown(item)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Main NoteViewer ──────────────────────────────────────────────────────────

export default function NoteViewer({ session, onBack, onRefresh }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const notes = session.notes;
  const rawTranscript = session.transcript;

  const normalizedTranscript = useMemo(() => {
    if (!rawTranscript) return [];
    if (Array.isArray(rawTranscript)) return rawTranscript;
    if (typeof rawTranscript === 'string') {
      try {
        const parsed = JSON.parse(rawTranscript);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        if (rawTranscript.trim()) {
          return [{ speaker: 'Speaker 1', text: rawTranscript.trim(), startTime: 0 }];
        }
      }
    }
    return [];
  }, [rawTranscript]);

  const sentiment = notes?.sentiment;
  const sentimentStyle = SENTIMENT_STYLES[sentiment] || null;
  const duration = formatDurationSeconds(session.duration_seconds);
  const startTime = formatStartTime(session.started_at);
  const SentimentIcon = sentimentStyle?.Icon;
  const isError = session.status === 'error';
  const noSpeech = isError && !normalizedTranscript.length;
  const processingError = session._processingError || null;
  const notionUrl = uploadResult || session.notion_page_url;

  const handleRegenerate = async () => {
    setRegenerating(true);
    setUploadError(null);
    try {
      const result = await window.meetmind.processing.retry(session.id, 'notes');
      if (result?.success) onRefresh?.();
      else if (result?.error) setUploadError(result.error);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleUploadToNotion = async () => {
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await window.meetmind.notion.upload(session.id);
      if (result.success) {
        setUploadResult(result.url);
        onRefresh?.();
      } else {
        setUploadError(result.error || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const copyMarkdownSummary = async () => {
    if (!notes) return;
    if (notes._rawMarkdown) {
      await navigator.clipboard.writeText(notes._rawMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    let md = `# ${notes.meeting_title || notes.title || session.title || 'Meeting Summary'}\n\n`;

    if (notes.participants?.length) {
      md += `## Participants\n`;
      notes.participants.forEach((p) => {
        const nameStr = p.name ? `${p.name} (${p.label})` : p.label;
        const roleStr = p.role ? ` — ${p.role}` : '';
        const confStr = p.identity_confidence ? ` [${p.identity_confidence}]` : '';
        md += `- ${nameStr}${roleStr}${confStr}\n`;
      });
      md += `\n`;
    }

    if (notes.status_update) {
      md += `## Status Update\n`;
      if (notes.status_update.completion_estimate) {
        md += `- **Completion Estimate:** ${notes.status_update.completion_estimate}\n`;
      }
      if (notes.status_update.remaining_scope?.length) {
        md += `- **Remaining Scope:**\n`;
        notes.status_update.remaining_scope.forEach((s) => (md += `  - ${s}\n`));
      }
      md += `\n`;
    }

    if (notes.action_items?.length) {
      md += `## Action Items\n`;
      notes.action_items.forEach((item) => {
        md += `- [ ] ${item.task}${item.owner ? ` (@${item.owner})` : ''}${item.due ? ` (Due: ${item.due})` : ''}\n`;
      });
      md += `\n`;
    }

    const topics = notes.topics?.length ? notes.topics : notes.key_points;
    if (topics?.length) {
      md += `## Key Topics\n\n`;
      topics.forEach((t, idx) => {
        md += `### ${idx + 1}. ${t.heading || 'Topic'}\n\n`;
        if (t.summary) md += `${t.summary}\n\n`;
        if (t.options_discussed?.length) {
          md += `**Options Discussed:**\n`;
          t.options_discussed.forEach((opt) => (md += `- ${opt}\n`));
          md += `\n`;
        }
        if (t.decision) md += `**Decision:** ${t.decision}\n\n`;
        if (t.open_questions?.length) {
          md += `**Open Questions:**\n`;
          t.open_questions.forEach((q) => (md += `- ${q}\n`));
          md += `\n`;
        }
      });
    }

    if (notes.notable_mentions?.length) {
      md += `## Notable Mentions\n`;
      notes.notable_mentions.forEach((m) => (md += `- ${m}\n`));
      md += `\n`;
    }

    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/40 fade-in">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-100/50 dark:bg-zinc-950/50 backdrop-blur-md titlebar-drag select-none">
        <div className="px-6 pt-3 pb-4 space-y-4">
          <div className="flex items-start gap-3 titlebar-no-drag">
            <button
              onClick={onBack}
              className="btn-ghost p-2 mt-0.5 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white rounded-xl"
              title="Back to sessions"
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>

            <div className="flex-1 min-w-0 space-y-2.5">
              <h1 className="font-bold text-xl text-slate-900 dark:text-white truncate tracking-tight leading-tight">
                {notes?.meeting_title || notes?.title || session.title || 'Meeting Notes'}
              </h1>

              <div className="flex items-center flex-wrap gap-1.5">
                {session.started_at && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 px-2 py-1 rounded-lg">
                    <CalendarDays size={11} strokeWidth={2} />
                    {formatDate(session.started_at)}
                  </span>
                )}
                {startTime && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 px-2 py-1 rounded-lg">
                    <Clock size={11} strokeWidth={2} />
                    {startTime}
                  </span>
                )}
                {(duration || notes?.duration) && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-700 dark:text-zinc-300 bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 px-2 py-1 rounded-lg">
                    <Timer size={11} strokeWidth={2} />
                    {notes?.duration || duration}
                  </span>
                )}
                {notes?.attendees?.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 px-2 py-1 rounded-lg max-w-[280px]">
                    <Users size={11} strokeWidth={2} className="flex-shrink-0" />
                    <span className="truncate">
                      {notes.attendees.slice(0, 3).join(', ')}
                      {notes.attendees.length > 3 ? ` +${notes.attendees.length - 3}` : ''}
                    </span>
                  </span>
                )}
                {sentimentStyle && (
                  <span className={sentimentStyle.cls}>
                    <SentimentIcon size={12} strokeWidth={2} />
                    {sentimentStyle.label}
                  </span>
                )}
                {notes && (
                  notes._rawMarkdown ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/30 px-2 py-1 rounded-lg">
                      <FileText size={11} strokeWidth={2} />
                      Markdown
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-lg">
                      <Braces size={11} strokeWidth={2} />
                      JSON
                    </span>
                  )
                )}
              </div>
            </div>

            {notes && (
              <button
                onClick={copyMarkdownSummary}
                className="btn-outline text-xs px-3 py-2 flex-shrink-0"
                title="Copy formatted Markdown notes"
              >
                {copied ? (
                  <>
                    <Check size={13} strokeWidth={2.5} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} strokeWidth={2} />
                    Copy
                  </>
                )}
              </button>
            )}
          </div>

          {/* Segmented tabs */}
          <div className="titlebar-no-drag inline-flex p-1 rounded-xl bg-slate-200/80 dark:bg-zinc-900/80 border border-slate-300/80 dark:border-zinc-800/80">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              const count = id === 'transcript' && normalizedTranscript.length > 0
                ? normalizedTranscript.length
                : null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    active
                      ? 'bg-white dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon size={14} strokeWidth={2} />
                  {label}
                  {count != null && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      active ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-slate-300/60 dark:bg-zinc-800 text-slate-600 dark:text-zinc-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <div
        className={`flex-1 overflow-y-auto px-6 pb-28 ${
          activeTab === 'transcript' ? 'pt-0 scrollbar-wide' : 'pt-6'
        }`}
      >
        {activeTab === 'summary' && (
          <SummaryContent
            notes={notes}
            session={session}
            noSpeech={noSpeech}
            isError={isError}
            processingError={processingError}
          />
        )}
        {activeTab === 'transcript' && (
          <TranscriptViewer transcript={normalizedTranscript} />
        )}
        {activeTab === 'audio' && (
          <AudioPlayerCard
            sessionId={session.id}
            title={notes?.title || session.title}
            durationLabel={duration}
          />
        )}
      </div>

      {/* Footer actions */}
      <footer className="flex-shrink-0 px-6 py-3.5 border-t border-slate-200 dark:border-zinc-800/80 bg-slate-100/80 dark:bg-zinc-950/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {notionUrl ? (
              <a
                href={notionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium hover:text-emerald-500 dark:hover:text-emerald-300 transition-colors truncate max-w-full"
                onClick={(e) => { e.preventDefault(); window.meetmind.shell.openExternal(notionUrl); }}
              >
                <NotionIcon size={12} />
                {uploadResult ? 'Synced to Notion' : 'View in Notion'}
                <ExternalLink size={11} strokeWidth={2} />
              </a>
            ) : (
              <span className="text-slate-400 dark:text-zinc-600 text-xs">Not synced to Notion yet</span>
            )}
            {uploadError && (
              <p className="text-rose-500 dark:text-rose-400 text-xs mt-1 truncate">{uploadError}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRegenerate}
              disabled={regenerating || uploading}
              className="btn-ghost text-xs text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
              title="Regenerate notes from transcript"
            >
              {regenerating ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="spinner" />
                  Regenerating…
                </>
              ) : (
                <>
                  <RefreshCw size={13} strokeWidth={2} />
                  Regenerate
                </>
              )}
            </button>

            <button
              onClick={handleUploadToNotion}
              disabled={uploading}
              className={`${notionUrl ? 'btn-ghost' : 'btn-outline'} text-xs disabled:opacity-50`}
              title={notionUrl ? 'Re-upload to Notion' : 'Upload notes to Notion'}
            >
              {uploading ? (
                <>
                  <Loader2 size={13} strokeWidth={2} className="spinner" />
                  Syncing…
                </>
              ) : (
                <>
                  <NotionIcon size={12} />
                  {notionUrl ? 'Re-sync' : 'Sync to Notion'}
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
