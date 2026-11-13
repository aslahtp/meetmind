import fs from 'fs';
import type { Config } from '../shared';
import * as logger from '../providers/shared/log';
import { sttRegistry } from '../providers';
import { getWavDurationSeconds, getWavPeakAmplitude } from '../providers/shared/wav';
import { silenceHints } from '../audio/audio-hints';

/**
 * Transcription controller. Validates the recording, then hands it to the
 * provider selected in `config.sttService`. Provider-specific behavior (auth,
 * chunking, polling, diarization) lives in electron/providers/stt/*.
 *
 * Returns segments shaped { speaker, text, startTime, endTime }.
 */
async function transcribe(wavPath: string, config: Partial<Config>, onProgress?: (percent: number) => void) {
  const provider = sttRegistry.get(config.sttService || sttRegistry.defaultId());
  const model = sttRegistry.resolveModel(provider, config.sttModels?.[provider.id]);

  if (!sttRegistry.isConfigured(provider, config)) {
    const missing = provider.credentials.find((f) => f.required && !String((config as Record<string, unknown>)[f.configKey] ?? '').trim());
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
    const hints = silenceHints(process.platform);
    logger.warn('Recording is silent (peak amplitude below threshold)', {
      peakAmplitude,
      windows: ampResult.windows,
      hint: hints,
    });
    throw new Error(
      `The recording is completely silent (peak=${peakAmplitude}, per-section: ${windowDetail}). ` +
      hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')
    );
  }

  onProgress?.(0);
  const segments = await provider.transcribe({ wavPath, model, config, onProgress });
  return { segments, provider: provider.id, model };
}

export { transcribe };
