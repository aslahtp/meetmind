const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { EventEmitter } = require('events');

const { getFfmpegPath, validateFfmpegExists } = require('./ffmpeg-path');
const {
  buildAmixFilter,
  buildSingleDeviceArgs,
  parseDeviceList,
  detectSystemLoopback,
  detectDshowLoopback,
  detectMicrophone,
  isWasapiLoopback,
  WASAPI_LOOPBACK_ID,
  WASAPI_LOOPBACK_LABEL,
} = require('./mixer');
const { getConfig, setConfig } = require('../utils/config');
const logger = require('../utils/logger');

const recorder = new EventEmitter();

let ffmpegProcess = null;
let currentOutputPath = null;
let recordingStartTime = null;
let wasapiKnownUnsupported = false;

// ── Device enumeration ────────────────────────────────────────────────────────

async function listAudioDevices() {
  const ffmpegPath = getFfmpegPath();

  if (!fs.existsSync(ffmpegPath)) {
    logger.warn('FFmpeg not found, cannot list devices');
    return { system: [], mic: [], error: 'FFmpeg not found' };
  }

  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'info',
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy',
    ]);

    proc.stderr.on('data', (data) => { output += data.toString(); });
    proc.stdout.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      const dshowDevices = parseDeviceList(output);
      const micDevice = detectMicrophone(dshowDevices);
      const dshowLoopback = detectDshowLoopback(dshowDevices);

      if (dshowDevices.length === 0) {
        logger.warn('FFmpeg device list parse returned empty.', {
          outputLength: output.length,
          code,
          sample: output.slice(-1200),
        });
      }

      // Build unified device list: WASAPI Loopback first, then all dshow devices
      const wasapiEntry = { id: WASAPI_LOOPBACK_ID, label: WASAPI_LOOPBACK_LABEL };
      const allDevices = [wasapiEntry, ...dshowDevices.map((d) => ({ id: d, label: d }))];
      const systemLoopback = WASAPI_LOOPBACK_ID; // always prefer WASAPI

      logger.info('Audio devices enumerated', {
        wasapiLoopback: WASAPI_LOOPBACK_ID,
        dshowDevices,
        dshowLoopback,
        mic: micDevice,
      });

      // Auto-save detected devices to config if not already set
      const config = getConfig();
      if (!config.systemAudioDevice) {
        setConfig('systemAudioDevice', WASAPI_LOOPBACK_ID);
      }
      if (!config.micDevice && micDevice) {
        setConfig('micDevice', micDevice);
      }

      resolve({ all: allDevices, system: systemLoopback, mic: micDevice });
    });

    proc.on('error', (err) => {
      logger.error('Failed to enumerate audio devices', { error: err.message });
      resolve({ system: null, mic: null, error: err.message });
    });

    // FFmpeg often exits with code 1 after listing devices (dummy is invalid); allow up to 8s
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGTERM');
    }, 8000);
  });
}

// ── Recording ─────────────────────────────────────────────────────────────────

/**
 * Attempt to spawn FFmpeg with the given systemDevice + micDevice.
 * Resolves with the output path when FFmpeg confirms it has started writing.
 * Rejects with an error (including the raw FFmpeg output) if it fails.
 */
function _spawnFFmpegRecording(sessionId, systemDevice, micDevice, outputPath, ffmpegPath) {
  const { inputs, filterParts, outputArgs } = buildAmixFilter(systemDevice, micDevice);
  const ffmpegArgs = [
    '-hide_banner',
    ...inputs,
    ...filterParts,
    ...outputArgs,
    '-y',
    outputPath,
  ];

  logger.info('FFmpeg command', { cmd: [ffmpegPath, ...ffmpegArgs].join(' ') });

  return new Promise((resolve, reject) => {
    // Keep a local reference to this specific process so the timeout and close
    // handlers don't accidentally affect a later process that replaced ffmpegProcess.
    const proc = spawn(ffmpegPath, ffmpegArgs);
    ffmpegProcess = proc;
    recordingStartTime = Date.now();

    let startupOutput = '';
    let started = false;
    let startupTimer = null;

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      startupOutput += text;

      if (!started && (text.includes('Press [q]') || text.includes('size='))) {
        started = true;
        clearTimeout(startupTimer);
        const preview = startupOutput.split('\n').slice(0, 10).join('\n');
        logger.info('FFmpeg recording started', { systemDevice, preview });
        recorder.emit('recording:started', { sessionId, outputPath });
        resolve(outputPath);
      }

      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('no such filter') || text.includes('Warning')) {
        logger.warn('FFmpeg stderr', { text: text.trim() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(startupTimer);
      logger.error('FFmpeg process error', { error: err.message });
      if (ffmpegProcess === proc) ffmpegProcess = null;
      recorder.emit('recording:error', { error: err.message });
      if (!started) reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(startupTimer);
      logger.info('FFmpeg process closed', { code });
      if (ffmpegProcess === proc) ffmpegProcess = null;
      if (!started) {
        reject(new Error(`FFmpeg exited (code ${code}) before recording started.\n${startupOutput}`));
      }
    });

    // Kill this specific process if it hasn't started within 10 seconds.
    startupTimer = setTimeout(() => {
      if (!started) {
        if (!proc.killed) proc.kill();
        if (ffmpegProcess === proc) ffmpegProcess = null;
        const errMsg = `FFmpeg failed to start recording. Output:\n${startupOutput}`;
        logger.error(errMsg);
        reject(new Error(errMsg));
      }
    }, 10000);
  });
}

/**
 * Record a short clip from a single device and return its peak amplitude.
 * Used to diagnose silent devices before a real recording.
 */
async function probeAudioDevice(device, durationSec = 3) {
  const ffmpegPath = getFfmpegPath();
  if (!fs.existsSync(ffmpegPath)) {
    return { device, peak: 0, isSilent: true, error: 'FFmpeg not found' };
  }

  const tmpPath = path.join(app.getPath('temp'), `meetmind-probe-${Date.now()}.wav`);
  const { inputs, outputArgs } = buildSingleDeviceArgs(device);
  const args = ['-hide_banner', ...inputs, '-t', String(durationSec), ...outputArgs, '-y', tmpPath];

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => { if (!proc.killed) proc.kill(); }, (durationSec + 8) * 1000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      let peak = 0;
      try {
        if (fs.existsSync(tmpPath)) {
          const buf = fs.readFileSync(tmpPath);
          let pos = 12;
          let dataStart = 44;
          while (pos + 8 <= buf.length) {
            const id = buf.toString('ascii', pos, pos + 4);
            if (id === 'data') { dataStart = pos + 8; break; }
            pos += 8 + buf.readUInt32LE(pos + 4);
          }
          for (let i = dataStart; i + 1 < buf.length; i += 2) {
            const s = Math.abs(buf.readInt16LE(i));
            if (s > peak) peak = s;
          }
          fs.unlinkSync(tmpPath);
        }
      } catch { /* ignore cleanup errors */ }

      const isSilent = peak < 200;
      logger.info('Device probe result', { device, peak, isSilent, exitCode: code });
      resolve({ device, peak, isSilent, exitCode: code, stderr: stderr.slice(-500) });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ device, peak: 0, isSilent: true, error: err.message });
    });
  });
}

async function startRecording(sessionId) {
  if (ffmpegProcess) {
    throw new Error('Recording already in progress');
  }

  const ffmpegPath = validateFfmpegExists();
  const config = getConfig();

  let systemDevice = config.systemAudioDevice;
  let micDevice = config.micDevice;

  // Auto-detect devices if not configured
  if (!systemDevice && !micDevice) {
    logger.info('No audio devices configured, auto-detecting...');
    const devices = await listAudioDevices();
    systemDevice = devices.system;
    micDevice = devices.mic;
  }

  if (!systemDevice && !micDevice) {
    throw new Error(
      'No audio input devices found. In Settings → Audio: click "Detect devices". ' +
      'If none appear, add FFmpeg (ffmpeg.exe) to assets/ffmpeg/, enable "Stereo Mix" in Windows Sound → Recording, or use a virtual cable (e.g. VB-Audio).'
    );
  }

  // ── Prefer WASAPI loopback over dshow loopback devices ─────────────────────
  // Stereo Mix only captures audio from the specific Realtek output and is
  // silent when using headphones, USB speakers, or Bluetooth. WASAPI loopback
  // captures all system audio regardless of output device.
  if (systemDevice && !isWasapiLoopback(systemDevice) && !wasapiKnownUnsupported) {
    const isDshowLoopback = ['stereo mix', 'what u hear', 'loopback', 'cable output'].some(
      (k) => systemDevice.toLowerCase().includes(k)
    );
    if (isDshowLoopback) {
      logger.info('Config has dshow loopback, upgrading to WASAPI loopback', {
        currentDevice: systemDevice,
      });
      systemDevice = WASAPI_LOOPBACK_ID;
    }
  }

  // ── Probe devices to detect silence before the real recording ──────────────
  if (micDevice) {
    const micProbe = await probeAudioDevice(micDevice, 2);
    if (micProbe.isSilent) {
      logger.warn('Microphone probe is silent — may be muted or blocked by Windows privacy settings', {
        device: micDevice,
        peak: micProbe.peak,
      });
    }
  }

  // Ensure recordings directory exists
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  currentOutputPath = path.join(recordingsDir, `${sessionId}.wav`);

  logger.info('Starting recording', { sessionId, systemDevice, micDevice, outputPath: currentOutputPath });

  try {
    return await _spawnFFmpegRecording(sessionId, systemDevice, micDevice, currentOutputPath, ffmpegPath);
  } catch (err) {
    // ── WASAPI loopback fallback ──────────────────────────────────────────────
    const wasapiNotSupported =
      isWasapiLoopback(systemDevice) &&
      (err.message.includes('Unrecognized option') || err.message.includes('Option not found'));

    if (wasapiNotSupported) {
      wasapiKnownUnsupported = true;
      logger.warn('WASAPI loopback not supported by this FFmpeg build — falling back to dshow', { ffmpegError: err.message });

      const freshDevices = await listAudioDevices();
      const dshowNames = freshDevices.all
        .filter((d) => (d?.id ?? d) !== WASAPI_LOOPBACK_ID)
        .map((d) => d?.id ?? d);

      const fallbackSystem = detectDshowLoopback(dshowNames);
      if (fallbackSystem) {
        logger.info('Retrying recording with dshow fallback', { fallbackSystem });
        setConfig('systemAudioDevice', fallbackSystem);
        ffmpegProcess = null;
        return await _spawnFFmpegRecording(sessionId, fallbackSystem, micDevice, currentOutputPath, ffmpegPath);
      }

      if (micDevice) {
        logger.warn('No dshow loopback found; recording mic-only');
        setConfig('systemAudioDevice', '');
        ffmpegProcess = null;
        return await _spawnFFmpegRecording(sessionId, null, micDevice, currentOutputPath, ffmpegPath);
      }
    }

    throw err;
  }
}

async function stopRecording() {
  if (!ffmpegProcess) {
    throw new Error('No active recording');
  }

  const outputPath = currentOutputPath;

  return new Promise((resolve, reject) => {
    // Send 'q' to FFmpeg stdin to gracefully stop and finalize the WAV file
    ffmpegProcess.stdin.write('q');

    const timeout = setTimeout(() => {
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
      }
    }, 5000);

    ffmpegProcess.on('close', (code) => {
      clearTimeout(timeout);
      ffmpegProcess = null;

      const durationMs = Date.now() - (recordingStartTime || Date.now());
      recordingStartTime = null;

      logger.info('Recording stopped', {
        outputPath,
        durationSeconds: Math.round(durationMs / 1000),
      });

      recorder.emit('recording:stopped', { outputPath, durationMs });

      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Recording file not found: ${outputPath}`));
      }
    });

    ffmpegProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Convert a webm/opus file (from renderer MediaRecorder) to 16 kHz mono WAV
 * suitable for the STT pipeline.
 */
async function convertWebmToWav(webmPath, wavPath) {
  const ffmpegPath = validateFfmpegExists();

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-i', webmPath,
      '-af', 'volume=4',
      '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le',
      '-y', wavPath,
    ];

    logger.info('Converting webm to wav', { webmPath, wavPath });
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(wavPath)) {
        logger.info('Webm→wav conversion complete', { wavPath });
        resolve(wavPath);
      } else {
        reject(new Error(`FFmpeg webm→wav failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(err));
    setTimeout(() => { if (!proc.killed) proc.kill(); }, 120000);
  });
}

/**
 * Convert an arbitrary audio or video file (mp3, mp4, m4a, flac, etc.) to
 * a 16 kHz mono WAV suitable for the STT pipeline. Relies on FFmpeg's
 * built-in demuxers/decoders for the source format.
 */
async function convertFileToWav(inputPath, wavPath) {
  const ffmpegPath = validateFfmpegExists();

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-i', inputPath,
      '-vn', // drop any video track
      '-af', 'volume=4',
      '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le',
      '-y', wavPath,
    ];

    logger.info('Converting file to wav', { inputPath, wavPath });
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(wavPath)) {
        logger.info('File→wav conversion complete', { wavPath });
        resolve(wavPath);
      } else {
        reject(new Error(`FFmpeg file→wav failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(err));
    setTimeout(() => { if (!proc.killed) proc.kill(); }, 120000);
  });
}

module.exports = {
  startRecording,
  stopRecording,
  listAudioDevices,
  probeAudioDevice,
  convertWebmToWav,
  convertFileToWav,
  recorder,
};
