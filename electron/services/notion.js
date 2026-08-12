const { Client } = require('@notionhq/client');
const logger = require('../utils/logger');

const NOTION_BLOCK_LIMIT = 100;

// ── Block builders ─────────────────────────────────────────────────────────────

function richText(text, options = {}) {
  return [{
    type: 'text',
    text: { content: text.slice(0, 2000) },
    annotations: {
      bold: options.bold || false,
      italic: options.italic || false,
      code: options.code || false,
      color: options.color || 'default',
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

function quoteBlock(text, options = {}) {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: richText(text, options),
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

// ── Build page content ────────────────────────────────────────────────────────

function buildBlocks(notes, transcript) {
  const blocks = [];

  // ── Summary heading ───────────────────────────────────────────────────────
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

// ── Detect whether an ID belongs to a page or a database ─────────────────────

async function detectParentType(notion, id) {
  // Try page first; if Notion says it's a database, fall back to databases.retrieve
  try {
    await notion.pages.retrieve({ page_id: id });
    return 'page';
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('database') || err?.code === 'object_not_found') {
      try {
        await notion.databases.retrieve({ database_id: id });
        return 'database';
      } catch {
        // rethrow original error so the user sees a useful message
      }
    }
    throw err;
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

  logger.info('Uploading to Notion', { parentId, title: meetingTitle });

  const parentType = await detectParentType(notion, parentId);
  logger.info('Notion parent type detected', { parentType });

  let pagePayload;
  if (parentType === 'database') {
    const titleKey = await getDatabaseTitleKey(notion, parentId);
    pagePayload = {
      parent: { database_id: parentId },
      properties: {
        [titleKey]: { title: titleRichText },
      },
    };
  } else {
    pagePayload = {
      parent: { page_id: parentId },
      properties: {
        title: titleRichText,
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
    const type = await detectParentType(notion, parentId);
    logger.info('Notion connection test passed', { parentId, type });
  } else {
    await notion.users.me();
  }
}

module.exports = { uploadToNotion, testNotionConnection };
