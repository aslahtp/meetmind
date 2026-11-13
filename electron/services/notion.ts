import type { Client } from '@notionhq/client';
import type {
  BlockObjectRequest,
  CreatePageParameters,
  PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import type { Notes, TranscriptSegment } from '../shared';
import logger from '../utils/logger';

// The Notion client loads on first use, so startup doesn't pay for it when Notion isn't set up.
function notionClient(auth: string): Client {
  const { Client: NotionClient } = require('@notionhq/client') as typeof import('@notionhq/client');
  return new NotionClient({ auth });
}
import { errorMessage } from '../utils/errors';

const NOTION_BLOCK_LIMIT = 100;

// ── Types ───────────────────────────────────────────────────────────────────────

/** The SDK doesn't export its rich-text request type; this is the one blocks use. */
type RichTextRequest = Extract<BlockObjectRequest, { paragraph: unknown }>['paragraph']['rich_text'][number];

/** A rich-text run as built here (a subset of Notion's `text` item). */
type RichText = {
  type: 'text';
  text: { content: string; link?: { url: string } | null };
  annotations?: { code?: boolean; bold?: boolean; strikethrough?: boolean; italic?: boolean };
};

/**
 * A block as built here: `type` names the key holding its content (e.g. `paragraph`). The SDK's
 * `BlockObjectRequest` union is too strict to build dynamically, so blocks are cast to it where they
 * are sent.
 */
interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

/** The part of a block's content that nests other blocks. */
type BlockContent = { children?: NotionBlock[] };

// ── Block builders ─────────────────────────────────────────────────────────────

// ── Inline Markdown → Notion Rich Text ───────────────────────────────────────

function parseMarkdownRichText(text: string | null | undefined): RichText[] {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  const regex = /(!?\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
  const richTexts: RichText[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const plain = text.substring(lastIdx, match.index);
      if (plain) {
        richTexts.push({
          type: 'text',
          text: { content: plain.slice(0, 2000) },
        });
      }
    }

    const [full, , linkText, linkUrl, codeText, boldText1, boldText2, strikeText, italicText1, italicText2] = match;

    if (full.startsWith('[')) {
      richTexts.push({
        type: 'text',
        text: {
          content: (linkText || '').slice(0, 2000),
          link: linkUrl ? { url: linkUrl } : null,
        },
      });
    } else if (codeText != null) {
      richTexts.push({
        type: 'text',
        text: { content: codeText.slice(0, 2000) },
        annotations: { code: true },
      });
    } else if (boldText1 != null || boldText2 != null) {
      richTexts.push({
        type: 'text',
        text: { content: (boldText1 ?? boldText2).slice(0, 2000) },
        annotations: { bold: true },
      });
    } else if (strikeText != null) {
      richTexts.push({
        type: 'text',
        text: { content: strikeText.slice(0, 2000) },
        annotations: { strikethrough: true },
      });
    } else if (italicText1 != null || italicText2 != null) {
      richTexts.push({
        type: 'text',
        text: { content: (italicText1 ?? italicText2).slice(0, 2000) },
        annotations: { italic: true },
      });
    }

    lastIdx = regex.lastIndex;
  }

  if (lastIdx < text.length) {
    const plain = text.substring(lastIdx);
    if (plain) {
      richTexts.push({
        type: 'text',
        text: { content: plain.slice(0, 2000) },
      });
    }
  }

  return richTexts.length > 0 ? richTexts : [{ type: 'text', text: { content: text.slice(0, 2000) } }];
}

// Legacy fallback
function richText(text: string) {
  return parseMarkdownRichText(text);
}

// ── Block builders ─────────────────────────────────────────────────────────────

function heading2Block(text: string): NotionBlock {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: parseMarkdownRichText(text) } };
}

function heading3Block(text: string): NotionBlock {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: parseMarkdownRichText(text) } };
}

function paragraphBlock(text: string): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: parseMarkdownRichText(text) } };
}

function bulletedBlock(text: string, children: NotionBlock[] = []): NotionBlock {
  const content: { rich_text: RichText[]; children?: NotionBlock[] } = { rich_text: parseMarkdownRichText(text) };
  if (children && children.length > 0) {
    content.children = children.slice(0, NOTION_BLOCK_LIMIT);
  }
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: content };
}

function todoBlock(text: string, checked = false): NotionBlock {
  return { object: 'block', type: 'to_do', to_do: { rich_text: parseMarkdownRichText(text), checked } };
}

function quoteBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: parseMarkdownRichText(text),
      color: 'default',
    },
  };
}

function dividerBlock(): NotionBlock {
  return { object: 'block', type: 'divider', divider: {} };
}

function calloutBlock(text: string, emoji = '📋'): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: parseMarkdownRichText(text),
      icon: { type: 'emoji', emoji },
    },
  };
}

function codeBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
      language: 'plain text',
    },
  };
}

function tableBlock(headers: string[], rows: string[][]): NotionBlock | null {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  if (colCount === 0) return null;

  const tableChildren: Array<{ type: 'table_row'; table_row: { cells: RichText[][] } }> = [];

  // Header row
  const headerCells: RichText[][] = [];
  for (let c = 0; c < colCount; c++) {
    headerCells.push(parseMarkdownRichText(headers[c] || ''));
  }
  tableChildren.push({
    type: 'table_row',
    table_row: { cells: headerCells },
  });

  // Data rows
  for (const row of rows) {
    const rowCells: RichText[][] = [];
    for (let c = 0; c < colCount; c++) {
      rowCells.push(parseMarkdownRichText(row[c] || ''));
    }
    tableChildren.push({
      type: 'table_row',
      table_row: { cells: rowCells },
    });
  }

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: colCount,
      has_column_header: true,
      has_row_header: false,
      children: tableChildren.slice(0, NOTION_BLOCK_LIMIT),
    },
  };
}

// ── Duration helpers ────────────────────────────────────────────────────────────

function getTranscriptDurationSeconds(transcript: TranscriptSegment[] | null | undefined) {
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  let maxEnd = 0;
  for (const seg of transcript) {
    if (typeof seg?.endTime === 'number' && seg.endTime > maxEnd) {
      maxEnd = seg.endTime;
    }
  }
  return maxEnd || null;
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    if (remMin > 0 && secs > 0) return `${hours}h ${remMin}min ${secs}s`;
    if (remMin > 0) return `${hours}h ${remMin}min`;
    if (secs > 0) return `${hours}h ${secs}s`;
    return `${hours}h`;
  }

  if (minutes > 0 && secs > 0) return `${minutes}min ${secs}s`;
  if (minutes > 0) return `${minutes}min`;
  return `${secs}s`;
}

// ── Markdown block & list tree parser ────────────────────────────────────────

function parseTableRow(rowLine: string) {
  return rowLine
    .split('|')
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    .map((c) => c.trim());
}

function parseMarkdownListTree(lines: string[], startIdx: number) {
  const rootBlocks: NotionBlock[] = [];
  const stack: Array<{ level: number; children: NotionBlock[] }> = [{ level: -1, children: rootBlocks }];

  let i = startIdx;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const taskDone = trimmed.match(/^-\s+\[x\]\s+(.*)/i);
    const taskOpen = trimmed.match(/^-\s+\[\s?\]\s+(.*)/);
    const bullet = !taskDone && !taskOpen && trimmed.match(/^[-*\u2022+]\s+(.*)/);
    const numbered = !taskDone && !taskOpen && trimmed.match(/^(\d+)\.\s+(.*)/);

    if (!taskDone && !taskOpen && !bullet && !numbered) {
      break; // End of continuous list block
    }

    const rawIndent = raw.match(/^(\s*)/)![1].replace(/\t/g, '  ').length;
    const level = Math.floor(rawIndent / 2);

    let block!: NotionBlock;
    if (taskDone) {
      block = todoBlock(taskDone[1].trim(), true);
    } else if (taskOpen) {
      block = todoBlock(taskOpen[1].trim(), false);
    } else if (bullet) {
      block = bulletedBlock(bullet[1].trim());
    } else if (numbered) {
      block = {
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseMarkdownRichText(numbered[2].trim()) },
      };
    }

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const content = block[block.type] as BlockContent;
    content.children = [];

    parent.children.push(block);
    stack.push({ level, children: content.children });

    i++;
  }

  function cleanEmptyChildren(items: NotionBlock[]) {
    for (const item of items) {
      const content = item[item.type] as BlockContent | undefined;
      if (content && content.children) {
        if (content.children.length === 0) {
          delete content.children;
        } else {
          cleanEmptyChildren(content.children);
        }
      }
    }
  }

  cleanEmptyChildren(rootBlocks);
  return { blocks: rootBlocks, nextIdx: i };
}

function buildBlocksFromMarkdown(markdown: string) {
  const blocks: NotionBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;
  let codeLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        if (codeLines.length > 0) {
          blocks.push(codeBlock(codeLines.join('\n')));
        }
        inCodeBlock = false;
        codeLines = [];
      } else {
        inCodeBlock = true;
      }
      i++;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(raw);
      i++;
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    // Table detection
    if (
      trimmed.startsWith('|') &&
      trimmed.endsWith('|') &&
      i + 1 < lines.length &&
      lines[i + 1].trim().startsWith('|') &&
      /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[i + 1].trim())
    ) {
      const headerRow = parseTableRow(trimmed);
      i += 2; // skip header and separator lines

      const rows: string[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t.startsWith('|') || !t.endsWith('|')) break;
        rows.push(parseTableRow(t));
        i++;
      }

      const tbl = tableBlock(headerRow, rows);
      if (tbl) blocks.push(tbl);
      continue;
    }

    // ATX Headings
    const h1 = trimmed.match(/^#\s+(.+)/);
    const h2 = trimmed.match(/^##\s+(.+)/);
    const h3 = trimmed.match(/^###\s+(.+)/);
    const h4 = trimmed.match(/^####\s+(.+)/);

    if (h1 && !h2) {
      blocks.push(heading2Block(h1[1].trim()));
      i++; continue;
    }
    if (h2 && !h3) {
      blocks.push(heading2Block(h2[1].trim()));
      i++; continue;
    }
    if (h3 && !h4) {
      blocks.push(heading3Block(h3[1].trim()));
      i++; continue;
    }
    if (h4) {
      blocks.push(heading3Block(h4[1].trim()));
      i++; continue;
    }

    // Quote
    if (trimmed.startsWith('>')) {
      blocks.push(quoteBlock(trimmed.replace(/^>\s?/, '')));
      i++; continue;
    }

    // Divider
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(dividerBlock());
      i++; continue;
    }

    // List item (Bullet, Numbered, Task) — parse as nested tree
    const taskDone = trimmed.match(/^-\s+\[x\]\s+(.*)/i);
    const taskOpen = trimmed.match(/^-\s+\[\s?\]\s+(.*)/);
    const bullet = !taskDone && !taskOpen && trimmed.match(/^[-*\u2022+]\s+(.*)/);
    const numbered = !taskDone && !taskOpen && trimmed.match(/^(\d+)\.\s+(.*)/);

    if (taskDone || taskOpen || bullet || numbered) {
      const { blocks: listBlocks, nextIdx } = parseMarkdownListTree(lines, i);
      blocks.push(...listBlocks);
      i = nextIdx;
      continue;
    }

    // Regular paragraph
    blocks.push(paragraphBlock(trimmed));
    i++;
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push(codeBlock(codeLines.join('\n')));
  }

  return blocks;
}


// ── Build page content ────────────────────────────────────────────────────────

function buildBlocks(
  notes: Notes,
  transcript: TranscriptSegment[] | null | undefined,
  { includeTranscript = true }: { includeTranscript?: boolean } = {}
) {
  let blocks: NotionBlock[] = [];

  if (notes && notes._rawMarkdown) {
    blocks = buildBlocksFromMarkdown(notes._rawMarkdown);
  } else {
    // Summary heading
    blocks.push(heading2Block('Summary'));

    // Optional: quoted duration block directly under Summary heading
    const durationSeconds =
      typeof notes?.duration_seconds === 'number' && notes.duration_seconds > 0
        ? notes.duration_seconds
        : getTranscriptDurationSeconds(transcript);
    const durationLabel = notes.duration || formatDuration(durationSeconds);
    if (durationLabel) {
      blocks.push(quoteBlock(`Duration: ${durationLabel}`));
    }

    // Participants
    if ((notes.participants?.length ?? 0) > 0) {
      const partLines = notes.participants!.map((p) => {
        const nameStr = p.name ? `${p.name} (${p.label})` : p.label;
        const roleStr = p.role ? ` — ${p.role}` : '';
        const confStr = p.identity_confidence ? ` [${p.identity_confidence}]` : '';
        return `${nameStr}${roleStr}${confStr}`;
      });
      blocks.push(calloutBlock(`Participants: ${partLines.join(' | ')}`, '👥'));
    }

    // Status Update
    const status = notes.status_update;
    if (status) {
      let statusText = 'Status Update:';
      if (typeof status === 'string') {
        statusText += ` ${status}`;
      } else {
        if (status.completion_estimate) {
          statusText += ` ${status.completion_estimate}.`;
        }
        if (status.remaining_scope?.length) {
          statusText += ` Remaining scope: ${status.remaining_scope.join(', ')}`;
        }
      }
      blocks.push(calloutBlock(statusText, '🎯'));
    }

    // Action Items & Next Steps as todo (checklist) blocks
    blocks.push(heading3Block('Action Items & Next Steps'));
    if ((notes.action_items?.length ?? 0) > 0) {
      for (const item of notes.action_items!) {
        if (item.task) {
          const due = item.due ? ` (Due: ${item.due})` : '';
          const owner = item.owner ? ` — ${item.owner}` : '';
          const label = `${item.task || ''}${owner}${due}`.trim();
          if (label) blocks.push(todoBlock(label, false));
        } else if (Array.isArray(item.tasks)) {
          for (const t of item.tasks) {
            const owner = item.owner ? ` — ${item.owner}` : '';
            const label = `${t || ''}${owner}`.trim();
            if (label) blocks.push(todoBlock(label, false));
          }
        }
      }
    } else {
      blocks.push(paragraphBlock('No action items identified.'));
    }

    // Topics / Sections
    const topics = notes.sections?.length ? notes.sections : notes.topics?.length ? notes.topics : notes.key_points;
    if ((topics?.length ?? 0) > 0) {
      for (const topic of topics!) {
        if (!topic?.heading && !topic?.content && !topic?.summary) continue;
        blocks.push(heading3Block(topic.heading || 'Topic'));
        const text = topic.content || topic.summary || '';
        const lines = text
          .split(/\r?\n+/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          blocks.push(bulletedBlock(line));
        }
        if ((topic.options_discussed?.length ?? 0) > 0) {
          blocks.push(paragraphBlock(`Options Discussed: ${topic.options_discussed!.join(', ')}`));
        }
        if (topic.decision) {
          blocks.push(calloutBlock(`Decision: ${topic.decision}`, '✅'));
        }
        if ((topic.open_questions?.length ?? 0) > 0) {
          blocks.push(calloutBlock(`Open Questions: ${topic.open_questions!.join(' | ')}`, '❓'));
        }
      }
    }

    // Notable Mentions
    if ((notes.notable_mentions?.length ?? 0) > 0) {
      blocks.push(heading3Block('Notable Mentions'));
      for (const mention of notes.notable_mentions!) {
        blocks.push(bulletedBlock(mention));
      }
    }

    if (!notes.action_items?.length && !topics?.length) {
      blocks.push(paragraphBlock('No summary available.'));
    }
  }


  // ── Transcript heading (Toggle H2) ──────────────────────────────────────────
  if (includeTranscript) {
    blocks.push(dividerBlock());

    const transcriptBlocks: NotionBlock[] = [];
    if (transcript && transcript.length > 0) {
      let currentChunk = '';
      for (const seg of transcript) {
        const line = `${seg.speaker || 'Speaker'}: ${seg.text}`;

        if (currentChunk.length + line.length > 1900) {
          if (currentChunk) transcriptBlocks.push(paragraphBlock(currentChunk.trim()));
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) {
        transcriptBlocks.push(paragraphBlock(currentChunk.trim()));
      }
    } else {
      transcriptBlocks.push(paragraphBlock('No transcript available.'));
    }

    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: richText('Transcript'),
        is_toggleable: true,
        children: transcriptBlocks.slice(0, NOTION_BLOCK_LIMIT),
      },
    });
  }

  return blocks;
}

// ── Batch append blocks ───────────────────────────────────────────────────────

async function appendBlocks(notion: Client, pageId: string, blocks: NotionBlock[]) {
  for (let i = 0; i < blocks.length; i += NOTION_BLOCK_LIMIT) {
    const chunk = blocks.slice(i, i + NOTION_BLOCK_LIMIT);
    await notion.blocks.children.append({
      block_id: pageId,
      children: chunk as BlockObjectRequest[],
    });
  }
}

function normalizeNotionId(input: unknown): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  // Extract 32-character hex ID from full Notion URL or raw string
  const urlMatch = trimmed.match(/[a-f0-9]{32}(?=[/?#]|$)/i);
  if (urlMatch) return urlMatch[0];
  // UUID with hyphens
  const uuidMatch = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (uuidMatch) return uuidMatch[0];
  return trimmed.replace(/^https?:\/\/[^/]+\//i, '').replace(/[^a-zA-Z0-9-]/g, '');
}

// ── Detect whether an ID belongs to a page or a database ─────────────────────

async function detectParentType(notion: Client, rawId: string): Promise<{ type: 'page' | 'database'; id: string }> {
  const id = normalizeNotionId(rawId) || rawId;
  // Try page first; if Notion says it's a database or not found as page, try database
  try {
    const page = await notion.pages.retrieve({ page_id: id });
    return { type: 'page', id: page.id };
  } catch (err) {
    try {
      const db = await notion.databases.retrieve({ database_id: id });
      return { type: 'database', id: db.id };
    } catch {
      // rethrow original error so the user sees a useful message
      throw err;
    }
  }
}

// Find the title property key in a database schema (varies by database)
async function getDatabaseTitleKey(notion: Client, databaseId: string) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  for (const [key, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'title') return key;
  }
  return 'Name'; // sensible default
}

// ── Main export ───────────────────────────────────────────────────────────────

async function uploadToNotion(
  notes: Notes,
  transcript: TranscriptSegment[] | null | undefined,
  parentId: string | null | undefined,
  notionToken: string | null | undefined,
  options: { includeTranscript?: boolean } = {}
): Promise<string> {
  if (!notionToken) throw new Error('Notion token is required');
  if (!parentId) throw new Error('Notion parent page/database ID is required. Paste it from the Notion URL into Settings.');

  const cleanParentId = normalizeNotionId(parentId) || parentId;
  const notion = notionClient(notionToken);

  const meetingTitle = (notes.title || 'Meeting Notes').slice(0, 1990);

  // Store the current time as a timezone-aware ISO string so Notion renders
  // it as a live relative date mention ("Today at 3:30 PM" → "Yesterday" →
  // "Mar 9") every time the page is viewed — not frozen at upload time.
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMM = String(Math.abs(tzOffset) % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  const localIso =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${tzSign}${tzHH}:${tzMM}`;

  // `mention.type` isn't in the SDK's request type, but Notion accepts it, so the items are cast.
  const titleRichText = [
    {
      type: 'mention',
      mention: {
        type: 'date',
        date: { start: localIso },
      },
    },
    {
      type: 'text',
      text: { content: ` — ${meetingTitle}` },
    },
  ] as RichTextRequest[];

  const includeTranscript = options.includeTranscript !== false;
  logger.info('Uploading to Notion', { parentId: cleanParentId, title: meetingTitle, includeTranscript });

  const { type: parentType, id: resolvedId } = await detectParentType(notion, cleanParentId);
  logger.info('Notion parent type detected', { parentType, resolvedId });

  let pagePayload: CreatePageParameters;
  if (parentType === 'database') {
    const titleKey = await getDatabaseTitleKey(notion, resolvedId);
    pagePayload = {
      parent: { database_id: resolvedId },
      properties: {
        [titleKey]: { title: titleRichText },
      },
    };
  } else {
    // Creating a child page inside a parent page requires title: { title: [...] }
    pagePayload = {
      parent: { page_id: resolvedId },
      properties: {
        title: {
          title: titleRichText,
        },
      },
    };
  }

  // A create always returns the full page; the SDK's type also allows a partial one without `url`.
  const page = (await notion.pages.create(pagePayload)) as PageObjectResponse;
  const pageId = page.id;
  logger.info('Notion page created', { pageId, url: page.url });

  const blocks = buildBlocks(notes, transcript, { includeTranscript });
  await appendBlocks(notion, pageId, blocks);

  logger.info('Notion upload complete', { pageId, blockCount: blocks.length });
  return page.url;
}

async function testNotionConnection(parentId: string | null | undefined, notionToken: string | null | undefined) {
  if (!notionToken) throw new Error('Notion token is required');
  const notion = notionClient(notionToken);
  if (parentId) {
    const cleanParentId = normalizeNotionId(parentId) || parentId;
    const { type, id: resolvedId } = await detectParentType(notion, cleanParentId);
    logger.info('Notion connection test passed', { parentId: cleanParentId, type, resolvedId });
    return { success: true, type, id: resolvedId };
  } else {
    await notion.users.me({});
    return { success: true };
  }
}

/**
 * Moves a page MeetMind created earlier to Notion's trash (restorable there for 30 days).
 * Used after a re-sync has created the replacement page, so a meeting keeps one page in Notion.
 * Never throws: a page that's already gone or no longer shared is simply skipped.
 */
async function trashNotionPage(pageRef: unknown, notionToken: string | null | undefined) {
  const pageId = normalizeNotionId(pageRef);
  if (!pageId || !notionToken) return false;
  try {
    const notion = notionClient(notionToken);
    await notion.pages.update({ page_id: pageId, archived: true });
    logger.info('Moved previous Notion page to trash', { pageId });
    return true;
  } catch (err) {
    logger.warn('Could not move previous Notion page to trash', { pageId, error: errorMessage(err) });
    return false;
  }
}

export { uploadToNotion, testNotionConnection, normalizeNotionId, trashNotionPage };
