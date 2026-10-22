import { describe, it, expect } from 'vitest';
import { cleanTitle, sourceMeetingTitle, applyMeetingTitle } from '../electron/services/meeting-title.js';
import { buildUserPrompt } from '../electron/services/notes-normalize.js';

describe('cleanTitle', () => {
  it('keeps any name the user typed, on one line', () => {
    expect(cleanTitle('  Zoom Meeting\n with   Sam ')).toBe('Zoom Meeting with Sam');
    expect(cleanTitle('Meet - Standup')).toBe('Meet - Standup');
    expect(cleanTitle('   ')).toBe('');
    expect(cleanTitle('y'.repeat(300))).toHaveLength(200);
  });
});

describe('sourceMeetingTitle', () => {
  it('keeps a real meeting name', () => {
    expect(sourceMeetingTitle('Weekly Sync')).toBe('Weekly Sync');
    expect(sourceMeetingTitle('  Q3   planning ')).toBe('Q3 planning');
  });

  it('strips the Meet prefix and Teams suffix of raw tab titles', () => {
    expect(sourceMeetingTitle('Meet - Weekly Sync')).toBe('Weekly Sync');
    expect(sourceMeetingTitle('Google Meet – Design review')).toBe('Design review');
    expect(sourceMeetingTitle('Standup | Microsoft Teams')).toBe('Standup');
  });

  it('drops placeholders, app names and ad-hoc Meet codes', () => {
    for (const t of ['', null, undefined, 'Untitled Meeting', 'Pasted Transcript', 'Google Meet',
      'meet.google.com', 'Zoom Meeting', 'Zoom Workplace', 'Microsoft Teams', 'Chat | Microsoft Teams',
      'abc-defg-hij', 'Meet - abc-defg-hij']) {
      expect(sourceMeetingTitle(t)).toBe('');
    }
  });

  it('caps very long titles', () => {
    expect(sourceMeetingTitle('x'.repeat(500))).toHaveLength(200);
  });
});

describe('applyMeetingTitle', () => {
  it('replaces the LLM title in structured notes', () => {
    const notes = applyMeetingTitle({ title: 'Invented', meeting_title: 'Invented' }, 'Weekly Sync');
    expect(notes.title).toBe('Weekly Sync');
    expect(notes.meeting_title).toBe('Weekly Sync');
  });

  it('rewrites the Markdown heading, or adds one', () => {
    const md = applyMeetingTitle({ _rawMarkdown: '# Invented\n\nBody $1', title: 'Invented' }, 'Weekly $& Sync');
    expect(md._rawMarkdown).toBe('# Weekly $& Sync\n\nBody $1');
    const bare = applyMeetingTitle({ _rawMarkdown: 'Body', title: 'Meeting Notes' }, 'Weekly Sync');
    expect(bare._rawMarkdown).toBe('# Weekly Sync\n\nBody');
  });

  it('leaves notes alone without a meeting title', () => {
    const notes = { title: 'Invented', meeting_title: 'Invented' };
    expect(applyMeetingTitle(notes, '')).toEqual({ title: 'Invented', meeting_title: 'Invented' });
  });
});

describe('long meeting titles', () => {
  const LONG = 'Quarterly business review with the regional sales, marketing, customer success and finance leads covering Q3 results, the Q4 pipeline, hiring plan, budget re-forecast, and the Malayalam localisation rollout timeline for India';

  it('caps at 200 characters with no trailing space', () => {
    const out = cleanTitle(LONG);
    expect(LONG.length).toBeGreaterThan(200);
    expect(out).toHaveLength(200);
    expect(LONG.startsWith(out)).toBe(true);
    // A cut that lands on a space doesn't leave it dangling.
    expect(cleanTitle(`${'a'.repeat(199)} bcd`)).toBe('a'.repeat(199));
  });

  it('counts emoji and Malayalam as characters, never splitting a surrogate pair', () => {
    const emoji = cleanTitle(`${'a'.repeat(199)}🚀🚀`);
    expect(Array.from(emoji)).toHaveLength(200);
    expect(emoji.endsWith('🚀')).toBe(true);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF]$/);

    const malayalam = cleanTitle('പ്രതിവാര യോഗം '.repeat(30));
    expect(Array.from(malayalam).length).toBeLessThanOrEqual(200);
    expect(malayalam.startsWith('പ്രതിവാര യോഗം')).toBe(true);
  });

  it('strips the Meet prefix before capping a long tab title', () => {
    const out = sourceMeetingTitle(`Meet - ${LONG}`);
    expect(out).toHaveLength(200);
    expect(out.startsWith('Quarterly business review')).toBe(true);
  });

  it('keeps a long unbroken title intact under the cap', () => {
    const unbroken = 'Sync-on-https://meet.google.com/abc-defg-hij-with-the-platform-team-about-INCIDENT-2026-10-22-database-failover-postmortem-and-followups';
    expect(sourceMeetingTitle(unbroken)).toBe(unbroken);
  });

  it('puts the whole long title in the Markdown heading and the prompt', () => {
    const title = cleanTitle(LONG);
    const md = applyMeetingTitle({ _rawMarkdown: '# Short\n\n## Agenda\n- x', title: 'Short' }, title);
    expect(md._rawMarkdown.split('\n')[0]).toBe(`# ${title}`);
    expect(md._rawMarkdown).toContain('## Agenda');
    expect(buildUserPrompt('t', true, title)).toContain(JSON.stringify(title));
  });
});

describe('buildUserPrompt', () => {
  it('names the meeting title when there is one', () => {
    expect(buildUserPrompt('[00:00] A: hi', false, 'Weekly "Sync"')).toContain('titled "Weekly \\"Sync\\""');
    expect(buildUserPrompt('[00:00] A: hi', true)).not.toContain('titled');
  });

  it('keeps the word JSON in JSON mode', () => {
    expect(buildUserPrompt('t', false, 'Weekly Sync')).toContain('JSON');
  });
});
