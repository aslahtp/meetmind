// `MeetMind --smoke` (or `electron . --smoke`): a headless self-test of a packaged app, run by CI
// on the Windows, macOS and Linux builds since there is no Mac or Linux machine to click through. Uses a throwaway
// profile, opens no window but the meeting overlay for a moment, prints one line
// `MEETMIND_SMOKE {json}` and exits 0 if every check passed, 1 otherwise.
//
// Checks: config + database open; ffmpeg/ffprobe are found and run; ffmpeg encodes a 1 s Opus
// WebM (what the renderer records) and convertWebmToWav turns it into 16 kHz WAV; ffprobe reads
// its duration; koffi loads (Windows, macOS); on Linux, pactl reaches the audio server and the
// bundled ffmpeg records a second from the default output's monitor (the FFmpeg fallback); the
// permissions API answers; the meeting-detection backend loads and returns lists, including the
// WASAPI audio sessions (Windows) or PulseAudio recording streams (Linux) it reads the mic users
// from; the meeting overlay window loads, shows a prompt and its renderer acknowledges it.

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
    // Nothing loads koffi on Linux, and electron-builder leaves its Linux binaries out.
    if (process.platform === 'linux') return { skipped: 'not used on Linux' };
    const koffi = require('koffi');
    return { version: koffi.version || 'loaded' };
  });

  if (process.platform === 'linux') {
    await check('linux-audio', async () => {
      const { pulseInfo } = require('./audio/pulse');
      const { ffmpegSupportsPulse } = require('./audio/recorder');
      // The bundled build must record from PulseAudio; a distro ffmpeg in development may not.
      const pulseInput = !!ffmpeg && ffmpegSupportsPulse(ffmpeg.path);
      if (ffmpeg?.source === 'bundled' && !pulseInput) throw new Error('bundled ffmpeg has no pulse input');
      let info;
      try {
        info = await pulseInfo();
      } catch (err) {
        return { available: false, reason: err.message, pulseInput };
      }
      if (!info.defaultSink || !pulseInput) return { available: true, ...info, pulseInput, recorded: false };
      // Records 1 s of the default output's monitor, as the FFmpeg fallback does.
      const wav = path.join(profile, 'monitor.wav');
      await run(ffmpeg.path, ['-hide_banner', '-f', 'pulse', '-i', `${info.defaultSink}.monitor`, '-t', '1', '-ac', '1', '-ar', '16000', '-y', wav]);
      const { getMediaDurationSeconds } = require('./audio/recorder');
      const seconds = getMediaDurationSeconds(wav);
      if (!(seconds > 0.5)) throw new Error(`unexpected monitor recording duration: ${seconds}`);
      return { available: true, ...info, pulseInput, recorded: seconds };
    });
  }

  await check('permissions', () => require('./services/permissions').getPermissionStatus());

  await check('meeting-detection', async () => {
    const isLinux = process.platform === 'linux';
    const backend = process.platform === 'win32' ? require('./detection/win32')
      : isLinux ? require('./detection/linux') : null;
    if (!backend) return { available: false, reason: `no backend for ${process.platform} yet` };
    if (!backend.isAvailable()) {
      // Linux needs pactl, which is a system package rather than part of the app.
      if (isLinux) return { available: false, reason: backend.getLoadError()?.message };
      throw new Error(backend.getLoadError()?.message || 'backend unavailable');
    }
    // Runs the WASAPI COM calls for real: a bad binding crashes here. An audio API error is only
    // reported, since CI runners may have no audio service and the app falls back to the registry.
    // The Linux readers refresh in the background, so read twice.
    backend.readMicUsers();
    if (isLinux) await new Promise((resolve) => setTimeout(resolve, 1500));
    const mic = backend.readMicUsers();
    const windows = backend.listVisibleWindows();
    if (!Array.isArray(mic.sessions) || !Array.isArray(mic.registry) || !Array.isArray(windows)) {
      throw new Error('backend returned non-arrays');
    }
    return {
      available: true,
      audioSessions: mic.sessionsError ? `unavailable: ${mic.sessionsError}` : 'ok',
      sessionMicApps: mic.sessions.length,
      registryMicApps: mic.registry.length,
      windows: windows.length,
    };
  });

  await check('meeting-overlay', async () => {
    const overlay = require('./overlay/overlay-window');
    overlay.registerOverlayIpc();
    const startedAt = Date.now();
    overlay.showOverlay({ mode: 'prompt', meeting: { key: 'smoke', title: 'Smoke test', platformLabel: 'Google Meet' } });
    try {
      // Only up to the renderer's acknowledgement: CI runners may not composite, so the paint
      // check that follows it in the app is skipped here.
      for (;;) {
        const phase = overlay.getOverlayPhase();
        if (phase === 'shown') return { ms: Date.now() - startedAt };
        if (phase === 'failed') throw new Error('overlay failed to show (see log)');
        if (Date.now() - startedAt > 15000) throw new Error(`overlay stuck in ${phase}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      overlay.destroyOverlay();
    }
  });

  const ok = checks.every((c) => c.ok);
  const report = { ok, version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, checks };
  process.stdout.write(`MEETMIND_SMOKE ${JSON.stringify(report)}\n`);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }
  app.exit(ok ? 0 : 1);
});
