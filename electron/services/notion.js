const { Client } = require('@notionhq/client');
const logger = require('../utils/logger');

const NOTION_BLOCK_LIMIT = 100;

// ── Block builders ─────────────────────────────────────────────────────────────

// ── Inline Markdown → Notion Rich Text ───────────────────────────────────────

function parseMarkdownRichText(text) {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  const regex = /(!?\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
  const richTexts = [];
  let lastIdx = 0;
  let match;

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
function richText(text, options = {}) {
  return parseMarkdownRichText(text);
}

// ── Block builders ─────────────────────────────────────────────────────────────

function heading2Block(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: parseMarkdownRichText(text) } };
}

function heading3Block(text) {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: parseMarkdownRichText(text) } };
}

function paragraphBlock(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: parseMarkdownRichText(text) } };
}

function bulletedBlock(text, children = []) {
  const b = { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseMarkdownRichText(text) } };
  if (children && children.length > 0) {
    b.bulleted_list_item.children = children.slice(0, NOTION_BLOCK_LIMIT);
  }
  return b;
}

function todoBlock(text, checked = false) {
  return { object: 'block', type: 'to_do', to_do: { rich_text: parseMarkdownRichText(text), checked } };
}

function quoteBlock(text, options = {}) {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: parseMarkdownRichText(text),
      color: 'default',
    },
  };
}

function dividerBlock() {
  return { object: 'block', type: 'divider', divider: {} };
}

function calloutBlock(text, emoji = '📋') {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: parseMarkdownRichText(text),
      icon: { type: 'emoji', emoji },
    },
  };
}

function toggleBlock(heading, children = []) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: parseMarkdownRichText(heading),
      children: children.slice(0, NOTION_BLOCK_LIMIT),
    },
  };
}

function codeBlock(text) {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
      language: 'plain text',
    },
  };
}

function tableBlock(headers, rows) {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  if (colCount === 0) return null;

  const tableChildren = [];

  // Header row
  const headerCells = [];
  for (let c = 0; c < colCount; c++) {
    headerCells.push(parseMarkdownRichText(headers[c] || ''));
  }
  tableChildren.push({
    type: 'table_row',
    table_row: { cells: headerCells },
  });

  // Data rows
  for (const row of rows) {
    const rowCells = [];
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

// ── Priority badge text ────────────────────────────────────────────────────────

function priorityBadge(priority) {
  const badges = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  return badges[priority] || '';
}

// ── Duration helpers ────────────────────────────────────────────────────────────

function getTranscriptDurationSeconds(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  let maxEnd = 0;
  for (const seg of transcript) {
    if (typeof seg?.endTime === 'number' && seg.endTime > maxEnd) {
      maxEnd = seg.endTime;
    }
  }
  return maxEnd || null;
}

function formatDuration(seconds) {
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

function parseTableRow(rowLine) {
  return rowLine
    .split('|')
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    .map((c) => c.trim());
}

function parseMarkdownListTree(lines, startIdx) {
  const rootBlocks = [];
  const stack = [{ level: -1, children: rootBlocks }];

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

    const rawIndent = raw.match(/^(\s*)/)[1].replace(/\t/g, '  ').length;
    const level = Math.floor(rawIndent / 2);

    let block;
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
    const type = block.type;
    block[type].children = [];

    parent.children.push(block);
    stack.push({ level, children: block[type].children });

    i++;
  }

  function cleanEmptyChildren(items) {
    for (const item of items) {
      const type = item.type;
      if (item[type] && item[type].children) {
        if (item[type].children.length === 0) {
          delete item[type].children;
        } else {
          cleanEmptyChildren(item[type].children);
        }
      }
    }
  }

  cleanEmptyChildren(rootBlocks);
  return { blocks: rootBlocks, nextIdx: i };
}

function buildBlocksFromMarkdown(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;
  let codeLines = [];

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

      const rows = [];
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

function buildBlocks(notes, transcript) {
  let blocks = [];

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
      blocks.push(quoteBlock(`Duration: ${durationLabel}`, { bold: true, italic: true }));
    }

    // Participants
    if (notes.participants?.length > 0) {
      const partLines = notes.participants.map((p) => {
        if (typeof p === 'string') return p;
        const nameStr = p.name ? `${p.name} (${p.label})` : p.label;
        const roleStr = p.role ? ` — ${p.role}` : '';
        const confStr = p.identity_confidence ? ` [${p.identity_confidence}]` : '';
        return `${nameStr}${roleStr}${confStr}`;
      });
      blocks.push(calloutBlock(`Participants: ${partLines.join(' | ')}`, '👥'));
    }

    // Status Update
    if (notes.status_update) {
      let statusText = 'Status Update:';
      if (notes.status_update.completion_estimate) {
        statusText += ` ${notes.status_update.completion_estimate}.`;
      }
      if (notes.status_update.remaining_scope?.length) {
        statusText += ` Remaining scope: ${notes.status_update.remaining_scope.join(', ')}`;
      }
      blocks.push(calloutBlock(statusText, '🎯'));
    }

    // Action Items & Next Steps as todo (checklist) blocks
    blocks.push(heading3Block('Action Items & Next Steps'));
    if (notes.action_items?.length > 0) {
      for (const item of notes.action_items) {
        if (typeof item === 'string') {
          blocks.push(todoBlock(item, false));
        } else if (item.task) {
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
    if (topics?.length > 0) {
      for (const topic of topics) {
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
        if (topic.options_discussed?.length > 0) {
          blocks.push(paragraphBlock(`Options Discussed: ${topic.options_discussed.join(', ')}`));
        }
        if (topic.decision) {
          blocks.push(calloutBlock(`Decision: ${topic.decision}`, '✅'));
        }
        if (topic.open_questions?.length > 0) {
          blocks.push(calloutBlock(`Open Questions: ${topic.open_questions.join(' | ')}`, '❓'));
        }
      }
    }

    // Notable Mentions
    if (notes.notable_mentions?.length > 0) {
      blocks.push(heading3Block('Notable Mentions'));
      for (const mention of notes.notable_mentions) {
        blocks.push(bulletedBlock(mention));
      }
    }

    if (!notes.action_items?.length && !topics?.length) {
      blocks.push(paragraphBlock('No summary available.'));
    }
  }


  // ── Transcript heading (Toggle H2) ──────────────────────────────────────────
  blocks.push(dividerBlock());

  const transcriptBlocks = [];
  if (transcript?.length > 0) {
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

  return blocks;
}

// ── Batch append blocks ───────────────────────────────────────────────────────

async function appendBlocks(notion, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += NOTION_BLOCK_LIMIT) {
    const chunk = blocks.slice(i, i + NOTION_BLOCK_LIMIT);
    await notion.blocks.children.append({
      block_id: pageId,
      children: chunk,
    });
  }
}

function normalizeNotionId(input) {
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

async function detectParentType(notion, rawId) {
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
async function getDatabaseTitleKey(notion, databaseId) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  for (const [key, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'title') return key;
  }
  return 'Name'; // sensible default
}

// ── Main export ───────────────────────────────────────────────────────────────

async function uploadToNotion(notes, transcript, parentId, notionToken) {
  if (!notionToken) throw new Error('Notion token is required');
  if (!parentId) throw new Error('Notion parent page/database ID is required. Paste it from the Notion URL into Settings.');

  const cleanParentId = normalizeNotionId(parentId) || parentId;
  const notion = new Client({ auth: notionToken });

  const meetingTitle = (notes.title || 'Meeting Notes').slice(0, 1990);

  // Store the current time as a timezone-aware ISO string so Notion renders
  // it as a live relative date mention ("Today at 3:30 PM" → "Yesterday" →
  // "Mar 9") every time the page is viewed — not frozen at upload time.
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMM = String(Math.abs(tzOffset) % 60).padStart(2, '0');
  const pad = (n) => String(n).padStart(2, '0');
  const localIso =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${tzSign}${tzHH}:${tzMM}`;

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
  ];

  logger.info('Uploading to Notion', { parentId: cleanParentId, title: meetingTitle });

  const { type: parentType, id: resolvedId } = await detectParentType(notion, cleanParentId);
  logger.info('Notion parent type detected', { parentType, resolvedId });

  let pagePayload;
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

  const page = await notion.pages.create(pagePayload);
  const pageId = page.id;
  logger.info('Notion page created', { pageId, url: page.url });

  const blocks = buildBlocks(notes, transcript);
  await appendBlocks(notion, pageId, blocks);

  logger.info('Notion upload complete', { pageId, blockCount: blocks.length });
  return page.url;
}

async function testNotionConnection(parentId, notionToken) {
  if (!notionToken) throw new Error('Notion token is required');
  const notion = new Client({ auth: notionToken });
  if (parentId) {
    const cleanParentId = normalizeNotionId(parentId) || parentId;
    const { type, id: resolvedId } = await detectParentType(notion, cleanParentId);
    logger.info('Notion connection test passed', { parentId: cleanParentId, type, resolvedId });
    return { success: true, type, id: resolvedId };
  } else {
    await notion.users.me();
    return { success: true };
  }
}

module.exports = { uploadToNotion, testNotionConnection, normalizeNotionId };
