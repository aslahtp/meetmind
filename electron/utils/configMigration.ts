import type { LlmFallback } from '../shared';

/** The saved settings the migration reads. */
interface LegacyModelSettings {
  selectedModel?: string;
  geminiModel?: string;
  secondaryGeminiModel?: string;
  llmModels?: Record<string, string>;
  llmFallback?: LlmFallback;
}

/**
 * Pure config migration (no electron-store) so it can be unit tested.
 *
 * Pre-4.0 configs stored a single Gemini model (`selectedModel` / `geminiModel`)
 * and an optional same-provider fallback (`secondaryGeminiModel`). 4.0 keeps a
 * model per provider (`llmModels`) and a cross-provider fallback (`llmFallback`).
 *
 * Returns { set, remove } describing what to write/delete; both are empty when
 * there is nothing to migrate, so calling it on every read is cheap and idempotent.
 */
function migrateLegacyModels(raw: LegacyModelSettings, deprecatedGeminiModels: Record<string, string> = {}) {
  const set: { llmModels?: Record<string, string>; llmFallback?: LlmFallback } = {};
  const remove: string[] = [];

  const remap = (id: string) => deprecatedGeminiModels[id] || id;
  const legacyModel = raw.selectedModel || raw.geminiModel || '';
  const llmModels: Record<string, string> = raw.llmModels && typeof raw.llmModels === 'object' ? raw.llmModels : {};

  if (legacyModel) {
    if (!llmModels.gemini) set.llmModels = { ...llmModels, gemini: remap(legacyModel) };
    remove.push('selectedModel', 'geminiModel');
  }

  // Retired Gemini IDs saved under the new key.
  const current = (set.llmModels || llmModels).gemini;
  if (current && deprecatedGeminiModels[current]) {
    set.llmModels = { ...(set.llmModels || llmModels), gemini: deprecatedGeminiModels[current] };
  }

  const legacyFallback = raw.secondaryGeminiModel || '';
  if (legacyFallback) {
    const existing = raw.llmFallback && raw.llmFallback.provider;
    if (!existing) set.llmFallback = { provider: 'gemini', model: remap(legacyFallback) };
    remove.push('secondaryGeminiModel');
  }

  return { set, remove };
}

export { migrateLegacyModels };
