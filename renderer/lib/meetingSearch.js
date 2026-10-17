// Full-text search over meetings: titles, notes and transcripts.
// Pure (no React/DOM) so it stays unit-testable. Meaning-aware without an embedding model:
//   • normalisation + light stemming, so "decided"/"deciding" and "price"/"pricing" meet
//   • a curated meeting-vocabulary concept map, so "deadline" also finds "due" and "eta"
//   • BM25 ranking over weighted fields, so rare words and title hits count for more
//   • typo tolerance and as-you-type prefixes against the corpus vocabulary
//   • partial matching for long natural-language queries ("what did we decide about pricing")
//   • "quoted phrases" that must appear verbatim

import { sessionDisplayTitle, speakerName } from './format.js';

// ── Text pipeline ───────────────────────────────────────────────────────────

// Letters, combining marks and digits in any script, so Malayalam (whose vowel signs are
// combining marks) tokenises into whole words alongside English.
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;

const STOP_WORDS = new Set(`
  a about above after again all also am an and any are as at be because been before being
  below between both but by can could did do does doing down during each few for from further
  had has have having he her here hers him his how i if in into is it its itself just let lets
  me more most my no nor of off on once only or other our ours out over own same she should so
  some such than that the their theirs them then there these they this those through to too
  under until up us very was we were what when where which while who whom why will with would
  you your yours yourself ok okay yeah hey hi um uh like get got discuss discussed talk talked
  say said tell told meeting meetings
`.split(/\s+/).filter(Boolean));

/** Lowercase and fold Latin accents (only U+0300–036F, so other scripts keep their marks). */
function normalizeWord(word) {
  return word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

const UNDOUBLE_EXEMPT = new Set(['l', 's', 'z']);

/**
 * A deliberately small English suffix stripper (Porter-lite). It only has to map related
 * forms to the same key, never produce real words. Non-Latin words pass through unchanged.
 */
export function stem(word) {
  if (word.length <= 3 || !/^[a-z]+$/.test(word)) return word;
  let w = word;
  let stripped = false;
  if (w.endsWith('ies') && w.length > 4) {
    w = `${w.slice(0, -3)}y`;
  } else if (w.endsWith('sses')) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ments') && w.length - 5 >= 4) {
    w = w.slice(0, -5);
  } else if (w.endsWith('ment') && w.length - 4 >= 4) {
    w = w.slice(0, -4);
  } else if (w.endsWith('ing') && w.length - 3 >= 3) {
    w = w.slice(0, -3);
    stripped = true;
  } else if (w.endsWith('ed') && w.length - 2 >= 3) {
    w = w.slice(0, -2);
    stripped = true;
  } else if (w.endsWith('ly') && w.length - 2 >= 4) {
    w = w.slice(0, -2);
  } else if (/(?:s|x|z|ch|sh)es$/.test(w)) {
    w = w.slice(0, -2);
  } else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w) && w.length - 1 >= 3) {
    w = w.slice(0, -1);
  }
  // planned → plann → plan, but called → call.
  if (stripped && w.length > 3) {
    const last = w[w.length - 1];
    if (last === w[w.length - 2] && !/[aeiou]/.test(last) && !UNDOUBLE_EXEMPT.has(last)) w = w.slice(0, -1);
  }
  // price/pricing/priced → pric; agreed/agree stay agre.
  if (!stripped && w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** The search key of one surface word. */
function termOf(word) {
  return stem(normalizeWord(word));
}

/** Search keys of a text, stop words removed. */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  for (const m of String(text).matchAll(WORD_RE)) {
    const norm = normalizeWord(m[0]);
    if (!STOP_WORDS.has(norm)) out.push(stem(norm));
  }
  return out;
}

/** Normalised words joined by single spaces, padded, for verbatim phrase checks. */
function flatten(text) {
  if (!text) return ' ';
  const words = [];
  for (const m of String(text).matchAll(WORD_RE)) words.push(normalizeWord(m[0]));
  return ` ${words.join(' ')} `;
}

// ── Concept map ─────────────────────────────────────────────────────────────

// Words people use interchangeably about meetings. A query term also matches the other
// members of its groups, at a lower weight than the word itself.
export const CONCEPTS = [
  ['deadline', 'due', 'eta', 'timeline', 'schedule'],
  ['decide', 'decision', 'decided', 'agree', 'agreed', 'agreement', 'conclude', 'conclusion', 'resolve', 'resolved', 'approve', 'approved', 'finalize', 'finalized'],
  ['task', 'todo', 'action', 'assign', 'assigned', 'owner', 'followup'],
  ['bug', 'issue', 'error', 'problem', 'defect', 'crash', 'fault', 'glitch', 'broken'],
  ['budget', 'cost', 'price', 'pricing', 'spend', 'expense', 'money', 'funding', 'payment', 'invoice', 'revenue'],
  ['hire', 'hiring', 'recruit', 'recruiting', 'candidate', 'interview', 'onboarding', 'headcount'],
  ['launch', 'release', 'ship', 'deploy', 'deployment', 'rollout', 'golive'],
  ['risk', 'concern', 'blocker', 'blocked', 'obstacle', 'challenge', 'worry'],
  ['customer', 'client', 'user', 'buyer'],
  ['plan', 'roadmap', 'strategy', 'goal', 'objective', 'milestone', 'okr'],
  ['question', 'unclear', 'unresolved'],
  ['feedback', 'review', 'opinion', 'comment', 'suggestion'],
  ['metric', 'kpi', 'stat', 'analytics'],
  ['design', 'ui', 'ux', 'mockup', 'wireframe', 'prototype'],
  ['contract', 'agreement', 'deal', 'proposal', 'quote'],
  ['marketing', 'campaign', 'promotion', 'ads', 'advertising'],
  ['sales', 'pipeline', 'lead', 'prospect', 'deal'],
  ['vacation', 'leave', 'holiday', 'pto'],
  ['urgent', 'asap', 'priority', 'critical', 'important'],
];

// stemmed term → Set of stemmed related terms (itself excluded)
const RELATED = (() => {
  const map = new Map();
  for (const group of CONCEPTS) {
    const terms = [...new Set(group.map(termOf))];
    for (const t of terms) {
      if (!map.has(t)) map.set(t, new Set());
      for (const other of terms) if (other !== t) map.get(t).add(other);
    }
  }
  return map;
})();

// ── Documents ───────────────────────────────────────────────────────────────

const W = { title: 3, strong: 2, people: 1.5, body: 1, transcript: 0.6, link: 0.5 };

/** Text of a string, or of an object's string values (notes fields vary by prompt). */
function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' · ');
  if (typeof value === 'object') return Object.values(value).map(textOf).filter(Boolean).join(' · ');
  return '';
}

/** Markdown → readable plain text for snippets. */
// A Markdown table's |---|:---:| rule row.
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
}

function plainText(text) {
  return String(text)
    .split('\n')
    .filter((line) => !TABLE_RULE.test(line))
    .map((line) => (/^\s*\|/.test(line) ? tableCells(line).join(' · ') : line))
    .join('\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markdown notes, one passage per line so snippets stay short, each labelled with its
 * heading. Table header rows are skipped: "Deadline" in a header isn't about deadlines.
 */
function addMarkdown(md, add) {
  const lines = md.split(/\r?\n/);
  let label = 'Notes';
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || TABLE_RULE.test(trimmed)) return;
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      label = `Notes · ${plainText(heading[1])}`;
      add(label, heading[1], W.strong);
    } else if (trimmed.startsWith('|')) {
      if (!TABLE_RULE.test(lines[i + 1] || '')) add(label, tableCells(trimmed).join(' · '), W.body);
    } else {
      add(label, trimmed, W.body);
    }
  });
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Every searchable passage of a session: { label, text, weight, snippet, display }.
 * `snippet: false` passages are never shown as the match; `display` is shown instead of `text`.
 */
function collectPassages(session) {
  const out = [];
  const add = (label, value, weight, snippet = true, display) => {
    const text = plainText(textOf(value));
    if (text) out.push({ label, text, weight, snippet, display: display ? plainText(display) : text });
  };

  const title = sessionDisplayTitle(session);
  add('Title', title, W.title, false);
  const notes = session.notes && typeof session.notes === 'object' ? session.notes : null;
  if (notes?.meeting_title && notes.meeting_title !== title) add('Title', notes.meeting_title, W.title, false);

  if (notes) {
    if (notes.summary) add('Summary', notes.summary, W.body);
    // sections/topics/key_points are the same array after normalisation; index it once.
    const sections = [notes.sections, notes.topics, notes.key_points].find(Array.isArray) || [];
    for (const sec of sections) {
      if (!sec || typeof sec !== 'object') {
        add('Notes', sec, W.body);
        continue;
      }
      const label = sec.heading ? `Notes · ${plainText(sec.heading)}` : 'Notes';
      add(label, sec.heading, W.strong);
      add(label, sec.content, W.body);
      if (sec.summary !== sec.content) add(label, sec.summary, W.body);
      add('Decision', sec.decision, W.strong);
      add(label, sec.options_discussed, W.body);
      add('Open question', sec.open_questions, W.body);
    }
    for (const item of Array.isArray(notes.action_items) ? notes.action_items : []) {
      if (item && typeof item === 'object') {
        const task = textOf(item.task || item.text || item.description);
        const due = item.due ? `due ${textOf(item.due)}` : '';
        const details = [textOf(item.owner), due].filter(Boolean).join(', ');
        const display = task && details ? `${task} (${details})` : '';
        add('Action item', task, W.strong);
        if (item.owner) add('Action item', item.owner, W.people, true, display);
        // "due Thu", so "deadline" (a relative of "due") finds items that have one.
        if (due) add('Action item', due, W.body, true, display);
      } else {
        add('Action item', item, W.strong);
      }
    }
    add('Decision', notes.decisions, W.strong);
    add('Open question', notes.questions_unresolved, W.body);
    for (const p of Array.isArray(notes.participants) ? notes.participants : []) {
      add('Participants', typeof p === 'object' && p ? [p.name, p.label, p.role] : p, W.people);
    }
    add('Participants', notes.attendees, W.people);
    add('Mentioned', notes.notable_mentions, W.body);
    if (typeof notes._rawMarkdown === 'string') addMarkdown(notes._rawMarkdown, add);
  }

  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const speakers = new Set();
  for (const seg of transcript) {
    if (!seg) continue;
    const speaker = speakerName(seg.speaker);
    speakers.add(speaker);
    add(`Transcript · ${speaker}`, seg.text, W.transcript);
  }
  if (speakers.size) add('Speakers', [...speakers].join(', '), W.people);
  if (session.meeting_url) add('Link', hostname(session.meeting_url), W.link, false);
  return out;
}

const docCache = new WeakMap(); // session object → document

/** Weighted term frequencies, length and passages of one session, cached per object. */
function sessionDocument(session) {
  let doc = docCache.get(session);
  if (doc) return doc;
  const passages = [];
  const tf = new Map();
  let length = 0;
  for (const p of collectPassages(session)) {
    const tokens = tokenize(p.text);
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + p.weight);
    length += tokens.length * p.weight;
    passages.push({ ...p, terms: new Set(tokens) });
  }
  const titleFlat = flatten(passages.filter((p) => p.label === 'Title').map((p) => p.text).join(' '));
  const flat = flatten(passages.map((p) => p.text).join(' \n '));
  doc = { tf, length, passages, titleFlat, flat };
  docCache.set(session, doc);
  return doc;
}

const corpusCache = new WeakMap(); // sessions array → corpus stats

function corpusOf(sessions) {
  let corpus = corpusCache.get(sessions);
  if (corpus) return corpus;
  const df = new Map();
  let total = 0;
  for (const s of sessions) {
    const doc = sessionDocument(s);
    total += doc.length;
    for (const t of doc.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  corpus = { df, n: sessions.length, avgLength: sessions.length ? total / sessions.length : 0 };
  corpusCache.set(sessions, corpus);
  return corpus;
}

// ── Query ───────────────────────────────────────────────────────────────────

/** Damerau-Levenshtein (optimal string alignment) distance, giving up past `max`. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length][b.length];
}

const WEIGHT = { exact: 1, prefix: 0.7, related: 0.6, fuzzy: 0.5 };

/**
 * Split a query into term groups. Each group is one query word plus the variants that may
 * stand in for it: concept-map relatives, vocabulary prefixes (last word only, as the user is
 * still typing) and close spellings for words the corpus doesn't contain.
 */
function parseQuery(query, df) {
  const phrases = [];
  const loose = query.replace(/"([^"]+)"/g, (_, p) => {
    if (flatten(p).trim()) phrases.push(flatten(p));
    return ` ${p} `;
  });
  const typingLast = !/["\s]$/.test(query);

  const words = [...loose.matchAll(WORD_RE)].map((m) => normalizeWord(m[0])).filter((w) => !STOP_WORDS.has(w));

  const groups = [];
  const seen = new Set();
  words.forEach((word, i) => {
    const term = stem(word);
    if (seen.has(term)) return;
    seen.add(term);
    const variants = new Map([[term, WEIGHT.exact]]);
    const put = (t, w) => {
      if ((variants.get(t) || 0) < w) variants.set(t, w);
    };
    for (const rel of RELATED.get(term) || []) put(rel, WEIGHT.related);
    const known = df.has(term);
    if (typingLast && i === words.length - 1 && word.length >= 2) {
      for (const t of df.keys()) {
        if (t !== term && (t.startsWith(word) || t.startsWith(term))) put(t, WEIGHT.prefix);
        // "meeti" → meet: the stem of a half-typed word can be shorter than the word.
        else if (!known && t.length >= 4 && word.startsWith(t) && word.length - t.length <= 2) put(t, WEIGHT.prefix);
      }
    }
    if (!known && /^[a-z]+$/.test(term) && term.length >= 5) {
      const max = term.length >= 8 ? 2 : 1;
      for (const t of df.keys()) {
        if (t !== term && editDistance(term, t, max) <= max) put(t, WEIGHT.fuzzy);
      }
    }
    groups.push({ term, variants });
  });

  const flat = flatten(loose);
  // Nothing but stop words ("to do"): search for the words verbatim instead.
  if (!groups.length && !phrases.length && flat.trim()) phrases.push(flat);
  return { groups, phrases, flat };
}

const K1 = 1.2;
const B = 0.5; // gentle length normalisation: long transcripts shouldn't bury title hits

function bm25(tf, df, n, length, avgLength) {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const norm = tf + K1 * (1 - B + (B * length) / (avgLength || 1));
  return (idf * tf * (K1 + 1)) / norm;
}

// ── Snippets ────────────────────────────────────────────────────────────────

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 48;

/** About SNIPPET_LENGTH characters of `text`, starting a little before the first hit. */
function snippetAround(text, terms) {
  if (text.length <= SNIPPET_LENGTH) return text;
  let hit = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (terms.has(termOf(m[0]))) {
      hit = m.index;
      break;
    }
  }
  let start = Math.max(0, Math.min(hit - SNIPPET_LEAD, text.length - SNIPPET_LENGTH));
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < hit) start = space + 1;
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > hit) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Split text into runs, marking words whose search key is in `terms`, for highlighting.
 * @returns {{ text: string, hit: boolean }[]}
 */
export function highlightParts(text, terms) {
  if (!text) return [];
  if (!terms || !terms.size) return [{ text, hit: false }];
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (!terms.has(termOf(m[0]))) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Search sessions by title, notes and transcript.
 *
 * @param {Array} sessions
 * @param {string} query
 * @returns {Map<string, { score: number, label: string|null, snippet: string|null, terms: Set<string> }>|null}
 *   matches by session id, or null when the query is empty (everything matches)
 */
export function searchSessions(sessions, query) {
  const q = (query || '').trim();
  if (!q || !Array.isArray(sessions)) return null;

  const corpus = corpusOf(sessions);
  // Untrimmed, so a trailing space marks the last word as finished (no prefix matching).
  const { groups, phrases, flat: queryFlat } = parseQuery(query, corpus.df);
  const results = new Map();
  if (!groups.length && !phrases.length) return results;

  const required = groups.length <= 2 ? groups.length : Math.ceil(groups.length * 0.6);
  const rawQuery = q.toLowerCase();

  for (const session of sessions) {
    const doc = sessionDocument(session);
    if (phrases.some((p) => !doc.flat.includes(p))) continue;

    let score = 0;
    let matched = 0;
    const terms = new Set();
    for (const g of groups) {
      let best = 0;
      for (const [t, w] of g.variants) {
        const tf = doc.tf.get(t);
        if (!tf) continue;
        terms.add(t);
        best = Math.max(best, w * bm25(tf, corpus.df.get(t) || 0, corpus.n, doc.length, corpus.avgLength));
      }
      if (best > 0) {
        matched++;
        score += best;
      }
    }

    // Literal hits keep old substring behaviour ("one-on" still finds "One-on-One").
    const literalTitle = sessionDisplayTitle(session).toLowerCase().includes(rawQuery);
    if (matched < required && !literalTitle) continue;
    if (groups.length) score *= matched / groups.length;
    const queryWords = queryFlat.trim().split(' ').length;
    if (literalTitle || (queryWords > 1 && doc.titleFlat.includes(queryFlat))) score += 3;
    else if (queryWords > 1 && doc.flat.includes(queryFlat)) score += 1;
    score += phrases.length;

    // Snippet: the passage (outside the title, which the card already shows) covering the
    // most query groups, weighted by how important that kind of passage is.
    let bestPassage = null;
    let bestScore = 0;
    for (const p of doc.passages) {
      if (!p.snippet) continue;
      let covered = 0;
      for (const g of groups) {
        let gw = 0;
        for (const [t, w] of g.variants) if (p.terms.has(t)) gw = Math.max(gw, w);
        covered += gw;
      }
      if (phrases.length && phrases.some((ph) => flatten(p.text).includes(ph))) covered += 1;
      const s = covered * (1 + p.weight / 4);
      if (covered > 0 && s > bestScore) {
        bestScore = s;
        bestPassage = p;
      }
    }

    results.set(session.id, {
      score,
      label: bestPassage?.label || null,
      snippet: bestPassage ? snippetAround(bestPassage.display, terms) : null,
      terms,
    });
  }
  return results;
}
