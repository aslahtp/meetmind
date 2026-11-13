// One place that maps session statuses and pipeline stages to labels + tones.
// Tones map to the design system's signal vocabulary:
//   'live'    → pulsing signal-red dot (recording)
//   'busy'    → graphite spinner (pipeline running)
//   'ok'      → mint dot (complete)
//   'error'   → signal-red dot
//   'neutral' → graphite dot

import type { ProcessingProgressStage, SessionStatus } from '@shared';

export type StatusTone = 'live' | 'busy' | 'ok' | 'error' | 'neutral';

export interface StatusInfo {
  label: string;
  tone: StatusTone;
}

export const SESSION_STATUS: Record<SessionStatus, StatusInfo> = {
  recording:    { label: 'Recording',         tone: 'live' },
  recorded:     { label: 'Recorded',          tone: 'neutral' },
  transcribing: { label: 'Transcribing',      tone: 'busy' },
  generating:   { label: 'Writing notes',     tone: 'busy' },
  uploading:    { label: 'Syncing to Notion', tone: 'busy' },
  complete:     { label: 'Complete',          tone: 'ok' },
  error:        { label: 'Failed',            tone: 'error' },
};

function isKnownStatus(status: string): status is SessionStatus {
  return status in SESSION_STATUS;
}

export function sessionStatus(status: string | null | undefined): StatusInfo {
  if (status && isKnownStatus(status)) return SESSION_STATUS[status];
  return { label: status || 'Unknown', tone: 'neutral' };
}

export const PROCESSING_STATUSES = new Set<string>(['transcribing', 'generating', 'uploading']);

export function isProcessing(status: string | null | undefined) {
  return status != null && PROCESSING_STATUSES.has(status);
}

// Pipeline stages, in order, as emitted by `processing:progress`.
export const PIPELINE_STAGES: Array<{ key: ProcessingProgressStage; label: string }> = [
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'generating',   label: 'Write notes' },
  { key: 'uploading',    label: 'Notion' },
];

export const STAGE_LABELS: Record<ProcessingProgressStage, string> = {
  transcribing: 'Transcribing',
  generating:   'Writing notes',
  uploading:    'Syncing to Notion',
  complete:     'Done',
};

export function stageIndex(stage: string | null | undefined) {
  if (stage === 'complete') return PIPELINE_STAGES.length;
  return PIPELINE_STAGES.findIndex((s) => s.key === stage);
}
