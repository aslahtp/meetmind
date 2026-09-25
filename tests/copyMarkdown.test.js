import { describe, it, expect } from 'vitest';
import {
  buildNotesMarkdown,
  parseNotesMarkdown,
  getTopics,
  actionItemText,
  notesTitle,
} from '../renderer/components/note/copyMarkdown.js';

const structuredNotes = {
  meeting_title: 'Q4 Roadmap Sync',
  participants: [
    { name: 'Asha', label: 'Speaker 1', role: 'PM', identity_confidence: 'high' },
    { name: 'Ravi' },
  ],
  status_update: { completion_estimate: '70%', remaining_scope: ['Auth', 'Billing'] },
  action_items: [
    { task: 'Ship the auth flow', owner: 'Ravi', due: 'Friday', priority: 'high' },
    { task: 'Write release notes', done: true },
  ],
  sections: [
    {
      heading: 'Environment focus',
      content: 'Stabilise `dev` before staging.',
      options_discussed: ['Freeze staging', 'Parallel rollout'],
      decision: 'Freeze staging until dev bugs are fixed.',
      open_questions: ['Who owns the rollback plan?'],
    },
  ],
  notable_mentions: ['CI is flaky on Windows'],
};

describe('buildNotesMarkdown', () => {
  it('renders every structured section', () => {
    const md = buildNotesMarkdown(structuredNotes);
    expect(md).toMatch(/^# Q4 Roadmap Sync\n/);
    expect(md).toContain('- Asha (Speaker 1) — PM [high]');
    expect(md).toContain('- **Completion Estimate:** 70%');
    expect(md).toContain('- [ ] Ship the auth flow (@Ravi) (Due: Friday) (Priority: High)');
    expect(md).toContain('- [x] Write release notes');
    expect(md).toContain('### 1. Environment focus');
    expect(md).toContain('**Decision:** Freeze staging until dev bugs are fixed.');
    expect(md).toContain('## Notable Mentions\n- CI is flaky on Windows');
  });

  it('returns raw Markdown notes untouched', () => {
    expect(buildNotesMarkdown({ _rawMarkdown: '# Hi\n\nBody' })).toBe('# Hi\n\nBody');
  });

  it('returns an empty string without notes', () => {
    expect(buildNotesMarkdown(null)).toBe('');
  });
});

describe('parseNotesMarkdown', () => {
  it('round-trips structured notes through Markdown', () => {
    const parsed = parseNotesMarkdown(buildNotesMarkdown(structuredNotes), structuredNotes);

    expect(parsed.meeting_title).toBe('Q4 Roadmap Sync');
    expect(parsed._rawMarkdown).toBeUndefined();
    expect(parsed.participants).toEqual([
      { name: 'Asha', label: 'Speaker 1', role: 'PM', identity_confidence: 'high' },
      { name: 'Ravi' },
    ]);
    expect(parsed.attendees).toEqual(['Asha', 'Ravi']);
    expect(parsed.status_update).toEqual(structuredNotes.status_update);
    expect(parsed.action_items).toEqual([
      { task: 'Ship the auth flow', owner: 'Ravi', due: 'Friday', priority: 'high' },
      { task: 'Write release notes', done: true },
    ]);
    expect(parsed.notable_mentions).toEqual(['CI is flaky on Windows']);

    const [topic] = parsed.sections;
    expect(topic.heading).toBe('Environment focus');
    expect(topic.content).toBe('Stabilise `dev` before staging.');
    expect(topic.options_discussed).toEqual(['Freeze staging', 'Parallel rollout']);
    expect(topic.decision).toBe('Freeze staging until dev bugs are fixed.');
    expect(topic.open_questions).toEqual(['Who owns the rollback plan?']);
  });

  it('keeps unknown sections as extra topics', () => {
    const parsed = parseNotesMarkdown('# T\n\n## Action Items\n- [ ] Do it\n\n## Risks\nVendor delay', {});
    expect(parsed.action_items).toEqual([{ task: 'Do it' }]);
    expect(parsed.sections.map((s) => s.heading)).toEqual(['Risks']);
    expect(parsed.sections[0].content).toBe('Vendor delay');
  });

  it('falls back to raw Markdown when no known section is present', () => {
    const md = '# Standup\n\n## Summary\nAll good.';
    const parsed = parseNotesMarkdown(md, { sections: [{ heading: 'old' }], sentiment: 'positive' });
    expect(parsed._rawMarkdown).toBe(md);
    expect(parsed.title).toBe('Standup');
    expect(parsed.sections).toBeUndefined();
    expect(parsed.sentiment).toBe('positive');
  });

  it('ignores headings inside code fences', () => {
    const md = '# T\n\n## Action Items\n- [ ] Real task\n\n## Snippet\n```\n## Participants\n- Fake\n```';
    const parsed = parseNotesMarkdown(md, {});
    expect(parsed.participants).toEqual([]);
    expect(parsed.action_items).toEqual([{ task: 'Real task' }]);
    expect(parsed.sections.map((s) => s.heading)).toEqual(['Snippet']);
    expect(parsed.sections[0].content).toContain('## Participants');
  });
});

describe('note accessors', () => {
  it('prefers sections, then topics, then key points, dropping empty entries', () => {
    expect(getTopics({ sections: [{ heading: 'A' }, {}], topics: [{ heading: 'B' }] })).toEqual([{ heading: 'A' }]);
    expect(getTopics({ topics: [{ summary: 'B' }] })).toEqual([{ summary: 'B' }]);
    expect(getTopics({ key_points: [{ content: 'C' }] })).toEqual([{ content: 'C' }]);
    expect(getTopics(null)).toEqual([]);
  });

  it('reads action item text from any of its field names', () => {
    expect(actionItemText({ description: 'x' })).toBe('x');
    expect(actionItemText({ action: 'y' })).toBe('y');
    expect(actionItemText(undefined)).toBe('');
  });

  it('falls back from notes title to session title to a default', () => {
    expect(notesTitle({ title: 'A' }, { title: 'B' })).toBe('A');
    expect(notesTitle({}, { title: 'B' })).toBe('B');
    expect(notesTitle(null, null)).toBe('Meeting Notes');
  });
});
