import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SummaryJson from '../renderer/components/note/SummaryJson';
import { buildNotesMarkdown } from '../renderer/components/note/copyMarkdown';

import { toText, toTextList, sanitizeNotes, sanitizeTranscript } from '../electron/services/notes-sanitize';
import { normalizeNotes } from '../electron/services/notes-normalize';

// Notes an LLM could return: valid JSON, wrong types in the fields the UI prints.
function badNotes() {
  return {
    title: 'Sync',
    sentiment: { label: 'positive' },
    participants: [{ label: 'Speaker 1', name: { first: 'Ana' }, role: ['PM', 'Lead'], identity_confidence: 3 }, 'Ben', null],
    action_items: [
      { task: 'Ship it', owner: { name: 'Ana' }, priority: 2, due: ['Mon', 'Tue'] },
      'Write the docs',
      42,
    ],
    sections: [
      { heading: { text: 'Budget' }, content: ['We agreed', 'to cut scope'], decision: 7, options_discussed: 'Only one', open_questions: [{ q: 1 }, 'Who owns it?'] },
      null,
      'A bare string topic',
    ],
    status_update: { completion_estimate: 80, remaining_scope: 'QA' },
    notable_mentions: 'A risk',
  };
}

describe('toText / toTextList', () => {
  it('keeps strings, prints numbers and booleans, joins lists and drops objects', () => {
    expect(toText('a')).toBe('a');
    expect(toText(3)).toBe('3');
    expect(toText(false)).toBe('false');
    expect(toText(['a', 2, { x: 1 }])).toBe('a, 2');
    expect(toText({ x: 1 })).toBeNull();
    expect(toText(null)).toBeNull();
  });

  it('makes a list of strings out of anything', () => {
    expect(toTextList(['a', '', 2, null, { x: 1 }])).toEqual(['a', '2']);
    expect(toTextList('one')).toEqual(['one']);
    expect(toTextList({ x: 1 })).toEqual([]);
    expect(toTextList(undefined)).toEqual([]);
  });
});

describe('sanitizeNotes', () => {
  it('coerces every displayed field to text or a list of text', () => {
    const notes = sanitizeNotes(badNotes());
    expect(notes.sentiment).toBeNull();
    expect(notes.participants).toEqual([
      { label: 'Speaker 1', name: null, role: 'PM, Lead', identity_confidence: '3' },
      { label: 'Ben', name: 'Ben' },
    ]);
    expect(notes.action_items).toEqual([
      { task: 'Ship it', owner: null, priority: '2', due: 'Mon, Tue' },
      { task: 'Write the docs' },
      { task: '42' },
    ]);
    expect(notes.sections).toEqual([
      { heading: null, content: 'We agreed, to cut scope', decision: '7', options_discussed: ['Only one'], open_questions: ['Who owns it?'] },
      { heading: '', content: 'A bare string topic', summary: 'A bare string topic' },
    ]);
    expect(notes.status_update).toEqual({ completion_estimate: '80', remaining_scope: ['QA'] });
    expect(notes.notable_mentions).toEqual(['A risk']);
  });

  it('adds nothing to notes that lack a field, so Markdown notes stay as they are', () => {
    const markdown = { _rawMarkdown: '# Sync\n\nBody', title: 'Sync', meeting_title: 'Sync' };
    expect(sanitizeNotes({ ...markdown })).toEqual(markdown);
    expect(sanitizeNotes(null)).toBeNull();
    expect(sanitizeNotes('text')).toBe('text');
  });

  it('keeps a status update written as plain text', () => {
    expect(sanitizeNotes({ status_update: 'On track' }).status_update).toBe('On track');
  });

  it('is idempotent', () => {
    const once = sanitizeNotes(badNotes());
    expect(sanitizeNotes(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('sanitizeTranscript', () => {
  it('keeps segments as objects with text and speaker as text', () => {
    expect(sanitizeTranscript([{ speaker: 1, text: 'Hi', startTime: 0 }, null, 'loose', { speaker: { id: 2 }, text: ['a', 'b'] }]))
      .toEqual([{ speaker: '1', text: 'Hi', startTime: 0 }, { speaker: null, text: 'a, b' }]);
    expect(sanitizeTranscript('nope')).toEqual([]);
  });
});

// These threw while rendering before, which blanked the whole window.
describe('wrongly typed notes render', () => {
  it('as the notes page', () => {
    const html = renderToStaticMarkup(React.createElement(SummaryJson, { notes: normalizeNotes(badNotes()) }));
    expect(html).toContain('Ship it');
    expect(html).toContain('We agreed, to cut scope');
    expect(html).toContain('Who owns it?');
  });

  it('as Markdown', () => {
    const md = buildNotesMarkdown(normalizeNotes(badNotes()), { title: 'Sync' });
    expect(md).toContain('- [ ] Ship it (Due: Mon, Tue) (Priority: 2)');
    expect(md).toContain('- **Completion Estimate:** 80');
  });
});
