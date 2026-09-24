import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dmSansFont from '../../assets/fonts/DMSans-Variable.woff2?inline';
import { buildNotesMarkdown, notesTitle } from './copyMarkdown.js';
import { stripDuplicateTitle } from './markdown.jsx';
import { metaText } from './meta.js';
import { formatClock, formatDurationSeconds } from '../../lib/format.js';
import { meetingHostname } from '../../lib/platform.js';

// Builds the self-contained HTML that the main process prints to PDF. Notes go through the
// same react-markdown + remark-gfm pipeline as the in-app view (raw HTML stays disabled), and
// the page has its own always-light print stylesheet, independent of Tailwind and the theme.

const SENTIMENT_LABELS = { positive: 'Positive', neutral: 'Neutral', mixed: 'Mixed', tense: 'Tense' };

const STYLES = `
@font-face { font-family: 'DM Sans'; src: url(${dmSansFont}) format('woff2'); font-weight: 100 1000; font-style: normal; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body {
  font-family: 'DM Sans', 'Segoe UI', sans-serif; font-size: 10.5pt; line-height: 1.55;
  color: #1a1813; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc-header { padding-bottom: 12pt; margin-bottom: 16pt; border-bottom: 1pt solid #1a1813; }
.doc-header h1 { font-size: 22pt; line-height: 1.2; font-weight: 500; margin: 0; }
.meta { margin: 6pt 0 0; color: #707070; }
.tags { margin: 8pt 0 0; display: flex; flex-wrap: wrap; gap: 6pt; }
.tag { border: 0.75pt solid #9a968d; border-radius: 999px; padding: 1pt 8pt; font-size: 9pt; color: #57534b; }

h1, h2, h3, h4 { font-weight: 500; line-height: 1.3; break-after: avoid; page-break-after: avoid; }
.notes h1 { font-size: 17pt; margin: 20pt 0 8pt; }
.notes h2, .transcript h2 { font-size: 14pt; margin: 20pt 0 8pt; padding-bottom: 4pt; border-bottom: 0.75pt solid #d6d2c8; }
.notes h3 { font-size: 12pt; margin: 14pt 0 6pt; }
.notes h4 { font-size: 10.5pt; margin: 12pt 0 4pt; }
.notes > :first-child { margin-top: 0; }
p { margin: 0 0 8pt; }
strong { font-weight: 600; }
a { color: #1a1813; text-decoration: underline; text-underline-offset: 2pt; }

ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin: 2pt 0; break-inside: avoid; page-break-inside: avoid; }
li > ul, li > ol { margin: 2pt 0 0; }
li > p { margin: 0; }
ul.contains-task-list { list-style: none; padding-left: 2pt; }
li.task-list-item { list-style: none; }
/* Drawn by hand: Chromium greys out the disabled checkboxes remark-gfm emits. */
li.task-list-item > input[type="checkbox"] {
  -webkit-appearance: none; appearance: none; width: 9pt; height: 9pt; margin: 0 6pt 0 0;
  vertical-align: -1pt; border: 0.9pt solid #1a1813; border-radius: 2pt; background: #ffffff; opacity: 1;
}
li.task-list-item > input[type="checkbox"]:checked {
  background: #1a1813 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-4.9' fill='none' stroke='%23ffffff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% no-repeat;
}
li.task-list-item ul.contains-task-list { padding-left: 16pt; }

table { width: 100%; border-collapse: collapse; margin: 4pt 0 12pt; font-size: 9.5pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 0.75pt solid #cfcac0; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f0e8; font-weight: 600; }

code { font-family: 'Cascadia Code', Consolas, monospace; font-size: 9pt; background: #f3f0e8; border-radius: 3pt; padding: 0.5pt 3pt; }
pre { background: #f3f0e8; border-radius: 6pt; padding: 8pt 10pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 0 0 10pt; }
pre code { background: none; padding: 0; }
blockquote { margin: 0 0 10pt; padding: 2pt 0 2pt 10pt; border-left: 2pt solid #1a1813; color: #57534b; }
blockquote p { margin: 0; }
hr { border: none; border-top: 0.75pt solid #d6d2c8; margin: 14pt 0; }
img { max-width: 100%; }

.transcript { margin-top: 8pt; }
.seg { display: grid; grid-template-columns: 44pt 1fr; margin: 0 0 5pt; break-inside: avoid; page-break-inside: avoid; }
.ts { color: #707070; font-variant-numeric: tabular-nums; }
.speaker { font-weight: 600; margin-right: 4pt; }
`;

function notesBodyMarkdown(notes, session, title) {
  const markdown = notes?._rawMarkdown || buildNotesMarkdown(notes, session);
  return stripDuplicateTitle(markdown || '', title);
}

function PdfDocument({ session, notes, transcript, includeTranscript, title }) {
  const duration = session.duration_seconds > 0 ? formatDurationSeconds(session.duration_seconds) : null;
  const meta = metaText(session, notes, duration);
  const sentiment = SENTIMENT_LABELS[notes?.sentiment];
  const host = meetingHostname(session.meeting_url);
  const tags = [sentiment, host].filter(Boolean);
  const segments = includeTranscript ? (transcript || []).filter((s) => s?.text) : [];

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <header className="doc-header">
          <h1>{title}</h1>
          {meta && <p className="meta">{meta}</p>}
          {tags.length > 0 && (
            <p className="tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</p>
          )}
        </header>
        <main className="notes">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{notesBodyMarkdown(notes, session, title)}</ReactMarkdown>
        </main>
        {segments.length > 0 && (
          <section className="transcript">
            <h2>Transcript</h2>
            {segments.map((seg, i) => (
              <p key={i} className="seg">
                <span className="ts">{seg.startTime != null ? formatClock(seg.startTime) : ''}</span>
                <span>
                  <span className="speaker">{seg.speaker || 'Speaker'}</span>
                  {seg.text}
                </span>
              </p>
            ))}
          </section>
        )}
      </body>
    </html>
  );
}

export function buildPdfHtml(session, notes, transcript, { includeTranscript = false } = {}) {
  const title = notesTitle(notes, session);
  return '<!doctype html>' + renderToStaticMarkup(
    <PdfDocument
      session={session}
      notes={notes}
      transcript={transcript}
      includeTranscript={includeTranscript}
      title={title}
    />,
  );
}
