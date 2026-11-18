import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildJsonLd,
  buildSitemap,
  escapeHtml,
  pageUrl,
  parsePage,
  renderPage,
  sortPages,
  unlinkedFromHome,
  type PageMeta,
} from '../scripts/site-pages';

const META: PageMeta = {
  slug: 'windows',
  order: 2,
  title: 'AI Meeting Notes App for Windows | MeetMind',
  description: 'Free, open-source AI note taker for Windows 10 and 11 that records calls with no bot in the meeting.',
  crumb: 'Windows',
  label: 'MeetMind for Windows',
  summary: 'Install and record on Windows.',
};

// Loosely typed on purpose: some tests pass invalid metadata.
function source(meta: Record<string, unknown>, content = '<h1>Title</h1><p>Body</p>'): string {
  return `<!--\n${JSON.stringify({ ...META, ...meta })}\n-->\n${content}\n`;
}

describe('parsePage', () => {
  it('reads the metadata and the content after it', () => {
    const page = parsePage(source({}), 'windows.html');
    expect(page.slug).toBe('windows');
    expect(page.order).toBe(2);
    expect(page.content).toBe('<h1>Title</h1><p>Body</p>');
  });

  it('rejects a page without metadata', () => {
    expect(() => parsePage('<h1>Title</h1>', 'x.html')).toThrow(/metadata/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePage('<!-- { slug: "x" } -->\n<h1>x</h1>', 'x.html')).toThrow(/not valid JSON/);
  });

  it('rejects bad slugs', () => {
    expect(() => parsePage(source({ slug: 'Windows Guide' }), 'x.html')).toThrow(/slug/);
    expect(() => parsePage(source({ slug: '-windows' }), 'x.html')).toThrow(/slug/);
  });

  it('rejects titles and descriptions search results would cut or that are too thin', () => {
    expect(() => parsePage(source({ title: 'x'.repeat(66) }), 'x.html')).toThrow(/title is 66/);
    expect(() => parsePage(source({ description: 'Too short.' }), 'x.html')).toThrow(/description/);
    expect(() => parsePage(source({ description: 'x'.repeat(161) }), 'x.html')).toThrow(/description is 161/);
  });

  it('rejects missing fields and a non-numeric order', () => {
    expect(() => parsePage(source({ label: '' }), 'x.html')).toThrow(/"label"/);
    expect(() => parsePage(source({ order: '1' }), 'x.html')).toThrow(/"order"/);
  });

  it('needs exactly one h1', () => {
    expect(() => parsePage(source({}, '<p>No heading</p>'), 'x.html')).toThrow(/<h1>/);
    expect(() => parsePage(source({}, '<h1>a</h1><h1 class="x">b</h1>'), 'x.html')).toThrow(/more than one/);
  });
});

describe('renderPage', () => {
  const layout =
    '<title>{{title}}</title><meta content="{{description}}"><link href="{{url}}">' +
    '<script>{{jsonLd}}</script><style>{{css}}</style><b>{{crumb}}</b>{{content}}<ul>{{related}}</ul>' +
    '<nav>{{footerGuides}}</nav><time>{{dateModified}}</time>';
  const other: PageMeta = { ...META, slug: 'mac', order: 1, label: 'Mac & more', summary: 'macOS <beta>' };

  it('fills every placeholder and links the other guides', () => {
    const page = { ...parsePage(source({}), 'windows.html') };
    const html = renderPage(layout, ' body{} ', page, [other, page], '2026-11-18');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain('<link href="https://aslahtp.github.io/meetmind/windows/">');
    expect(html).toContain('<style>body{}</style>');
    expect(html).toContain('<a href="/meetmind/mac/"><strong>Mac &amp; more</strong><span>macOS &lt;beta&gt;</span></a>');
    // Related cards leave out the page itself; the footer marks it as current.
    expect(html).not.toContain('<a href="/meetmind/windows/"><strong>');
    expect(html).toContain('<a href="/meetmind/windows/" aria-current="page">');
    expect(html).toContain('<time>2026-11-18</time>');
  });

  it("doesn't expand placeholder-like text inside the content", () => {
    const page = parsePage(source({}, '<h1>T</h1><p>{{title}}</p>'), 'x.html');
    expect(renderPage(layout, '', page, [page], '2026-11-18')).toContain('<p>{{title}}</p>');
  });

  it('fails on an unknown placeholder', () => {
    const page = parsePage(source({}), 'x.html');
    expect(() => renderPage('{{nope}}', '', page, [page], '2026-11-18')).toThrow(/\{\{nope\}\}/);
  });
});

describe('buildJsonLd', () => {
  it('describes the page and its breadcrumb, linked to the home page entities', () => {
    const graph = JSON.parse(buildJsonLd(META, '2026-11-18')) as { '@graph': Record<string, unknown>[] };
    const [webPage, breadcrumb] = graph['@graph'];
    expect(webPage['@type']).toBe('WebPage');
    expect(webPage.url).toBe(pageUrl('windows'));
    expect(webPage.about).toEqual({ '@id': 'https://aslahtp.github.io/meetmind/#app' });
    expect(breadcrumb['@type']).toBe('BreadcrumbList');
    expect(breadcrumb.itemListElement).toHaveLength(2);
  });

  it('never closes the script element early', () => {
    expect(buildJsonLd({ ...META, title: 'a </script> b' }, '2026-11-18')).not.toContain('</script>');
  });
});

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  it('sorts by order, then slug', () => {
    const pages = [
      { ...META, slug: 'b', order: 2 },
      { ...META, slug: 'a', order: 2 },
      { ...META, slug: 'c', order: 1 },
    ];
    expect(sortPages(pages).map((p) => p.slug)).toEqual(['c', 'a', 'b']);
  });

  it('builds a sitemap', () => {
    const xml = buildSitemap([{ loc: 'https://aslahtp.github.io/meetmind/', lastmod: '2026-11-18' }]);
    expect(xml).toContain('<loc>https://aslahtp.github.io/meetmind/</loc>');
    expect(xml).toContain('<lastmod>2026-11-18</lastmod>');
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('finds guides the home page does not link to', () => {
    const pages = [META, { ...META, slug: 'mac' }, { ...META, slug: 'linux' }];
    expect(unlinkedFromHome('<a href="windows/">W</a><a href="/meetmind/mac/">M</a>', pages)).toEqual(['linux']);
  });
});

describe('site/pages', () => {
  // The real guide pages must all pass the checks the site build applies.
  const dir = path.join(__dirname, '..', 'site', 'pages');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_'));
  const pages = files.map((f) => parsePage(fs.readFileSync(path.join(dir, f), 'utf8'), f));

  it('parses every guide with a unique slug and order', () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.order)).size).toBe(pages.length);
  });

  it('is linked from the home page', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
    expect(unlinkedFromHome(home, pages)).toEqual([]);
  });

  it('only links to guides that exist', () => {
    const slugs = new Set(pages.map((p) => p.slug));
    for (const page of pages) {
      for (const [, slug] of page.content.matchAll(/href="\/meetmind\/([a-z0-9-]+)\/"/g)) {
        expect(slugs, `${page.slug} links to /meetmind/${slug}/`).toContain(slug);
      }
    }
  });
});
