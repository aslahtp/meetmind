const fs = require('fs');
const logger = require('../providers/shared/log');
const { sttRegistry } = require('../providers');
const { getWavDurationSeconds, getWavPeakAmplitude } = require('../providers/shared/wav');

/**
 * Transcription controller. Validates the recording, then hands it to the
 * provider selected in `config.sttService`. Provider-specific behavior (auth,
 * chunking, polling, diarization) lives in electron/providers/stt/*.
 *
 * Returns segments shaped { speaker, text, startTime, endTime }.
 */
async function transcribe(wavPath, config, onProgress) {
  const provider = sttRegistry.get(config.sttService || sttRegistry.defaultId());
  const model = sttRegistry.resolveModel(provider, config.sttModels?.[provider.id]);

  if (!sttRegistry.isConfigured(provider, config)) {
    const missing = provider.credentials.find((f) => f.required && !String(config[f.configKey] ?? '').trim());
    throw new Error(`${missing?.label || `${provider.name} credentials`} is required for transcription`);
  }
  if (!fs.existsSync(wavPath)) {
    throw new Error(`Audio file not found: ${wavPath}`);
  }

  const stat = fs.statSync(wavPath);
  const durationSeconds = getWavDurationSeconds(wavPath);
  const ampResult = getWavPeakAmplitude(wavPath);
  const peakAmplitude = ampResult.peak;

  logger.info('Starting transcription', {
    wavFilePath: wavPath,
    durationSeconds,
    fileSizeBytes: stat.size,
    peakAmplitude,
    windows: ampResult.windows,
    provider: provider.id,
    model,
  });

  if (peakAmplitude < 200) {
    const windowDetail = ampResult.windows.map((w) => `${w.label}=${w.peak}`).join(', ');
    logger.warn('Recording is silent (peak amplitude below threshold)', {
      peakAmplitude,
      windows: ampResult.windows,
      hint: [
        'Check Windows Settings → Privacy & security → Microphone → enable "Let desktop apps access your microphone".',
        'In Windows Sound → Recording → right-click your Microphone → Properties → Levels → set to 80–100 and unmute.',
        'If using headphones/USB/Bluetooth: select "WASAPI Loopback" in MeetMind Settings → Audio (Stereo Mix only captures from built-in speakers).',
        'Test by playing a YouTube video while recording for a few seconds.',
      ],
    });
    throw new Error(
      `The recording is completely silent (peak=${peakAmplitude}, per-section: ${windowDetail}). ` +
      'Likely causes: (1) Windows microphone privacy is blocking the app — go to Settings → Privacy & security → Microphone → enable "Let desktop apps access your microphone". ' +
      '(2) Microphone level is at 0 or muted — open Windows Sound → Recording → Microphone → Properties → Levels and set to 80+. ' +
      '(3) System audio device (Stereo Mix) only captures built-in speaker output — if using headphones, switch to "WASAPI Loopback" in MeetMind Settings → Audio.'
    );
  }

  onProgress?.(0);
  const segments = await provider.transcribe({ wavPath, model, config, onProgress });
  return { segments, provider: provider.id, model };
}

module.exports = { transcribe };
