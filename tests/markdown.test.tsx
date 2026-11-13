import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { stripDuplicateTitle, parseInlineMarkdown } from '../renderer/components/note/markdown';

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

interface ElementProps {
  children?: unknown;
  href?: string;
}
type Part = string | ReactElement<ElementProps>;

describe('parseInlineMarkdown', () => {
  it('returns plain text unchanged', () => {
    expect(parseInlineMarkdown('just text')).toBe('just text');
  });

  it('splits inline code, bold and links into elements', () => {
    const parts = parseInlineMarkdown('Run `pnpm test` then **ship** via [docs](https://x.dev)') as Part[];
    const types = parts.map((p) => (typeof p === 'string' ? 'text' : p.type));
    expect(types).toEqual(['text', 'code', 'text', 'strong', 'text', 'a']);
    expect((parts[1] as ReactElement<ElementProps>).props.children).toBe('pnpm test');
    expect((parts[5] as ReactElement<ElementProps>).props.href).toBe('https://x.dev');
  });
});
