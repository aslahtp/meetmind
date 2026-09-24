// One place that maps session statuses and pipeline stages to labels + tones.
// Tones map to the design system's signal vocabulary:
//   'live'    → pulsing signal-red dot (recording)
//   'busy'    → graphite spinner (pipeline running)
//   'ok'      → mint dot (complete)
//   'error'   → signal-red dot
//   'neutral' → graphite dot

export const SESSION_STATUS = {
  recording:    { label: 'Recording',         tone: 'live' },
  recorded:     { label: 'Recorded',          tone: 'neutral' },
  transcribing: { label: 'Transcribing',      tone: 'busy' },
  generating:   { label: 'Writing notes',     tone: 'busy' },
  uploading:    { label: 'Syncing to Notion', tone: 'busy' },
  complete:     { label: 'Complete',          tone: 'ok' },
  error:        { label: 'Failed',            tone: 'error' },
};

export function sessionStatus(status) {
  return SESSION_STATUS[status] || { label: status || 'Unknown', tone: 'neutral' };
}

export const PROCESSING_STATUSES = new Set(['transcribing', 'generating', 'uploading']);

export function isProcessing(status) {
  return PROCESSING_STATUSES.has(status);
}

// Pipeline stages, in order, as emitted by `processing:progress`.
export const PIPELINE_STAGES = [
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'generating',   label: 'Write notes' },
  { key: 'uploading',    label: 'Notion' },
];

export const STAGE_LABELS = {
  transcribing: 'Transcribing',
  generating:   'Writing notes',
  uploading:    'Syncing to Notion',
  complete:     'Done',
};

export function stageIndex(stage) {
  if (stage === 'complete') return PIPELINE_STAGES.length;
  return PIPELINE_STAGES.findIndex((s) => s.key === stage);
}
