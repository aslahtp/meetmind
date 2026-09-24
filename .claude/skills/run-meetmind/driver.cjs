#!/usr/bin/env node
// MeetMind Electron driver for agents.
//
// Launches the BUILT app (dist/renderer) with an isolated --user-data-dir so it
// never touches the real profile (config, API keys, meetmind.db) and never
// collides with a MeetMind instance the user already has open. Seeds demo
// meetings, then either runs a scripted screenshot tour or reads commands from
// stdin.
//
//   node .claude/skills/run-meetmind/driver.cjs tour
//   printf 'nav Meetings\nss meetings\nquit\n' | node .claude/skills/run-meetmind/driver.cjs repl
//
// Run from the repo root. Screenshots land in .claude/skills/run-meetmind/shots/.

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const SKILL_DIR = __dirname;
const ROOT = path.resolve(SKILL_DIR, '../../..');
const OUT = path.join(SKILL_DIR, 'shots');
const PROFILE = path.join(SKILL_DIR, '.profile');
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

let electron;
try {
  ({ _electron: electron } = require(path.join(SKILL_DIR, 'node_modules/playwright-core')));
} catch {
  console.error('playwright-core missing. Run: pnpm install --dir .claude/skills/run-meetmind');
  process.exit(1);
}

// ── Demo data ────────────────────────────────────────────────────────────────

const NOTES = {
  meeting_title: 'Q4 roadmap sync',
  title: 'Q4 roadmap sync',
  sentiment: 'positive',
  participants: [
    { label: 'Speaker 1', name: 'Anjali Menon', role: 'Product lead', identity_confidence: 'confirmed' },
    { label: 'Speaker 2', name: 'Rahul Nair', role: 'Engineering', identity_confidence: 'inferred' },
    { label: 'Speaker 3', name: null, role: null, identity_confidence: 'unknown' },
  ],
  attendees: ['Anjali Menon', 'Rahul Nair', 'Speaker 3'],
  status_update: 'Mobile beta ships next Friday. Payments migration slips one week pending the vendor contract.',
  sections: [
    {
      heading: 'Mobile beta scope',
      content: '- Offline mode is **in** for beta\n- Push notifications move to v1.1\n- QA sign-off needed by Wednesday',
      options_discussed: ['Ship without offline mode', 'Delay beta one week'],
      decision: 'Ship beta on Friday with offline mode; push notifications deferred.',
      open_questions: ['Who owns the TestFlight rollout?'],
    },
    {
      heading: 'Payments migration',
      content: 'Vendor contract still under legal review. Rahul will prepare a fallback plan using the existing provider.',
      options_discussed: [],
      decision: null,
      open_questions: ['Can legal finish review by the 30th?'],
    },
  ],
  action_items: [
    { task: 'Finalise beta release notes', owner: 'Anjali', priority: 'high', due: 'Thu' },
    { task: 'Draft payments fallback plan', owner: 'Rahul', priority: 'medium' },
    { task: 'Book QA regression slot', owner: 'All', priority: 'low' },
  ],
  notable_mentions: ['Customer X asked for Malayalam UI support'],
};

const TRANSCRIPT = [
  { speaker: 'Anjali Menon', text: 'Okay, let us start with the mobile beta. Where are we on offline mode?', startTime: 2 },
  { speaker: 'Rahul Nair', text: 'Offline mode is done, QA is testing it now. Push notifications are the risk.', startTime: 9 },
  { speaker: 'Anjali Menon', text: 'Then let us move push to 1.1 and ship Friday.', startTime: 17 },
  { speaker: 'Speaker 3', text: 'Payments vendor contract is still with legal, so that slips a week.', startTime: 25 },
];

const MARKDOWN_NOTES = {
  meeting_title: 'Weekly standup',
  _rawMarkdown: '# Weekly standup\n\n## Updates\n- **Rahul:** API rate limiting merged\n- **Anjali:** onboarding copy review\n\n## Blockers\n1. Staging DB is slow\n\n> Next standup moves to 10:30.',
};

// The app keeps sessions in <userData>/meetmind.db (sql.js). Main-process
// modules can't be required from electronApp.evaluate (process.mainModule is
// undefined there), so the DB file is written before launch instead.
async function seedProfile({ fresh }) {
  if (fresh) fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const dbPath = path.join(PROFILE, 'meetmind.db');
  if (fs.existsSync(dbPath)) return;

  const initSqlJs = require(path.join(ROOT, 'node_modules/sql.js'));
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Untitled Meeting', meeting_url TEXT,
    started_at DATETIME, ended_at DATETIME, duration_seconds INTEGER, audio_path TEXT,
    transcript TEXT, notes TEXT, notion_page_url TEXT, status TEXT NOT NULL DEFAULT 'recording')`);
  const now = Date.now();
  const add = (id, title, minsAgo, status, extra = {}) => db.run(
    'INSERT INTO sessions (id,title,meeting_url,started_at,ended_at,duration_seconds,transcript,notes,notion_page_url,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, title, 'https://meet.google.com/abc-defg-hij',
      new Date(now - minsAgo * 60000).toISOString(), new Date(now - (minsAgo - 42) * 60000).toISOString(), 42 * 60 + 13,
      extra.transcript || null, extra.notes || null, extra.notion_page_url || null, status],
  );
  add('demo-1', 'Q4 roadmap sync', 90, 'complete', { notes: JSON.stringify(NOTES), transcript: JSON.stringify(TRANSCRIPT), notion_page_url: 'https://notion.so/demo' });
  add('demo-2', 'Hiring panel debrief', 60 * 26, 'error');
  add('demo-3', 'Design review', 20, 'generating', { transcript: JSON.stringify(TRANSCRIPT) });
  add('demo-4', 'Weekly standup', 60 * 50, 'complete', { notes: JSON.stringify(MARKDOWN_NOTES), transcript: JSON.stringify(TRANSCRIPT) });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

// ── Launch + helpers ─────────────────────────────────────────────────────────

async function launch() {
  if (!fs.existsSync(path.join(ROOT, 'dist/renderer/index.html'))) {
    throw new Error('dist/renderer missing. Run: pnpm exec vite build');
  }
  const env = { ...process.env };
  delete env.NODE_ENV; // NODE_ENV=development makes main.js load http://localhost:5173 instead of dist/

  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['.', `--user-data-dir=${PROFILE}`],
    cwd: ROOT,
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (path.resolve(userData) !== path.resolve(PROFILE)) {
    await app.close();
    throw new Error(`Not isolated: userData=${userData}`);
  }

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const h = {
    app, page, errors,
    async size(w, hgt) {
      await app.evaluate(({ BrowserWindow }, [W, H]) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.unmaximize(); win.setSize(W, H); win.center(); win.show();
      }, [w, hgt]);
      await page.waitForTimeout(300);
    },
    async ss(name) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.waitForTimeout(400);
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      console.log('shot', path.relative(ROOT, file));
    },
    // Top-bar nav is scoped: "Dashboard"/"Settings" text also appears in page bodies.
    async nav(label) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: label }).click();
      await page.waitForTimeout(300);
    },
    async tab(name) { await page.getByRole('tab', { name: new RegExp(name, 'i') }).first().click(); await page.waitForTimeout(200); },
    // Button names match as case-insensitive substrings (not regex).
    async click(text, force = false) { await page.getByRole('button', { name: text }).first().click({ force, timeout: 10000 }); await page.waitForTimeout(300); },
    async theme(t) {
      await page.evaluate((v) => window.meetmind.config.set('theme', v), t);
      await page.reload(); await page.waitForTimeout(1200);
    },
    // Wheel events only scroll if the pointer is over the scroll container, not the top bar.
    async scroll(dy) { await page.mouse.move(550, 500); await page.mouse.wheel(0, dy); await page.waitForTimeout(300); },
  };

  await h.size(1100, 720);
  await page.reload();
  await page.waitForTimeout(1500);
  return h;
}

// ── Modes ────────────────────────────────────────────────────────────────────

async function tour(h) {
  for (const t of ['light', 'dark']) {
    if (t === 'dark') await h.theme('dark');
    await h.nav('Dashboard'); await h.ss(`${t}-01-dashboard`);
    await h.scroll(900); await h.ss(`${t}-02-dashboard-scrolled`);
    await h.nav('Meetings'); await h.ss(`${t}-03-meetings`);
    await h.click('Q4 roadmap sync'); await h.ss(`${t}-04-session-summary`);
    await h.tab('Transcript'); await h.ss(`${t}-05-session-transcript`);
    await h.tab('Audio'); await h.ss(`${t}-06-session-audio`);
    await h.nav('Meetings'); await h.click('Design review'); await h.ss(`${t}-07-session-processing`);
    await h.nav('Meetings'); await h.click('Weekly standup'); await h.ss(`${t}-08-session-markdown`);
    await h.nav('Settings');
    for (const s of ['General', 'Transcription', 'Notes', 'Integrations', 'System']) {
      await h.tab(s); await h.ss(`${t}-09-settings-${s.toLowerCase()}`);
    }
    await h.nav('Logs'); await h.page.waitForTimeout(600); await h.ss(`${t}-10-logs`);
  }
  await h.theme('light');
  await h.size(800, 600);
  await h.nav('Dashboard'); await h.ss('small-01-dashboard');
  await h.nav('Meetings'); await h.ss('small-02-meetings');
}

// One command per line on stdin:
//   nav <Dashboard|Meetings|Settings|Logs>   tab <name>   click <button name>   fclick <name>   dclick <name in dialog>
//   ss <name>        theme <light|dark|system>   size <w> <h>   scroll <dy>
//   focus <css>      type <text>      key <Key>        wait <ms>   eval <js expression>   errors   quit
async function repl(h) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const raw of rl) {
    const line = raw.replace(/\r$/, '').replace(/^\s+/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [cmd, ...rest] = line.split(' ');
    const rawArg = line.slice(cmd.length + 1); // untrimmed, for `type`
    const arg = rawArg.trim();
    try {
      if (cmd === 'quit') break;
      else if (cmd === 'nav') await h.nav(arg);
      else if (cmd === 'tab') await h.tab(arg);
      else if (cmd === 'click') await h.click(arg);
      else if (cmd === 'fclick') await h.click(arg, true); // hover-only / overlaid buttons (e.g. card delete)
      else if (cmd === 'dclick') { await h.page.getByRole('dialog').getByRole('button', { name: arg }).first().click({ timeout: 10000 }); await h.page.waitForTimeout(300); } // inside the open dialog
      else if (cmd === 'ss') await h.ss(arg || `shot-${Date.now()}`);
      else if (cmd === 'theme') await h.theme(arg);
      else if (cmd === 'size') await h.size(Number(rest[0]), Number(rest[1]));
      else if (cmd === 'scroll') await h.scroll(Number(arg) || 600);
      else if (cmd === 'focus') await h.page.locator(arg).first().click(); // CSS selector, e.g. focus textarea
      else if (cmd === 'type') await h.page.keyboard.type(rawArg);
      else if (cmd === 'key') await h.page.keyboard.press(arg);
      else if (cmd === 'wait') await h.page.waitForTimeout(Number(arg) || 500);
      else if (cmd === 'eval') console.log('=>', JSON.stringify(await h.page.evaluate(arg)));
      else if (cmd === 'errors') console.log('errors:', JSON.stringify(h.errors));
      else console.log('unknown command:', cmd);
      if (cmd !== 'eval' && cmd !== 'errors' && cmd !== 'ss') console.log('ok', line);
    } catch (e) {
      console.log('ERR', line, '-', e.message.split('\n')[0]);
    }
  }
}

(async () => {
  const mode = process.argv[2] || 'tour';
  const fresh = process.argv.includes('--fresh');
  await seedProfile({ fresh });
  const h = await launch();
  try {
    if (mode === 'repl') await repl(h);
    else await tour(h);
    console.log('console errors:', JSON.stringify(h.errors));
  } finally {
    await h.app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
