const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { EventEmitter } = require('events');

const { getFfmpegPath, validateFfmpegExists } = require('./ffmpeg-path');
const {
  buildAmixFilter,
  parseDeviceList,
  detectSystemLoopback,
  detectDshowLoopback,
  detectMicrophone,
  WASAPI_LOOPBACK_ID,
  WASAPI_LOOPBACK_LABEL,
} = require('./mixer');
const { getConfig, setConfig } = require('../utils/config');
const logger = require('../utils/logger');

const recorder = new EventEmitter();

let ffmpegProcess = null;
let currentOutputPath = null;
let recordingStartTime = null;

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

  // Ensure recordings directory exists
  const recordingsDir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  currentOutputPath = path.join(recordingsDir, `${sessionId}.wav`);

  logger.info('Starting recording', {
    sessionId,
    systemDevice,
    micDevice,
    outputPath: currentOutputPath,
  });

  const { inputs, filterParts, outputArgs } = buildAmixFilter(systemDevice, micDevice);

  const ffmpegArgs = [
    '-hide_banner',
    ...inputs,
    ...filterParts,
    ...outputArgs,
    '-y', // overwrite if exists
    currentOutputPath,
  ];

  logger.info('FFmpeg command', { cmd: [ffmpegPath, ...ffmpegArgs].join(' ') });

  return new Promise((resolve, reject) => {
    ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
    recordingStartTime = Date.now();

    let startupOutput = '';
    let started = false;

    ffmpegProcess.stderr.on('data', (data) => {
      const text = data.toString();
      startupOutput += text;

      if (!started && (text.includes('Press [q]') || text.includes('size='))) {
        started = true;
        // Log the first few lines to help debug device selection
        const preview = startupOutput.split('\n').slice(0, 10).join('\n');
        logger.info('FFmpeg recording started', { preview });
        recorder.emit('recording:started', { sessionId, outputPath: currentOutputPath });
        resolve(currentOutputPath);
      }

      // Log meaningful FFmpeg messages
      if (text.toLowerCase().includes('error') || text.toLowerCase().includes('no such filter') || text.includes('Warning')) {
        logger.warn('FFmpeg stderr', { text: text.trim() });
      }
    });

    ffmpegProcess.on('error', (err) => {
      logger.error('FFmpeg process error', { error: err.message });
      ffmpegProcess = null;
      recorder.emit('recording:error', { error: err.message });
      if (!started) reject(err);
    });

    ffmpegProcess.on('close', (code) => {
      logger.info('FFmpeg process closed', { code });
      ffmpegProcess = null;
    });

    // Timeout if FFmpeg doesn't start within 10 seconds
    setTimeout(() => {
      if (!started) {
        if (ffmpegProcess) ffmpegProcess.kill();
        const errMsg = `FFmpeg failed to start recording. Output:\n${startupOutput}`;
        logger.error(errMsg);
        reject(new Error(errMsg));
      }
    }, 10000);
  });
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

module.exports = { startRecording, stopRecording, listAudioDevices, recorder };
