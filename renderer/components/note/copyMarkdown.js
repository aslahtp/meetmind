// Shared note accessors (used by both the summary screen and the copy export,
// so what you copy always matches what you see) and the Markdown exporter.

export function getTopics(notes) {
  if (!notes) return [];
  const source = notes.sections?.length
    ? notes.sections
    : notes.topics?.length
      ? notes.topics
      : notes.key_points || [];
  return source.filter((t) => t?.heading || t?.content || t?.summary);
}

export function topicBody(topic) {
  return topic?.summary || topic?.content || '';
}

export function actionItemText(item) {
  return item?.task || item?.description || item?.action || '';
}

export function notesTitle(notes, session) {
  return notes?.meeting_title || notes?.title || session?.title || 'Meeting Notes';
}

export function buildNotesMarkdown(notes, session) {
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

  if (typeof notes.status_update === 'string' && notes.status_update.trim()) {
    md += `## Status Update\n${notes.status_update.trim()}\n\n`;
  } else if (notes.status_update) {
    md += `## Status Update\n`;
    if (notes.status_update.completion_estimate) {
      md += `- **Completion Estimate:** ${notes.status_update.completion_estimate}\n`;
    }
    if (notes.status_update.remaining_scope?.length) {
      md += `- **Remaining Scope:**\n`;
      notes.status_update.remaining_scope.forEach((s) => (md += `  - ${s}\n`));
    }
    md += `\n`;
  }

  if (notes.action_items?.length) {
    md += `## Action Items\n`;
    notes.action_items.forEach((item) => {
      const priority = item.priority ? ` (Priority: ${item.priority[0].toUpperCase()}${item.priority.slice(1)})` : '';
      md += `- [ ] ${actionItemText(item)}${item.owner ? ` (@${item.owner})` : ''}${item.due ? ` (Due: ${item.due})` : ''}${priority}\n`;
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
