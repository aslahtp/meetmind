import { describe, it, expect } from 'vitest';
import { stripDuplicateTitle, parseInlineMarkdown } from '../renderer/components/note/markdown.jsx';

describe('stripDuplicateTitle', () => {
  it('drops a leading H1 that repeats the page title (case-insensitive)', () => {
    expect(stripDuplicateTitle('# Weekly Sync\n\n## Agenda', 'weekly sync')).toBe('## Agenda');
  });

  it('keeps a different or missing title', () => {
    expect(stripDuplicateTitle('# Other\n\nBody', 'Weekly Sync')).toBe('# Other\n\nBody');
    expect(stripDuplicateTitle('## Agenda', 'Weekly Sync')).toBe('## Agenda');
    expect(stripDuplicateTitle('# Weekly Sync', undefined)).toBe('# Weekly Sync');
  });
});

describe('parseInlineMarkdown', () => {
  it('returns plain text unchanged', () => {
    expect(parseInlineMarkdown('just text')).toBe('just text');
  });

  it('splits inline code, bold and links into elements', () => {
    const parts = parseInlineMarkdown('Run `pnpm test` then **ship** via [docs](https://x.dev)');
    const types = parts.map((p) => (typeof p === 'string' ? 'text' : p.type));
    expect(types).toEqual(['text', 'code', 'text', 'strong', 'text', 'a']);
    expect(parts[1].props.children).toBe('pnpm test');
    expect(parts[5].props.href).toBe('https://x.dev');
  });
});
