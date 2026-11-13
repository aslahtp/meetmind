// Audio capture, run in the hidden capture window (electron/audio/capture-window.ts): system
// audio through Electron's display-media loopback plus the microphone, mixed with Web Audio and
// recorded as WebM/Opus. Chunks go to main every second, which appends them to disk, so a crash
// loses at most the last second. The window is destroyed after each recording.

import { createNoiseGate } from './lib/noiseGate';
import { errorMessage } from './lib/errors';
import type { CaptureStartOptions } from '@shared';

const bridge = window.meetmindCapture;
const LEVELS_INTERVAL_MS = 66;   // ~15 fps for the live meters; rAF doesn't run in a hidden window

let mediaRecorder: MediaRecorder | null = null;
let streams: MediaStream[] = [];
let ctx: AudioContext | null = null;
let levelsTimer: ReturnType<typeof setInterval> | undefined;

function rms(buf: Float32Array) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function startLevels(sysAnalyser: AnalyserNode | null, micAnalyser: AnalyserNode | null) {
  const sysData = sysAnalyser ? new Float32Array(sysAnalyser.fftSize) : null;
  const micData = micAnalyser ? new Float32Array(micAnalyser.fftSize) : null;
  const micGate = createNoiseGate();
  levelsTimer = setInterval(() => {
    let system = 0;
    let mic = 0;
    if (sysAnalyser && sysData) {
      sysAnalyser.getFloatTimeDomainData(sysData);
      system = Math.min(1, rms(sysData) * 4);   // ×4 gain for visual clarity
    }
    if (micAnalyser && micData) {
      micAnalyser.getFloatTimeDomainData(micData);
      // Above the room's background only, or the meter moves while nobody speaks.
      mic = Math.min(1, micGate(rms(micData)) * 4);
    }
    bridge.levels({ mic, system });
  }, LEVELS_INTERVAL_MS);
}

function releaseAll() {
  clearInterval(levelsTimer);
  levelsTimer = undefined;
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
}

// System audio via Electron loopback. getDisplayMedia must ask for video too; that track is
// stopped at once. Returns null when the OS gives no system audio (permission denied, or no
// audio track). When main can capture it with FFmpeg instead (`requireSystemAudio`: Windows
// WASAPI, Linux PulseAudio) this fails so main falls back; otherwise the mic is recorded alone.
async function openSystemStream(requireSystemAudio: boolean): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length > 0) return stream;
    stream.getTracks().forEach((t) => t.stop());
    if (requireSystemAudio) throw new Error('System audio capture returned no audio track');
  } catch (err) {
    if (requireSystemAudio) throw err;
    console.warn('System audio unavailable, recording microphone only:', err);
  }
  return null;
}

async function start({ requireSystemAudio = bridge.platform === 'win32' }: CaptureStartOptions = {}) {
  try {
    const sysStream = await openSystemStream(requireSystemAudio);
    if (sysStream) streams.push(sysStream);

    let micStream: MediaStream | null = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streams.push(micStream);
    } catch { /* mic unavailable: system audio only */ }

    if (!sysStream && !micStream) throw new Error('No audio source available (microphone access denied?)');

    const audioCtx = new AudioContext();
    ctx = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();

    // Each source → analyser (for the meters) and → the mixed destination.
    const tap = (stream: MediaStream | null) => {
      if (!stream) return null;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      source.connect(dest);
      return analyser;
    };
    startLevels(tap(sysStream), tap(micStream));

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    mediaRecorder = recorder;
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      e.data.arrayBuffer()
        .then((buffer) => { if (buffer.byteLength > 0) bridge.chunk(buffer); })
        .catch((err: unknown) => console.error('Failed to send audio chunk:', err));
    };
    recorder.start(1000);   // a chunk every second, written to disk as it arrives

    bridge.started({ systemAudio: !!sysStream, mic: !!micStream });
  } catch (err) {
    console.error('Audio capture failed:', err);
    releaseAll();
    bridge.failed(errorMessage(err) || String(err));
  }
}

async function stop() {
  try {
    const recorder = mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      // Let the last chunk's arrayBuffer() resolve and go out before the sentinel.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } catch (err) {
    console.error('Capture stop failed:', err);
  } finally {
    releaseAll();
    bridge.done();
  }
}

bridge.onStart(start);
bridge.onStop(stop);
bridge.ready();
