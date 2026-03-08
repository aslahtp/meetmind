const { Client } = require('@notionhq/client');
const logger = require('../utils/logger');

const NOTION_BLOCK_LIMIT = 100;

// ── Block builders ─────────────────────────────────────────────────────────────

function richText(text, options = {}) {
  return [{
    type: 'text',
    text: { content: text.slice(0, 2000) },
    annotations: {
      bold:          options.bold    || false,
      italic:        options.italic  || false,
      code:          options.code    || false,
      color:         options.color   || 'default',
    },
  }];
}

function heading2Block(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(text) } };
}

function heading3Block(text) {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: richText(text) } };
}

function paragraphBlock(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function bulletedBlock(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(text) } };
}

function todoBlock(text, checked = false) {
  return { object: 'block', type: 'to_do', to_do: { rich_text: richText(text), checked } };
}

function dividerBlock() {
  return { object: 'block', type: 'divider', divider: {} };
}

function calloutBlock(text, emoji = '📋') {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: richText(text),
      icon: { type: 'emoji', emoji },
    },
  };
}

function toggleBlock(heading, children = []) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: richText(heading),
      children: children.slice(0, NOTION_BLOCK_LIMIT),
    },
  };
}

function codeBlock(text) {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: richText(text.slice(0, 2000)),
      language: 'plain text',
    },
  };
}

// ── Priority badge text ────────────────────────────────────────────────────────

function priorityBadge(priority) {
  const badges = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  return badges[priority] || '';
}

// ── Build full block list from notes ─────────────────────────────────────────

function buildBlocks(notes, transcript) {
  const blocks = [];

  // ── Action Items ──────────────────────────────────────────────────────────
  blocks.push(heading2Block('✅ Action Items'));

  if (notes.action_items?.length > 0) {
    for (const item of notes.action_items) {
      const badge = priorityBadge(item.priority);
      const due   = item.due ? ` | Due: ${item.due}` : '';
      const owner = item.owner ? ` — ${item.owner}` : '';
      const label = `${item.task}${owner}${due} ${badge}`.trim();
      blocks.push(todoBlock(label, false));
    }
  } else {
    blocks.push(paragraphBlock('No action items identified.'));
  }

  blocks.push(dividerBlock());

  // ── Key Points ─────────────────────────────────────────────────────────────
  blocks.push(heading2Block('📌 Key Points'));

  if (notes.key_points?.length > 0) {
    for (const point of notes.key_points) {
      blocks.push(toggleBlock(point.heading, [paragraphBlock(point.summary || '')]));
    }
  } else {
    blocks.push(paragraphBlock('No key points recorded.'));
  }

  blocks.push(dividerBlock());

  // ── Decisions ──────────────────────────────────────────────────────────────
  blocks.push(heading2Block('🔑 Decisions'));

  if (notes.decisions?.length > 0) {
    for (const d of notes.decisions) {
      blocks.push(bulletedBlock(d));
    }
  } else {
    blocks.push(paragraphBlock('No decisions recorded.'));
  }

  blocks.push(dividerBlock());

  // ── Open Questions ─────────────────────────────────────────────────────────
  blocks.push(heading2Block('❓ Open Questions'));

  if (notes.questions_unresolved?.length > 0) {
    for (const q of notes.questions_unresolved) {
      blocks.push(bulletedBlock(q));
    }
  } else {
    blocks.push(paragraphBlock('No open questions.'));
  }

  // ── Next Meeting ───────────────────────────────────────────────────────────
  if (notes.next_meeting) {
    blocks.push(dividerBlock());
    blocks.push(calloutBlock(notes.next_meeting, '📅'));
  }

  // ── Transcript ─────────────────────────────────────────────────────────────
  if (transcript?.length > 0) {
    blocks.push(dividerBlock());

    const transcriptText = transcript
      .map((seg) => {
        const m = Math.floor((seg.startTime || 0) / 60).toString().padStart(2, '0');
        const s = Math.floor((seg.startTime || 0) % 60).toString().padStart(2, '0');
        return `[${m}:${s}] ${seg.speaker || 'Speaker'}: ${seg.text}`;
      })
      .join('\n');

    // Split transcript into 2000-char chunks for code blocks
    const transcriptChunks = [];
    for (let i = 0; i < transcriptText.length; i += 1900) {
      transcriptChunks.push(transcriptText.slice(i, i + 1900));
    }

    const transcriptChildren = transcriptChunks.map((chunk) => codeBlock(chunk));

    blocks.push(toggleBlock('📝 Full Transcript (click to expand)', transcriptChildren));
  }

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

// ── Notion database page properties ──────────────────────────────────────────

function buildPageProperties(notes) {
  const attendees = (notes.attendees || []).map((name) => ({ name: name.slice(0, 100) }));
  const sentiment = notes.sentiment || 'neutral';

  const dateStr = notes.date
    ? new Date(notes.date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    Name: {
      title: [{ text: { content: `${notes.title || 'Meeting Notes'} — ${dateStr}` } }],
    },
    Date: {
      date: { start: dateStr },
    },
    Attendees: {
      multi_select: attendees.slice(0, 10),
    },
    Sentiment: {
      select: { name: sentiment },
    },
    Duration: {
      rich_text: [{ text: { content: notes.duration || '' } }],
    },
    Status: {
      select: { name: 'Completed' },
    },
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function uploadToNotion(notes, transcript, databaseId, notionToken) {
  if (!notionToken) throw new Error('Notion token is required');
  if (!databaseId) throw new Error('Notion database ID is required');

  const notion = new Client({ auth: notionToken });

  logger.info('Uploading to Notion', { databaseId, title: notes.title });

  // Create the page
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: buildPageProperties(notes),
  });

  const pageId = page.id;
  logger.info('Notion page created', { pageId, url: page.url });

  // Build and append content blocks
  const blocks = buildBlocks(notes, transcript);
  await appendBlocks(notion, pageId, blocks);

  logger.info('Notion upload complete', { pageId, blockCount: blocks.length });

  return page.url;
}

async function testNotionConnection(notionToken, databaseId) {
  if (!notionToken) throw new Error('Notion token is required');

  const notion = new Client({ auth: notionToken });

  // Try to retrieve the database to verify access
  if (databaseId) {
    await notion.databases.retrieve({ database_id: databaseId });
  } else {
    await notion.users.me();
  }
}

module.exports = { uploadToNotion, testNotionConnection };
