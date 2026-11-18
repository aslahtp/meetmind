/**
 * Pure helpers behind scripts/build-site-pages.ts: parse a guide page from site/pages/, wrap it in
 * the shared layout, and build the sitemap. Kept free of file and git access so tests/ can cover it.
 *
 * A guide page is an HTML fragment that starts with its metadata as JSON in a comment:
 *
 *   <!--
 *   { "slug": "windows", "order": 5, "title": "…", "description": "…", "crumb": "Windows",
 *     "label": "MeetMind for Windows", "summary": "…" }
 *   -->
 *   <section>…</section>
 *
 * and is published at https://aslahtp.github.io/meetmind/<slug>/.
 */

export const SITE_URL = 'https://aslahtp.github.io/meetmind/';

/** Google shows roughly 60 characters of a title and 155–160 of a description. */
export const TITLE_MAX = 65;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

export interface PageMeta {
  /** URL path segment: lowercase letters, digits and hyphens. */
  slug: string;
  /** Position in the footer and "More guides" lists. */
  order: number;
  /** <title>, also og:title and the WebPage name. */
  title: string;
  /** Meta description, also og:description. */
  description: string;
  /** Last breadcrumb item. */
  crumb: string;
  /** Link text in other pages' footers and "More guides" cards. */
  label: string;
  /** One line under the label in "More guides" cards. */
  summary: string;
}

export interface SitePage extends PageMeta {
  content: string;
}

const FRONT_MATTER = /^\s*<!--\s*(\{[\s\S]*?\})\s*-->\s*/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireString(meta: Record<string, unknown>, key: keyof PageMeta, file: string): string {
  const value = meta[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${file}: "${key}" must be a non-empty string`);
  }
  return value.trim();
}

/** Reads a guide page's metadata and content, checking the fields search results depend on. */
export function parsePage(source: string, file: string): SitePage {
  const match = FRONT_MATTER.exec(source);
  if (!match) throw new Error(`${file}: must start with its metadata as JSON in an HTML comment`);
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`${file}: metadata is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: metadata must be a JSON object`);
  }
  const meta = raw as Record<string, unknown>;

  const slug = requireString(meta, 'slug', file);
  if (!SLUG.test(slug)) throw new Error(`${file}: slug "${slug}" must be lowercase words joined by hyphens`);
  const order = meta.order;
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error(`${file}: "order" must be a number`);
  const title = requireString(meta, 'title', file);
  if (title.length > TITLE_MAX) {
    throw new Error(`${file}: title is ${title.length} characters; keep it to ${TITLE_MAX} so search results show it whole`);
  }
  const description = requireString(meta, 'description', file);
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    throw new Error(
      `${file}: description is ${description.length} characters; keep it between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX}`,
    );
  }

  const content = source.slice(match[0].length).trim();
  if (!/<h1[\s>]/.test(content)) throw new Error(`${file}: content needs an <h1>`);
  if ((content.match(/<h1[\s>]/g) ?? []).length > 1) throw new Error(`${file}: content has more than one <h1>`);

  return {
    slug,
    order,
    title,
    description,
    crumb: requireString(meta, 'crumb', file),
    label: requireString(meta, 'label', file),
    summary: requireString(meta, 'summary', file),
    content,
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pageUrl(slug: string): string {
  return `${SITE_URL}${slug}/`;
}

/** WebPage + BreadcrumbList, linked by @id to the WebSite, app and author on the home page. */
export function buildJsonLd(page: PageMeta, dateModified: string): string {
  const url = pageUrl(page.slug);
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: 'en',
        isPartOf: { '@id': `${SITE_URL}#website` },
        about: { '@id': `${SITE_URL}#app` },
        author: { '@id': `${SITE_URL}#author` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}og-image.png` },
        dateModified,
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'MeetMind', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
        ],
      },
    ],
  };
  // "</" can't appear inside a <script> element.
  return JSON.stringify(graph, null, 2).replace(/<\//g, '<\\/');
}

export function sortPages<T extends PageMeta>(pages: readonly T[]): T[] {
  return [...pages].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/** Fills the layout's {{placeholders}} for one page; `pages` is every guide, in display order. */
export function renderPage(
  layout: string,
  css: string,
  page: SitePage,
  pages: readonly PageMeta[],
  dateModified: string,
): string {
  const related = pages
    .filter((p) => p.slug !== page.slug)
    .map(
      (p) =>
        `          <li><a href="/meetmind/${p.slug}/"><strong>${escapeHtml(p.label)}</strong>` +
        `<span>${escapeHtml(p.summary)}</span></a></li>`,
    )
    .join('\n');
  const footerGuides = pages
    .map((p) =>
      p.slug === page.slug
        ? `        <a href="/meetmind/${p.slug}/" aria-current="page">${escapeHtml(p.label)}</a>`
        : `        <a href="/meetmind/${p.slug}/">${escapeHtml(p.label)}</a>`,
    )
    .join('\n');

  const values: Record<string, string> = {
    title: escapeHtml(page.title),
    description: escapeHtml(page.description),
    url: pageUrl(page.slug),
    crumb: escapeHtml(page.crumb),
    dateModified,
    jsonLd: buildJsonLd(page, dateModified),
    css: css.trim(),
    content: page.content,
    related,
    footerGuides,
  };
  // One pass, so text inside a value (such as the CSS or content) is never read as a placeholder.
  const html = layout.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!(key in values)) throw new Error(`Layout has an unknown placeholder ${whole}`);
    return values[key];
  });
  return html;
}

export interface SitemapEntry {
  loc: string;
  lastmod: string;
}

export function buildSitemap(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((e) => `  <url>\n    <loc>${escapeHtml(e.loc)}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Guides the home page doesn't link to; every guide needs at least one link from it. */
export function unlinkedFromHome(homeHtml: string, pages: readonly PageMeta[]): string[] {
  return pages
    .filter((p) => !homeHtml.includes(`href="${p.slug}/"`) && !homeHtml.includes(`href="/meetmind/${p.slug}/"`))
    .map((p) => p.slug);
}
