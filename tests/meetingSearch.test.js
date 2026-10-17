import { describe, it, expect } from 'vitest';
import {
  searchSessions,
  highlightParts,
  tokenize,
  stem,
  editDistance,
} from '../renderer/lib/meetingSearch.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function session(overrides = {}) {
  return {
    id: 'sess',
    title: 'Untitled',
    started_at: '2026-10-01T09:00:00Z',
    status: 'complete',
    meeting_url: null,
    notes: null,
    transcript: [],
    ...overrides,
  };
}

const SESSIONS = [
  session({
    id: 'pricing',
    title: 'Pricing review',
    notes: {
      meeting_title: 'Pricing review',
      sections: [
        { heading: 'Pro tier', content: 'We **decided** to raise the Pro tier by 10% next quarter.' },
      ],
      action_items: [{ task: 'Update the plans page', owner: 'Priya', priority: 'high' }],
    },
  }),
  session({
    id: 'standup',
    title: 'Daily standup',
    started_at: '2026-10-02T09:00:00Z',
    notes: { _rawMarkdown: '## Blockers\n\nThe login bug crashes the app on Safari.' },
    transcript: [
      { speaker: 'A', text: 'I am stuck on the database migration.', startTime: 0 },
      { speaker: 'Rahul', text: 'The release is due on Friday.', startTime: 12 },
    ],
  }),
  session({
    id: 'hiring',
    title: 'Hiring sync',
    started_at: '2026-10-03T09:00:00Z',
    notes: { participants: [{ name: 'Anita', role: 'Recruiter' }], sections: [{ heading: 'Candidates', content: 'Two interviews booked.' }] },
    transcript: [{ speaker: 'Anita', text: 'നമുക്ക് അടുത്ത ആഴ്ച നോക്കാം, the budget is approved.', startTime: 3 }],
  }),
  session({
    id: 'mentions-pricing',
    title: 'Weekly catch-up',
    started_at: '2026-10-04T09:00:00Z',
    transcript: [{ speaker: 'B', text: 'Someone mentioned pricing briefly.', startTime: 5 }],
  }),
];

const ids = (results) => [...results.keys()];

// ── Text pipeline ─────────────────────────────────────────────────────────────

describe('text pipeline', () => {
  it('maps related word forms to one key', () => {
    expect(stem('decided')).toBe(stem('deciding'));
    expect(stem('pricing')).toBe(stem('price'));
    expect(stem('planned')).toBe(stem('plan'));
    expect(stem('agreed')).toBe(stem('agree'));
    expect(stem('issues')).toBe(stem('issue'));
    expect(stem('status')).toBe('status');
  });

  it('drops stop words and folds accents', () => {
    expect(tokenize('What did we decide about the café?')).toEqual([stem('decide'), stem('cafe')]);
  });

  it('keeps Malayalam words whole', () => {
    expect(tokenize('നമുക്ക് നോക്കാം')).toEqual(['നമുക്ക്', 'നോക്കാം']);
  });

  it('measures edit distance with transpositions', () => {
    expect(editDistance('pricing', 'pricnig')).toBe(1);
    expect(editDistance('budget', 'budgte')).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 2)).toBe(3);
  });
});

// ── Matching ──────────────────────────────────────────────────────────────────

describe('searchSessions — matching', () => {
  it('returns null for an empty query', () => {
    expect(searchSessions(SESSIONS, '   ')).toBeNull();
  });

  it('searches titles', () => {
    expect(ids(searchSessions(SESSIONS, 'standup'))).toEqual(['standup']);
  });

  it('searches note sections', () => {
    expect(ids(searchSessions(SESSIONS, 'quarter'))).toEqual(['pricing']);
  });

  it('searches action items and their owners', () => {
    expect(ids(searchSessions(SESSIONS, 'plans page'))).toEqual(['pricing']);
    expect(ids(searchSessions(SESSIONS, 'priya'))).toEqual(['pricing']);
  });

  it('searches Markdown notes', () => {
    expect(ids(searchSessions(SESSIONS, 'safari'))).toEqual(['standup']);
  });

  it('searches transcript text and speakers', () => {
    expect(ids(searchSessions(SESSIONS, 'migration'))).toEqual(['standup']);
    expect(ids(searchSessions(SESSIONS, 'rahul'))).toEqual(['standup']);
  });

  it('searches participants', () => {
    expect(ids(searchSessions(SESSIONS, 'recruiter'))).toEqual(['hiring']);
  });

  it('searches Malayalam transcript text', () => {
    expect(ids(searchSessions(SESSIONS, 'നോക്കാം'))).toEqual(['hiring']);
  });

  it('matches other forms of a word', () => {
    expect(ids(searchSessions(SESSIONS, 'decision'))).toContain('pricing');
    expect(ids(searchSessions(SESSIONS, 'crashing'))).toEqual(['standup']);
  });

  it('matches related words from the concept map', () => {
    expect(ids(searchSessions(SESSIONS, 'deadline'))).toEqual(['standup']); // "due"
    expect(ids(searchSessions(SESSIONS, 'blocker'))).toEqual(['standup']); // heading "Blockers"
    expect(ids(searchSessions(SESSIONS, 'recruiting'))).toEqual(['hiring']);
  });

  it('tolerates typos', () => {
    expect(ids(searchSessions(SESSIONS, 'migraton'))).toEqual(['standup']);
  });

  it('matches the last word as a prefix while typing', () => {
    expect(ids(searchSessions(SESSIONS, 'budg'))).toEqual(['hiring']);
    expect(searchSessions(SESSIONS, 'budg ').size).toBe(0);
  });

  it('requires every word of a short query', () => {
    expect(ids(searchSessions(SESSIONS, 'pricing safari'))).toEqual([]);
  });

  it('matches most words of a natural-language question', () => {
    const result = searchSessions(SESSIONS, 'what did we decide about the pro tier pricing launch');
    expect(ids(result)[0]).toBe('pricing');
  });

  it('requires quoted phrases verbatim', () => {
    expect(ids(searchSessions(SESSIONS, '"login bug"'))).toEqual(['standup']);
    expect(searchSessions(SESSIONS, '"bug login"').size).toBe(0);
  });

  it('keeps literal title matching', () => {
    expect(ids(searchSessions(SESSIONS, 'catch-u'))).toEqual(['mentions-pricing']);
  });
});

// ── Ranking + snippets ────────────────────────────────────────────────────────

describe('searchSessions — ranking and snippets', () => {
  it('ranks a title match above a transcript mention', () => {
    const result = searchSessions(SESSIONS, 'pricing');
    expect(result.get('pricing').score).toBeGreaterThan(result.get('mentions-pricing').score);
  });

  it('describes where the match was found', () => {
    const match = searchSessions(SESSIONS, 'migration').get('standup');
    expect(match.label).toBe('Transcript · Speaker A');
    expect(match.snippet).toBe('I am stuck on the database migration.');
  });

  it('shows an action item with its owner', () => {
    const match = searchSessions(SESSIONS, 'priya').get('pricing');
    expect(match.label).toBe('Action item');
    expect(match.snippet).toBe('Update the plans page (Priya)');
  });

  it('finds action items with a due date by "deadline"', () => {
    const s = session({ id: 'due', notes: { action_items: [{ task: 'Ship beta notes', owner: 'Anjali', due: 'Thu' }] } });
    expect(searchSessions([s], 'deadline').get('due').snippet).toBe('Ship beta notes (Anjali, due Thu)');
  });

  it('strips Markdown from snippets', () => {
    expect(searchSessions(SESSIONS, 'raise').get('pricing').snippet).not.toContain('**');
  });

  it('shows Markdown table rows as cells, under their heading, ignoring header rows', () => {
    const md = session({
      id: 'md',
      notes: { _rawMarkdown: '## Action Items\n\n| Task | Owner | Deadline |\n| :--- | :--- | :--- |\n| Submit build | Rahul | Monday |' },
    });
    expect(searchSessions([md], 'submit').get('md')).toMatchObject({
      label: 'Notes · Action Items',
      snippet: 'Submit build · Rahul · Monday',
    });
    expect(searchSessions([md], 'deadline').size).toBe(0);
  });

  it('has no snippet for a title-only match', () => {
    expect(searchSessions(SESSIONS, 'daily').get('standup').snippet).toBeNull();
  });

  it('trims long passages around the first hit', () => {
    const long = `${'filler words here '.repeat(20)}the kubernetes cluster ${'more filler '.repeat(20)}`;
    const match = searchSessions([session({ id: 'x', transcript: [{ speaker: 'A', text: long }] })], 'kubernetes').get('x');
    expect(match.snippet.startsWith('…')).toBe(true);
    expect(match.snippet.endsWith('…')).toBe(true);
    expect(match.snippet).toContain('kubernetes');
    expect(match.snippet.length).toBeLessThanOrEqual(170);
  });
});

describe('highlightParts', () => {
  it('marks every form of a matched word', () => {
    const { terms } = searchSessions(SESSIONS, 'crash').get('standup');
    expect(highlightParts('Crashes and crashing', terms)).toEqual([
      { text: 'Crashes', hit: true },
      { text: ' and ', hit: false },
      { text: 'crashing', hit: true },
    ]);
  });

  it('returns the text unmarked without terms', () => {
    expect(highlightParts('hello', new Set())).toEqual([{ text: 'hello', hit: false }]);
  });
});
