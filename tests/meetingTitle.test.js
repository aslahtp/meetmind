import { describe, it, expect } from 'vitest';
import { sourceMeetingTitle, applyMeetingTitle } from '../electron/services/meeting-title.js';
import { buildUserPrompt } from '../electron/services/notes-normalize.js';

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

describe('buildUserPrompt', () => {
  it('names the meeting title when there is one', () => {
    expect(buildUserPrompt('[00:00] A: hi', false, 'Weekly "Sync"')).toContain('titled "Weekly \\"Sync\\""');
    expect(buildUserPrompt('[00:00] A: hi', true)).not.toContain('titled');
  });

  it('keeps the word JSON in JSON mode', () => {
    expect(buildUserPrompt('t', false, 'Weekly Sync')).toContain('JSON');
  });
});
