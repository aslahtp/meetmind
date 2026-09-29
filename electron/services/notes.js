const logger = require('../providers/shared/log');
const { llmRegistry } = require('../providers');
const { DEFAULT_SYSTEM_PROMPT, DEFAULT_MD_SYSTEM_PROMPT } = require('./prompts');
const {
  transcriptToText,
  isMarkdownPrompt,
  buildUserPrompt,
  parseNotesResponse,
} = require('./notes-normalize');

/** A custom prompt wins; otherwise the default for the configured output mode. */
function resolveSystemPrompt(config) {
  const custom = config.geminiSystemPrompt || config.systemPrompt || '';
  if (custom.trim()) return custom;
  return config.noteOutputMode === 'markdown' ? DEFAULT_MD_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
}

/** Primary target plus the optional cross-provider fallback, as {provider, model}. */
function resolveTargets(config) {
  const primary = llmRegistry.get(config.llmProvider || llmRegistry.defaultId());
  const targets = [{
    provider: primary,
    model: llmRegistry.resolveModel(primary, config.llmModels?.[primary.id]),
  }];

  const fb = config.llmFallback;
  if (fb && llmRegistry.has(fb.provider)) {
    const provider = llmRegistry.get(fb.provider);
    const model = llmRegistry.resolveModel(provider, fb.model);
    if (provider.id !== primary.id || model !== targets[0].model) targets.push({ provider, model });
  }
  return targets;
}

/**
 * Generate notes for a transcript with the configured LLM, retrying once with
 * the fallback provider/model if the primary fails.
 *
 * Returns { notes, provider, model, fallback } where `fallback` is
 * { primary: {provider, model}, error } when the fallback produced the notes.
 */
async function generateNotes(transcript, config) {
  const targets = resolveTargets(config);
  const systemPrompt = resolveSystemPrompt(config);
  const markdown = isMarkdownPrompt(systemPrompt);
  const transcriptText = transcriptToText(transcript);
  const userPrompt = buildUserPrompt(transcriptText, markdown);

  let primaryError = null;
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

    try {
      const text = await provider.generate({ systemPrompt, userPrompt, model, config, json: !markdown });
      const notes = parseNotesResponse(text, markdown);
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
          ? { primary: { provider: targets[0].provider.id, model: targets[0].model }, error: primaryError?.message || '' }
          : null,
      };
    } catch (err) {
      if (i === targets.length - 1) throw err;
      primaryError = err;
      logger.warn('Primary LLM failed, trying fallback', {
        provider: provider.id,
        model,
        fallbackProvider: targets[i + 1].provider.id,
        fallbackModel: targets[i + 1].model,
        error: err.message,
      });
    }
  }
  throw primaryError || new Error('No LLM provider available');
}

module.exports = { generateNotes, resolveSystemPrompt, resolveTargets };
