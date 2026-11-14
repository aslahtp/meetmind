#!/usr/bin/env node
// Measures MeetMind's memory and CPU per process in four states: window open, window hidden,
// recording (window hidden) and tray only (main window destroyed, as after 10 minutes in the tray).
//
//   node .claude/skills/run-meetmind/profile.cjs --profile <userDataDir> [--app <dir>] [--label x]
//        [--sample 30] [--record 60]
//
// Runs the BUILT app in --app (default: this repo; build it first with `pnpm run compile:electron
// && pnpm exec vite build`). --profile must be a throwaway userData folder (copy of a seeded
// run-meetmind .profile): recording writes real microphone/system audio into it. Prints one JSON
// report. CPU is the share of one core, from each process's cumulative CPU time over --sample s.
// Uses this skill's playwright-core (pnpm install --dir .claude/skills/run-meetmind).

const path = require('path');
const os = require('os');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const SKILL_DIR = __dirname;
const APP = path.resolve(args.app || path.resolve(SKILL_DIR, '../../..'));
const PROFILE = args.profile && path.resolve(args.profile);
const SAMPLE_S = Number(args.sample || 30);
const RECORD_S = Number(args.record || 60);
if (!PROFILE) { console.error('--profile <throwaway userData dir> is required'); process.exit(1); }

const { _electron: electron } = require(path.join(SKILL_DIR, 'node_modules/playwright-core'));
const ELECTRON = require(path.join(APP, 'node_modules/electron'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot(app) {
  return app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type === 'Utility' ? `Utility: ${m.serviceName || m.name || '?'}` : m.type,
    cpuSeconds: m.cpu.cumulativeCPUUsage ?? 0,
    privateKB: m.memory.privateBytes ?? m.memory.workingSetSize,
    workingSetKB: m.memory.workingSetSize,
  })));
}

// CPU over `seconds` (share of one core) and memory at the end, per process type.
async function sample(app, seconds) {
  const before = new Map((await snapshot(app)).map((p) => [p.pid, p]));
  await sleep(seconds * 1000);
  const after = await snapshot(app);
  const byType = {};
  let cpu = 0, priv = 0;
  for (const p of after) {
    const start = before.get(p.pid);
    const share = start ? ((p.cpuSeconds - start.cpuSeconds) / seconds) * 100 : 0;
    const row = (byType[p.type] ||= { count: 0, cpuPercent: 0, privateMB: 0 });
    row.count += 1;
    row.cpuPercent += share;
    row.privateMB += p.privateKB / 1024;
    cpu += share; priv += p.privateKB / 1024;
  }
  for (const row of Object.values(byType)) {
    row.cpuPercent = Math.round(row.cpuPercent * 100) / 100;
    row.privateMB = Math.round(row.privateMB * 10) / 10;
  }
  const main = await app.evaluate(() => {
    const mu = process.memoryUsage();
    return { heapMB: Math.round(mu.heapUsed / 1048576), rssMB: Math.round(mu.rss / 1048576) };
  });
  return { cpuPercent: Math.round(cpu * 100) / 100, privateMB: Math.round(priv * 10) / 10, processes: after.length, byType, main };
}

(async () => {
  const env = { ...process.env };
  delete env.NODE_ENV; // development mode would load the Vite dev server instead of dist/
  const t0 = Date.now();
  const app = await electron.launch({ executablePath: ELECTRON, args: ['.', `--user-data-dir=${PROFILE}`], cwd: APP, env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForSelector('nav[aria-label=Main]', { timeout: 60000 });
  const startupMs = Date.now() - t0;
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (path.resolve(userData) !== PROFILE) throw new Error(`Not isolated: userData=${userData}`);
  const version = await app.evaluate(({ app: a }) => a.getVersion());

  const report = { label: args.label || version, version, startupMs, sampleSeconds: SAMPLE_S, machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` } };

  await sleep(15000); // let startup work settle
  report.windowOpen = await sample(app, SAMPLE_S);

  const hide = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed() && w.isVisible()) w.hide(); }));
  await hide();
  await sleep(10000);
  report.windowHidden = await sample(app, SAMPLE_S);

  // A real recording (microphone + system audio) with the window hidden, as during a meeting.
  const started = await page.evaluate(() => window.meetmind.recording.start());
  if (!started.success) throw new Error(`recording:start failed: ${started.error}`);
  await sleep(10000);
  report.recording = await sample(app, Math.min(SAMPLE_S * 1.5, RECORD_S - 10));
  const elapsed = 10 + Math.min(SAMPLE_S * 1.5, RECORD_S - 10);
  if (RECORD_S > elapsed) await sleep((RECORD_S - elapsed) * 1000);
  const stopped = await page.evaluate(() => window.meetmind.recording.stop());
  report.recordingStopped = stopped.success ? 'ok' : stopped.error;
  await sleep(20000); // conversion + the processing attempt (fails fast without API keys)

  // Tray only: the main window is destroyed 10 minutes after it is hidden; do it now.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.destroy(); }));
  await sleep(15000);
  report.trayOnly = await sample(app, SAMPLE_S);

  await app.close();
  console.log(JSON.stringify(report, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
