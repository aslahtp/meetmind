// `MeetMind --smoke` (or `electron . --smoke`): a headless self-test of a packaged app, run by CI
// on the macOS and Windows builds since there is no Mac to click through. Uses a throwaway
// profile, never opens a window, prints one line `MEETMIND_SMOKE {json}` and exits 0 if every
// check passed, 1 otherwise.
//
// Checks: config + database open; ffmpeg/ffprobe are found and run; ffmpeg encodes a 1 s Opus
// WebM (what the renderer records) and convertWebmToWav turns it into 16 kHz WAV; ffprobe reads
// its duration; koffi loads; the permissions API answers; the meeting-detection backend loads
// and returns lists.

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'meetmind-smoke-'));
app.setPath('userData', profile);
app.dock?.hide();

const checks = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail: detail ?? null });
  } catch (err) {
    checks.push({ name, ok: false, error: err?.message || String(err) });
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(-300)}`))));
  });
}

app.whenReady().then(async () => {
  await check('config', () => {
    const { getConfig } = require('./utils/config');
    const config = getConfig();
    return { theme: config.theme, macCaptureStrategy: config.macCaptureStrategy };
  });

  await check('database', async () => {
    const db = require('./db/sessions');
    await db.initialize();
    return { sessions: db.listSessions().length };
  });

  const { locate } = require('./audio/ffmpeg-path');
  let ffmpeg = null;
  await check('ffmpeg', async () => {
    ffmpeg = locate('ffmpeg');
    if (!ffmpeg) throw new Error('ffmpeg not found');
    await run(ffmpeg.path, ['-hide_banner', '-version']);
    return ffmpeg;
  });
  await check('ffprobe', async () => {
    const ffprobe = locate('ffprobe');
    if (!ffprobe) throw new Error('ffprobe not found');
    await run(ffprobe.path, ['-hide_banner', '-version']);
    return ffprobe;
  });

  await check('webm-to-wav', async () => {
    if (!ffmpeg) throw new Error('skipped: no ffmpeg');
    const { convertWebmToWav, getMediaDurationSeconds } = require('./audio/recorder');
    const webm = path.join(profile, 'tone.webm');
    const wav = path.join(profile, 'tone.wav');
    await run(ffmpeg.path, ['-hide_banner', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', webm]);
    await convertWebmToWav(webm, wav);
    const seconds = getMediaDurationSeconds(wav);
    if (!(seconds > 0.5)) throw new Error(`unexpected WAV duration: ${seconds}`);
    return { seconds };
  });

  await check('koffi', () => {
    const koffi = require('koffi');
    return { version: koffi.version || 'loaded' };
  });

  await check('permissions', () => require('./services/permissions').getPermissionStatus());

  await check('meeting-detection', () => {
    const backend = process.platform === 'win32' ? require('./detection/win32') : null;
    if (!backend) return { available: false, reason: `no backend for ${process.platform} yet` };
    if (!backend.isAvailable()) throw new Error(backend.getLoadError()?.message || 'backend unavailable');
    const mic = backend.listMicInUseApps();
    const windows = backend.listVisibleWindows();
    if (!Array.isArray(mic) || !Array.isArray(windows)) throw new Error('backend returned non-arrays');
    return { available: true, micApps: mic.length, windows: windows.length };
  });

  const ok = checks.every((c) => c.ok);
  const report = { ok, version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, checks };
  process.stdout.write(`MEETMIND_SMOKE ${JSON.stringify(report)}\n`);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }
  app.exit(ok ? 0 : 1);
});
