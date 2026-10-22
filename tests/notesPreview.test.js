import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildNotesPreview } = require('../electron/services/notes-normalize.js');
const { llmRegistry } = require('../electron/providers/index.js');
const { generateNotes } = require('../electron/services/notes.js');

const FULL_JSON = JSON.stringify({
  title: 'Q4 roadmap sync',
  attendees: [{ label: 'Speaker 1', name: 'Ana', role: 'PM' }],
  sections: [{ heading: 'Budget', content: 'We **agreed** to cut scope.' }],
  action_items: [{ owner: 'Ana', tasks: ['Ship the beta', 'Write the docs'] }],
}, null, 2);

describe('buildNotesPreview (Markdown)', () => {
  it('returns nothing until there is text past an opening fence', () => {
    expect(buildNotesPreview('', true)).toBeNull();
    expect(buildNotesPreview('```mark', true)).toBeNull();
  });

  it('strips an opening fence and a closing fence that is still arriving', () => {
    expect(buildNotesPreview('```markdown\n# Sync\n\n- **Ow', true)).toEqual({
      _rawMarkdown: '# Sync\n\n- **Ow', title: 'Sync', meeting_title: 'Sync',
    });
    expect(buildNotesPreview('```markdown\n# Sync\n\nBody\n``', true)._rawMarkdown).toBe('# Sync\n\nBody');
  });
});

describe('buildNotesPreview (JSON)', () => {
  it('returns null for text that is not a JSON object yet', () => {
    expect(buildNotesPreview('```json', false)).toBeNull();
    expect(buildNotesPreview('Sure! Here are', false)).toBeNull();
  });

  it('normalizes partial JSON at every cut point without throwing', () => {
    for (let n = 1; n <= FULL_JSON.length; n++) {
      const notes = buildNotesPreview(`\`\`\`json\n${FULL_JSON.slice(0, n)}`, false);
      if (!notes) continue;
      expect(Array.isArray(notes.action_items)).toBe(true);
      expect(Array.isArray(notes.topics)).toBe(true);
      expect(Array.isArray(notes.participants)).toBe(true);
    }
  });

  it('shows a half-written title, topic and task as they stream', () => {
    const cut = (marker) => FULL_JSON.slice(0, FULL_JSON.indexOf(marker) + marker.length);
    expect(buildNotesPreview(cut('Q4 road'), false).title).toBe('Q4 road');
    expect(buildNotesPreview(cut('We **agr'), false).topics).toEqual([
      expect.objectContaining({ heading: 'Budget', content: 'We **agr' }),
    ]);
    expect(buildNotesPreview(cut('Ship the'), false).action_items).toEqual([
      { task: 'Ship the', owner: 'Ana', priority: null, due: null },
    ]);
  });

  it('drops a topic that has only just opened', () => {
    const notes = buildNotesPreview(FULL_JSON.slice(0, FULL_JSON.indexOf('"heading"')), false);
    expect(notes.topics).toEqual([]);
  });
});

describe('generateNotes onPreview', () => {
  const transcript = [{ speaker: 'Speaker 1', text: 'hello', startTime: 0 }];
  const config = {
    geminiApiKey: 'g', groqApiKey: 'k', noteOutputMode: 'markdown',
    llmProvider: 'groq', llmModels: {}, llmFallback: { provider: 'gemini', model: 'gemini-3.7-flash' },
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends throttled snapshots of the notes streamed so far', async () => {
    vi.useFakeTimers();
    vi.spyOn(llmRegistry.get('groq'), 'generate').mockImplementation(async ({ onText }) => {
      onText('# Ti');
      vi.advanceTimersByTime(0);
      onText('tle\n\nBo');
      onText('dy');
      vi.advanceTimersByTime(50); // still inside the interval
      vi.advanceTimersByTime(50);
      return '# Title\n\nBody';
    });
    const previews = [];
    await generateNotes(transcript, config, { onPreview: (p) => previews.push(p) });
    expect(previews.map((p) => p.notes?._rawMarkdown ?? null)).toEqual([null, '# Ti', '# Title\n\nBody']);
    expect(previews[0]).toMatchObject({ attempt: 0, provider: 'groq', model: 'llama-3.3-70b-versatile' });
  });

  it('applies the meeting title to the preview', async () => {
    vi.useFakeTimers();
    vi.spyOn(llmRegistry.get('groq'), 'generate').mockImplementation(async ({ onText }) => {
      onText('# Invented\n\nBody');
      vi.advanceTimersByTime(0);
      return '# Invented\n\nBody';
    });
    const previews = [];
    await generateNotes(transcript, config, { meetingTitle: 'Weekly Sync', onPreview: (p) => previews.push(p) });
    expect(previews[1].notes._rawMarkdown).toBe('# Weekly Sync\n\nBody');
  });

  it('starts the fallback with a clean preview and drops the failed attempt\'s pending update', async () => {
    vi.useFakeTimers();
    vi.spyOn(llmRegistry.get('groq'), 'generate').mockImplementation(async ({ onText }) => {
      onText('# Half');
      vi.advanceTimersByTime(0);
      onText(' written');
      throw new Error('429');
    });
    vi.spyOn(llmRegistry.get('gemini'), 'generate').mockImplementation(async ({ onText }) => {
      onText('# Fallback');
      vi.advanceTimersByTime(0);
      return '# Fallback';
    });
    const previews = [];
    const res = await generateNotes(transcript, config, { onPreview: (p) => previews.push(p) });
    vi.runAllTimers();
    expect(res.provider).toBe('gemini');
    expect(previews.map((p) => [p.attempt, p.notes?._rawMarkdown ?? null])).toEqual([
      [0, null], [0, '# Half'], [1, null], [1, '# Fallback'],
    ]);
  });
});
