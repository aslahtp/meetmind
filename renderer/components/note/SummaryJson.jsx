import React, { useState } from 'react';
import { ListChecks, User, Clock, HelpCircle } from 'lucide-react';
import { StepBadge, AvatarTile, CheckBox, StatusDot } from '../ui/index.jsx';
import { initials } from '../../lib/format.js';
import { parseInlineMarkdown, FormattedText } from './markdown.jsx';
import { getTopics, topicBody, actionItemText } from './copyMarkdown.js';

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

function SectionHeading({ n, children, aside }) {
  return (
    <div className="flex items-center justify-between gap-16 mb-24">
      <h2><StepBadge n={n}>{children}</StepBadge></h2>
      {aside}
    </div>
  );
}

function PriorityTag({ priority }) {
  const key = (priority || 'medium').toLowerCase();
  const label = PRIORITY_LABELS[key] || priority;
  if (key === 'high') {
    return (
      <span className="highlight uppercase" style={{ letterSpacing: 'var(--tracking-badge)' }}>
        {label}
      </span>
    );
  }
  return <span className="eyebrow">{label}</span>;
}

function ActionItemsList({ items, n }) {
  const [checked, setChecked] = useState(() => ({}));
  const doneCount = items.reduce((count, _, idx) => count + (checked[idx] ? 1 : 0), 0);

  return (
    <section>
      <SectionHeading
        n={n}
        aside={items.length > 0 && (
          <span className="text-caption text-graphite tabular">{doneCount}/{items.length} done</span>
        )}
      >
        Action items
      </SectionHeading>

      {items.length === 0 ? (
        <div className="card-compact text-center">
          <ListChecks size={24} strokeWidth={1.75} className="mx-auto mb-8 text-graphite" />
          <p className="text-body-sm text-graphite">No action items were identified in this meeting.</p>
        </div>
      ) : (
        <ul className="border border-ink rounded-card divide-y divide-graphite/40">
          {items.map((item, idx) => {
            const isDone = !!checked[idx];
            return (
              <li key={idx} className="px-24 py-16">
                <CheckBox
                  checked={isDone}
                  onChange={(value) => setChecked((prev) => ({ ...prev, [idx]: value }))}
                >
                  <span className="flex-1 min-w-0">
                    <span className={`block text-body-sm font-medium ${isDone ? 'text-graphite line-through' : 'text-ink'}`}>
                      {actionItemText(item)}
                    </span>
                    {(item.owner || item.due || item.priority) && (
                      <span className="flex items-center gap-16 mt-8 flex-wrap text-caption text-graphite">
                        {item.owner && (
                          <span className="inline-flex items-center gap-4">
                            <User size={14} strokeWidth={1.75} aria-hidden="true" />
                            {item.owner}
                          </span>
                        )}
                        {item.due && (
                          <span className="inline-flex items-center gap-4">
                            <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
                            Due {item.due}
                          </span>
                        )}
                        {item.priority && <PriorityTag priority={item.priority} />}
                      </span>
                    )}
                  </span>
                </CheckBox>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Participants({ participants }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
      {participants.map((p, idx) => {
        const name = p.name || p.label;
        return (
          <div key={idx} className="tile flex items-center gap-16 p-16">
            <AvatarTile size={40} className="text-caption">{initials(name)}</AvatarTile>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-medium text-ink truncate">
                {name}
                {p.name && p.label && p.name !== p.label && (
                  <span className="text-caption font-normal text-graphite"> ({p.label})</span>
                )}
              </p>
              {p.role && <p className="text-caption text-graphite truncate">{p.role}</p>}
            </div>
            {p.identity_confidence && (
              p.identity_confidence === 'confirmed' ? (
                <span className="pill flex-shrink-0 capitalize">
                  <StatusDot tone="ok" />
                  Confirmed
                </span>
              ) : (
                <span className="pill-quiet flex-shrink-0 capitalize">{p.identity_confidence}</span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusUpdateCard({ statusUpdate }) {
  return (
    <div className="card-compact">
      <div className="flex items-center gap-8 flex-wrap">
        <span className="highlight">TL;DR</span>
        <h3 className="text-subheading font-medium text-ink">Status update</h3>
        {statusUpdate.completion_estimate && (
          <span className="pill ml-auto">{statusUpdate.completion_estimate}</span>
        )}
      </div>
      {statusUpdate.remaining_scope?.length > 0 && (
        <div className="mt-16">
          <p className="eyebrow mb-8">Remaining scope</p>
          <ul className="list-disc pl-24 marker:text-ink space-y-4 text-body-sm text-graphite">
            {statusUpdate.remaining_scope.map((item, i) => (
              <li key={i}>{parseInlineMarkdown(item)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TopicCard({ topic, idx }) {
  const body = topicBody(topic);
  return (
    <article className="card space-y-24">
      <header>
        <p className="eyebrow tabular">Topic {String(idx + 1).padStart(2, '0')}</p>
        <h3 className="text-heading-sm font-medium text-ink mt-8">{topic.heading || 'Topic'}</h3>
      </header>

      {body && <FormattedText content={body} />}

      {topic.options_discussed?.length > 0 && (
        <div className="border-l border-ink pl-16">
          <p className="eyebrow mb-8">Options discussed</p>
          <ul className="list-disc pl-24 marker:text-ink space-y-4 text-body-sm text-graphite">
            {topic.options_discussed.map((opt, i) => (
              <li key={i}>{parseInlineMarkdown(opt)}</li>
            ))}
          </ul>
        </div>
      )}

      {topic.decision && (
        <div className="tile p-16">
          <p className="flex items-center gap-8 eyebrow text-ink mb-8">
            <StatusDot tone="ok" />
            Decision
          </p>
          <p className="text-body-sm text-ink">{parseInlineMarkdown(topic.decision)}</p>
        </div>
      )}

      {topic.open_questions?.length > 0 && (
        <div className="tile p-16">
          <p className="flex items-center gap-8 eyebrow mb-8">
            <HelpCircle size={14} strokeWidth={1.75} aria-hidden="true" />
            Open questions
          </p>
          <ul className="list-disc pl-24 marker:text-ink space-y-4 text-body-sm text-graphite">
            {topic.open_questions.map((q, i) => (
              <li key={i}>{parseInlineMarkdown(q)}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

// Structured (JSON-mode) notes. Each section is indexed with a numbered step badge.
export default function SummaryJson({ notes }) {
  const actionItems = notes.action_items || [];
  const topics = getTopics(notes);
  const participants = notes.participants || [];
  const statusUpdate = notes.status_update;
  const hasStatus = statusUpdate && (statusUpdate.completion_estimate || statusUpdate.remaining_scope?.length > 0);
  const notableMentions = notes.notable_mentions || [];
  const hasOverview = participants.length > 0 || hasStatus;

  let n = 0;
  const next = () => ++n;

  return (
    <div className="space-y-64 fade-in">
      {hasOverview && (
        <section>
          <SectionHeading n={next()}>Overview</SectionHeading>
          <div className="space-y-24">
            {hasStatus && <StatusUpdateCard statusUpdate={statusUpdate} />}
            {participants.length > 0 && <Participants participants={participants} />}
          </div>
        </section>
      )}

      <ActionItemsList items={actionItems} n={next()} />

      {topics.length > 0 && (
        <section>
          <SectionHeading
            n={next()}
            aside={<span className="text-caption text-graphite tabular">{topics.length}</span>}
          >
            Key topics
          </SectionHeading>
          <div className="space-y-24">
            {topics.map((topic, idx) => (
              <TopicCard key={idx} topic={topic} idx={idx} />
            ))}
          </div>
        </section>
      )}

      {notableMentions.length > 0 && (
        <section>
          <SectionHeading n={next()}>Mentions &amp; risks</SectionHeading>
          <div className="card-compact">
            <ul className="list-disc pl-24 marker:text-ink space-y-8 text-body-sm text-graphite">
              {notableMentions.map((item, idx) => (
                <li key={idx}>{parseInlineMarkdown(item)}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
