// Shared note accessors (used by both the summary screen and the copy export,
// so what you copy always matches what you see) and the Markdown exporter.

import type { Notes, NotesActionItem, NotesParticipant, NotesStatusUpdate, NotesTopic } from '@shared';

export function getTopics(notes: Notes | null | undefined): NotesTopic[] {
  if (!notes) return [];
  const source = notes.sections?.length
    ? notes.sections
    : notes.topics?.length
      ? notes.topics
      : notes.key_points || [];
  return source.filter((t) => t?.heading || t?.content || t?.summary);
}

export function topicBody(topic: NotesTopic | null | undefined): string {
  return topic?.summary || topic?.content || '';
}

export function actionItemText(item: NotesActionItem | null | undefined): string {
  return item?.task || item?.description || item?.action || '';
}

export function notesTitle(notes: Notes | null | undefined, session?: { title?: string | null } | null): string {
  return notes?.meeting_title || notes?.title || session?.title || 'Meeting Notes';
}

export function buildNotesMarkdown(notes: Notes | null | undefined, session?: { title?: string | null } | null): string {
  if (!notes) return '';
  if (notes._rawMarkdown) return notes._rawMarkdown;

  let md = `# ${notesTitle(notes, session)}\n\n`;

  if (notes.participants?.length) {
    md += `## Participants\n`;
    notes.participants.forEach((p) => {
      const nameStr = p.name ? (p.label && p.label !== p.name ? `${p.name} (${p.label})` : p.name) : p.label;
      const roleStr = p.role ? ` — ${p.role}` : '';
      const confStr = p.identity_confidence ? ` [${p.identity_confidence}]` : '';
      md += `- ${nameStr}${roleStr}${confStr}\n`;
    });
    md += `\n`;
  }

  const statusUpdate = notes.status_update;
  if (typeof statusUpdate === 'string' && statusUpdate.trim()) {
    md += `## Status Update\n${statusUpdate.trim()}\n\n`;
  } else if (statusUpdate) {
    const status: NotesStatusUpdate = typeof statusUpdate === 'string' ? {} : statusUpdate;
    md += `## Status Update\n`;
    if (status.completion_estimate) {
      md += `- **Completion Estimate:** ${status.completion_estimate}\n`;
    }
    if (status.remaining_scope?.length) {
      md += `- **Remaining Scope:**\n`;
      status.remaining_scope.forEach((s) => (md += `  - ${s}\n`));
    }
    md += `\n`;
  }

  if (notes.action_items?.length) {
    md += `## Action Items\n`;
    notes.action_items.forEach((item) => {
      const priority = item.priority ? ` (Priority: ${item.priority[0].toUpperCase()}${item.priority.slice(1)})` : '';
      md += `- [${item.done ? 'x' : ' '}] ${actionItemText(item)}${item.owner ? ` (@${item.owner})` : ''}${item.due ? ` (Due: ${item.due})` : ''}${priority}\n`;
    });
    md += `\n`;
  }

  const topics = getTopics(notes);
  if (topics.length) {
    md += `## Key Topics\n\n`;
    topics.forEach((t, idx) => {
      md += `### ${idx + 1}. ${t.heading || 'Topic'}\n\n`;
      const body = topicBody(t);
      if (body) md += `${body}\n\n`;
      if (t.options_discussed?.length) {
        md += `**Options Discussed:**\n`;
        t.options_discussed.forEach((opt) => (md += `- ${opt}\n`));
        md += `\n`;
      }
      if (t.decision) md += `**Decision:** ${t.decision}\n\n`;
      if (t.open_questions?.length) {
        md += `**Open Questions:**\n`;
        t.open_questions.forEach((q) => (md += `- ${q}\n`));
        md += `\n`;
      }
    });
  }

  if (notes.notable_mentions?.length) {
    md += `## Notable Mentions\n`;
    notes.notable_mentions.forEach((m) => (md += `- ${m}\n`));
    md += `\n`;
  }

  return md;
}

// ── Markdown → notes (the inverse of buildNotesMarkdown) ─────────────────────
// Lets the notes be edited as one Markdown document while structured meetings
// keep their card layout. Markdown-mode notes just store the new text. For
// structured notes each known "## " section is parsed back into its field and
// unknown sections become extra topics; with no known section left the notes
// fall back to plain Markdown. Fields Markdown can't express (sentiment,
// model/STT stamps) are kept from `base`.

type SectionKind = 'participants' | 'status' | 'actions' | 'topics' | 'mentions';

const SECTION_KINDS: Record<string, SectionKind> = {
  'participants': 'participants',
  'status update': 'status',
  'action items': 'actions',
  'key topics': 'topics',
  'notable mentions': 'mentions',
  'mentions & risks': 'mentions',
};

const STRUCTURED_FIELDS: Array<keyof Notes> = [
  'participants', 'attendees', 'status_update', 'action_items',
  'sections', 'topics', 'key_points', 'notable_mentions',
];

const LIST_ITEM = /^\s*[-*+]\s+(.*)$/;

const sectionKind = (heading: string): SectionKind | undefined => SECTION_KINDS[heading.trim().toLowerCase()];

const joinText = (lines: string[]) => lines.join('\n').replace(/^\n+|\s+$/g, '');

const listItems = (lines: string[]) =>
  lines.map((l) => l.match(LIST_ITEM)?.[1]?.trim()).filter((item): item is string => !!item);

interface MarkdownSection {
  heading: string;
  lines: string[];
}

// { title, preamble, sections: [{ heading, lines }] }; headings inside code fences are text.
function splitSections(markdown: string) {
  const out: { title: string | null; preamble: string[]; sections: MarkdownSection[] } = {
    title: null,
    preamble: [],
    sections: [],
  };
  let current: MarkdownSection | null = null;
  let inFence = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h1 = !inFence && line.match(/^#\s+(.+?)\s*$/);
    const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/);
    if (h1 && out.title === null && !current) {
      out.title = h1[1];
    } else if (h2) {
      current = { heading: h2[1], lines: [] };
      out.sections.push(current);
    } else {
      (current ? current.lines : out.preamble).push(line);
    }
  }
  return out;
}

// "Name (Label) — Role [confidence]"
function parseParticipant(text: string): NotesParticipant {
  let rest = text;
  const conf = rest.match(/\s\[([^\]]+)\]$/);
  if (conf) rest = rest.slice(0, conf.index);
  const dash = rest.indexOf(' — ');
  const role = dash === -1 ? '' : rest.slice(dash + 3).trim();
  if (dash !== -1) rest = rest.slice(0, dash);
  const labelled = rest.match(/^(.*\S)\s+\(([^)]+)\)$/);
  const p: NotesParticipant = labelled ? { name: labelled[1], label: labelled[2] } : { name: rest.trim() };
  if (role) p.role = role;
  if (conf) p.identity_confidence = conf[1];
  return p;
}

function parseStatus(lines: string[]): string | NotesStatusUpdate | undefined {
  const text = joinText(lines);
  if (!/^\s*[-*+]\s+\*\*(Completion Estimate|Remaining Scope):\*\*/m.test(text)) return text || undefined;
  const status: NotesStatusUpdate = {};
  let scope: string[] | null = null;
  for (const line of lines) {
    const est = line.match(/^\s*[-*+]\s+\*\*Completion Estimate:\*\*\s*(.*)$/);
    if (est) {
      status.completion_estimate = est[1].trim();
      scope = null;
    } else if (/^\s*[-*+]\s+\*\*Remaining Scope:\*\*/.test(line)) {
      scope = [];
      status.remaining_scope = scope;
    } else if (scope) {
      const item = line.match(LIST_ITEM);
      if (item) scope.push(item[1].trim());
    }
  }
  return status;
}

// "[x] Task (@owner) (Due: Thu) (Priority: High)"
function parseActionItem(text: string): NotesActionItem {
  let rest = text;
  const item: NotesActionItem = {};
  const box = rest.match(/^\[([ xX])\]\s*/);
  if (box) rest = rest.slice(box[0].length);
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (!m) return '';
    rest = rest.slice(0, m.index);
    return m[1].trim();
  };
  const priority = take(/\s*\(Priority:\s*([^)]+)\)\s*$/i);
  const due = take(/\s*\(Due:\s*([^)]+)\)\s*$/i);
  const owner = take(/\s*\(@([^)]+)\)\s*$/);
  item.task = rest.trim();
  if (owner) item.owner = owner;
  if (due) item.due = due;
  if (priority) item.priority = priority.toLowerCase();
  if (box && box[1] !== ' ') item.done = true;
  return item;
}

function parseTopic(heading: string, lines: string[]): NotesTopic {
  const topic: NotesTopic = { heading };
  const body: string[] = [];
  let mode = 'body';
  for (const line of lines) {
    const decision = line.match(/^\*\*Decision:\*\*\s*(.*)$/);
    const item = line.match(LIST_ITEM);
    if (/^\*\*Options Discussed:\*\*\s*$/.test(line)) {
      mode = 'options';
      topic.options_discussed = [];
    } else if (/^\*\*Open Questions:\*\*\s*$/.test(line)) {
      mode = 'questions';
      topic.open_questions = [];
    } else if (decision) {
      mode = 'decision';
      topic.decision = decision[1].trim();
    } else if (mode === 'options' && item) {
      topic.options_discussed?.push(item[1].trim());
    } else if (mode === 'questions' && item) {
      topic.open_questions?.push(item[1].trim());
    } else if (mode === 'decision' && line.trim()) {
      topic.decision = `${topic.decision} ${line.trim()}`.trim();
    } else if (!line.trim()) {
      if (mode === 'decision') mode = 'body';
      if (mode === 'body') body.push(line);
    } else {
      mode = 'body';
      body.push(line);
    }
  }
  topic.content = joinText(body);
  topic.summary = topic.content;
  return topic;
}

// "### 1. Heading" blocks; text before the first one becomes an untitled topic.
function parseTopics(lines: string[]): NotesTopic[] {
  const blocks: MarkdownSection[] = [];
  const intro: string[] = [];
  for (const line of lines) {
    const h3 = line.match(/^###\s+(?:\d+\.\s+)?(.+?)\s*$/);
    if (h3) blocks.push({ heading: h3[1], lines: [] });
    else (blocks.length ? blocks[blocks.length - 1].lines : intro).push(line);
  }
  const topics = blocks.map((b) => parseTopic(b.heading, b.lines));
  if (joinText(intro)) topics.unshift(parseTopic('', intro));
  return topics;
}

export function parseNotesMarkdown(markdown: string | null | undefined, base: Notes = {}): Notes {
  const { title, preamble, sections } = splitSections(markdown || '');
  const nextTitle = title?.trim() || base.meeting_title || base.title;

  if (base._rawMarkdown || !sections.some((s) => sectionKind(s.heading))) {
    const notes: Notes = { ...base, _rawMarkdown: markdown ?? undefined, title: nextTitle, meeting_title: nextTitle };
    // Structured fields would be stale next to the Markdown text.
    STRUCTURED_FIELDS.forEach((key) => delete notes[key]);
    return notes;
  }

  const notes: Notes = { ...base, title: nextTitle, meeting_title: nextTitle };
  delete notes._rawMarkdown;
  STRUCTURED_FIELDS.forEach((key) => delete notes[key]);
  let participants: NotesParticipant[] = [];
  let actionItems: NotesActionItem[] = [];
  let mentions: string[] = [];
  // Placeholders keep these keys before status_update in the saved JSON; filled in after the loop.
  notes.participants = participants;
  notes.action_items = actionItems;
  notes.notable_mentions = mentions;

  const topics: NotesTopic[] = [];
  if (joinText(preamble)) topics.push(parseTopic('Notes', preamble));

  for (const section of sections) {
    const kind = sectionKind(section.heading);
    if (kind === 'participants') participants = listItems(section.lines).map(parseParticipant);
    else if (kind === 'status') {
      const status = parseStatus(section.lines);
      if (status) notes.status_update = status;
    } else if (kind === 'actions') actionItems = listItems(section.lines).map(parseActionItem).filter((i) => i.task);
    else if (kind === 'topics') topics.push(...parseTopics(section.lines));
    else if (kind === 'mentions') mentions = listItems(section.lines);
    else topics.push(parseTopic(section.heading, section.lines));
  }

  notes.participants = participants;
  notes.action_items = actionItems;
  notes.notable_mentions = mentions;
  notes.attendees = participants.map((p) => p.name || p.label || '');
  notes.sections = topics;
  notes.topics = topics;
  notes.key_points = topics;
  return notes;
}
