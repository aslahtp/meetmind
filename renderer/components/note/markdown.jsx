import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function openExternal(e, url) {
  if (url?.startsWith('http')) {
    e.preventDefault();
    window.meetmind?.shell?.openExternal(url);
  }
}

// Lightweight inline markdown: images, links, code, bold, strike, italic.
export function parseInlineMarkdown(text) {
  if (!text) return text;
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
          className="my-8 rounded-image max-h-[320px] object-cover border border-ink"
        />
      );
    } else if (full.startsWith('[')) {
      parts.push(
        <a
          key={match.index}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-ink font-medium underline underline-offset-4 hover:text-graphite transition-colors"
          onClick={(e) => openExternal(e, linkUrl)}
        >
          {linkText}
        </a>
      );
    } else if (codeText != null) {
      parts.push(
        <code key={match.index} className="px-4 rounded-input border border-ink font-mono text-caption text-ink">
          {codeText}
        </code>
      );
    } else if (boldText1 != null || boldText2 != null) {
      parts.push(
        <strong key={match.index} className="font-medium text-ink">
          {boldText1 ?? boldText2}
        </strong>
      );
    } else if (strikeText != null) {
      parts.push(
        <del key={match.index} className="line-through text-graphite">
          {strikeText}
        </del>
      );
    } else if (italicText1 != null || italicText2 != null) {
      parts.push(
        <em key={match.index} className="italic text-ink">
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

// Block-level text: paragraphs, bullet / numbered lines and fenced code.
export function FormattedText({ content, className = '' }) {
  if (!content) return null;

  const lines = content.split(/\r?\n/);
  const blocks = [];
  let inCodeBlock = false;
  let currentCodeLines = [];
  let codeLang = '';

  for (const line of lines) {
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

    if (inCodeBlock) currentCodeLines.push(line);
    else blocks.push({ type: 'line', text: line });
  }

  if (inCodeBlock && currentCodeLines.length > 0) {
    blocks.push({ type: 'code', lang: codeLang, code: currentCodeLines.join('\n') });
  }

  return (
    <div className={`space-y-8 ${className}`}>
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div key={idx} className="tile my-16 p-16 font-mono text-caption text-ink overflow-x-auto">
              {block.lang && <div className="eyebrow font-sans mb-8">{block.lang}</div>}
              <pre className="whitespace-pre">{block.code}</pre>
            </div>
          );
        }

        const trimmed = block.text.trim();
        if (!trimmed) return null;

        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ');
        const isNumbered = /^\d+\.\s/.test(trimmed);

        let textToFormat = trimmed;
        if (isBullet) textToFormat = trimmed.replace(/^[-*•]\s+/, '');
        else if (isNumbered) textToFormat = trimmed.replace(/^\d+\.\s+/, '');

        return (
          <div key={idx} className={isBullet || isNumbered ? 'flex items-start gap-16' : ''}>
            {isBullet && (
              <span className="mt-[11px] w-[6px] h-[6px] rounded-full bg-ink flex-shrink-0" aria-hidden="true" />
            )}
            {isNumbered && (
              <span className="text-body font-medium text-ink tabular flex-shrink-0">
                {trimmed.match(/^\d+\./)[0]}
              </span>
            )}
            <span className="text-body text-graphite">{parseInlineMarkdown(textToFormat)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Full markdown renderer for executive-markdown notes (token-mapped prose).
// Drops a leading "# Title" when it repeats the page title shown above the notes.
export function stripDuplicateTitle(markdown, title) {
  if (!title) return markdown;
  const match = markdown.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
  if (!match || match[1].trim().toLowerCase() !== title.trim().toLowerCase()) return markdown;
  return markdown.slice(match[0].length);
}

export function MarkdownNoteView({ markdown, omitTitle }) {
  if (!markdown) return null;
  markdown = stripDuplicateTitle(markdown, omitTitle);
  return (
    <article className="prose max-w-none fade-in">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} onClick={(e) => openExternal(e, href)}>
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
