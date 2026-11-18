/**
 * Website guide pages, run by scripts/build-site.sh on the assembled site folder:
 * - wraps each site/pages/<slug>.html (not the _-prefixed layout and CSS) in site/pages/_layout.html
 *   and writes it to <site folder>/<slug>/index.html;
 * - writes <site folder>/sitemap.xml with the home page and every guide, each guide's lastmod
 *   being the last commit that changed its source (or <date> while uncommitted);
 * - fails if the home page doesn't link to every guide.
 * Run: pnpm exec tsx scripts/build-site-pages.ts <site folder> <home page lastmod, YYYY-MM-DD>
 */

'use strict';

import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { SITE_URL, buildSitemap, pageUrl, parsePage, renderPage, sortPages, unlinkedFromHome } from './site-pages';

const PAGES_DIR = path.join(__dirname, '..', 'site', 'pages');

function lastCommitDate(file: string): string {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function main() {
  const [out, homeDate] = process.argv.slice(2);
  if (!out || !/^\d{4}-\d{2}-\d{2}$/.test(homeDate ?? '')) {
    throw new Error('Usage: pnpm exec tsx scripts/build-site-pages.ts <site folder> <YYYY-MM-DD>');
  }

  const layout = fs.readFileSync(path.join(PAGES_DIR, '_layout.html'), 'utf8');
  const css = fs.readFileSync(path.join(PAGES_DIR, '_page.css'), 'utf8');
  const files = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => path.join(PAGES_DIR, f));

  const pages = sortPages(
    files.map((file) => {
      const page = parsePage(fs.readFileSync(file, 'utf8'), path.relative(process.cwd(), file));
      return { ...page, lastmod: lastCommitDate(file) || homeDate };
    }),
  );
  const slugs = new Set<string>();
  for (const page of pages) {
    if (slugs.has(page.slug)) throw new Error(`Two guide pages use the slug "${page.slug}"`);
    slugs.add(page.slug);
  }

  for (const page of pages) {
    const dir = path.join(out, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(layout, css, page, pages, page.lastmod));
  }

  const unlinked = unlinkedFromHome(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), pages);
  if (unlinked.length) {
    throw new Error(`site/index.html doesn't link to these guides: ${unlinked.join(', ')}`);
  }

  fs.writeFileSync(
    path.join(out, 'sitemap.xml'),
    buildSitemap([
      { loc: SITE_URL, lastmod: homeDate },
      ...pages.map((p) => ({ loc: pageUrl(p.slug), lastmod: p.lastmod })),
    ]),
  );
  console.log(`Site pages: ${pages.length} guides (${pages.map((p) => p.slug).join(', ')}) and the sitemap`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
