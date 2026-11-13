import type { Config, LLMProvider, Notes, TranscriptSegment } from '../shared';
import * as logger from '../providers/shared/log';
import { llmRegistry } from '../providers';
import { errorMessage } from '../utils/errors';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MD_SYSTEM_PROMPT } from './prompts';
import { transcriptToText, isMarkdownPrompt, buildUserPrompt, parseNotesResponse, buildNotesPreview, estimateNotesProgress } from './notes-normalize';
import { applyMeetingTitle } from './meeting-title';

// How often the live preview is rebuilt and sent while an LLM streams.
const PREVIEW_INTERVAL_MS = 100;

/** A custom prompt wins; otherwise the default for the configured output mode. */
function resolveSystemPrompt(config: Partial<Config>) {
  const custom = config.geminiSystemPrompt || config.systemPrompt || '';
  if (custom.trim()) return custom;
  return config.noteOutputMode === 'markdown' ? DEFAULT_MD_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
}

/** Primary target plus the optional cross-provider fallback, as {provider, model}. */
interface LlmTarget {
  provider: LLMProvider;
  model: string;
}

function resolveTargets(config: Partial<Config>) {
  const primary = llmRegistry.get(config.llmProvider || llmRegistry.defaultId());
  const targets: LlmTarget[] = [{
    provider: primary,
    model: llmRegistry.resolveModel(primary, config.llmModels?.[primary.id]),
  }];

  const fb = config.llmFallback;
  if (fb?.provider && llmRegistry.has(fb.provider)) {
    const provider = llmRegistry.get(fb.provider);
    const model = llmRegistry.resolveModel(provider, fb.model);
    if (provider.id !== primary.id || model !== targets[0].model) targets.push({ provider, model });
  }
  return targets;
}

/** What `onPreview` receives; `notes: null` starts an attempt with a clean preview. */
export interface NotesPreviewUpdate {
  attempt: number;
  provider: string;
  model: string;
  notes: Notes | null;
  /** Estimated share written, 0 to <1. */
  progress?: number;
}

/**
 * Collect one attempt's streamed text and call `onPreview` with the notes so
 * far and an estimated `progress` (0 to <1), at most every PREVIEW_INTERVAL_MS.
 * `stop()` cancels a pending update.
 */
function createPreviewStream({
  onPreview,
  attempt,
  provider,
  model,
  markdown,
  meetingTitle,
  transcriptChars,
}: {
  onPreview: (preview: NotesPreviewUpdate) => void;
  attempt: number;
  provider: string;
  model: string;
  markdown: boolean;
  meetingTitle: string;
  transcriptChars: number;
}) {
  let text = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const flush = () => {
    timer = null;
    last = Date.now();
    const notes = buildNotesPreview(text, markdown);
    if (!notes) return;
    onPreview({
      attempt,
      provider,
      model,
      notes: applyMeetingTitle(notes, meetingTitle),
      progress: estimateNotesProgress(text.length, transcriptChars),
    });
  };
  return {
    onText(delta: string) {
      text += delta;
      if (timer) return;
      timer = setTimeout(flush, Math.max(0, PREVIEW_INTERVAL_MS - (Date.now() - last)));
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Generate notes for a transcript with the configured LLM, retrying once with
 * the fallback provider/model if the primary fails. `meetingTitle` (already
 * checked by sourceMeetingTitle) is a prompt hint and wins over the LLM's title.
 * `onPreview({ attempt, provider, model, notes, progress })`, if given, receives
 * the notes streamed so far and an estimate of how much is written; `notes: null`
 * starts each attempt with a clean preview.
 *
 * Returns { notes, provider, model, fallback } where `fallback` is
 * { primary: {provider, model}, error } when the fallback produced the notes.
 */
async function generateNotes(
  transcript: TranscriptSegment[] | null | undefined,
  config: Partial<Config>,
  { meetingTitle = '', onPreview }: { meetingTitle?: string; onPreview?: (preview: NotesPreviewUpdate) => void } = {}
) {
  const targets = resolveTargets(config);
  const systemPrompt = resolveSystemPrompt(config);
  const markdown = isMarkdownPrompt(systemPrompt);
  const transcriptText = transcriptToText(transcript);
  const userPrompt = buildUserPrompt(transcriptText, markdown, meetingTitle);

  let primaryError: Error | null = null;
  for (let i = 0; i < targets.length; i++) {
    const { provider, model } = targets[i];
    if (!llmRegistry.isConfigured(provider, config)) {
      const err = new Error(`${provider.name} API key is required`);
      if (i === targets.length - 1) throw primaryError || err;
      primaryError = primaryError || err;
      continue;
    }

    logger.info('Generating meeting notes', {
      provider: provider.id,
      model,
      transcriptLength: transcriptText.length,
      isFallback: i > 0,
    });

    onPreview?.({ attempt: i, provider: provider.id, model, notes: null });
    const preview = onPreview
      ? createPreviewStream({
        onPreview, attempt: i, provider: provider.id, model, markdown, meetingTitle,
        transcriptChars: transcriptText.length,
      })
      : null;
    try {
      const text = await provider.generate({
        systemPrompt, userPrompt, model, config, json: !markdown, onText: preview?.onText,
      });
      const notes = applyMeetingTitle(parseNotesResponse(text, markdown), meetingTitle);
      logger.info('Meeting notes generated', {
        provider: provider.id,
        model,
        mode: markdown ? 'markdown' : 'json',
        title: notes.title,
      });
      return {
        notes,
        provider: provider.id,
        model,
        fallback: i > 0
          ? { primary: { provider: targets[0].provider.id, model: targets[0].model }, error: errorMessage(primaryError) }
          : null,
      };
    } catch (err) {
      if (i === targets.length - 1) throw err;
      primaryError = err as Error;
      logger.warn('Primary LLM failed, trying fallback', {
        provider: provider.id,
        model,
        fallbackProvider: targets[i + 1].provider.id,
        fallbackModel: targets[i + 1].model,
        error: errorMessage(err),
      });
    } finally {
      preview?.stop();
    }
  }
  throw primaryError || new Error('No LLM provider available');
}

export { generateNotes, resolveSystemPrompt, resolveTargets };
