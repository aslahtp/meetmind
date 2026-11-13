/**
 * The single place providers are registered. To add an engine:
 *   1. create electron/providers/{stt|llm}/<name>.js (see docs/ADDING_PROVIDERS.md)
 *   2. add one line below
 *   3. add an icon in renderer/components/settings/providers/providerIcons.js
 */
import type { LLMProvider, ProviderDescriptor, ProviderKind, STTProvider } from '../shared';
import { createRegistry, type Registry } from './registry';
import google from './stt/google';
import sarvam from './stt/sarvam';
import assemblyai from './stt/assemblyai';
import groqStt from './stt/groq';
import gemini from './llm/gemini';
import groqLlm from './llm/groq';
import claude from './llm/claude';

const sttRegistry: Registry<STTProvider> = createRegistry<STTProvider>('stt', ['transcribe', 'test']);
const llmRegistry: Registry<LLMProvider> = createRegistry<LLMProvider>('llm', ['generate', 'test']);

[google, sarvam, assemblyai, groqStt].forEach((p) => sttRegistry.register(p));

[gemini, groqLlm, claude].forEach((p) => llmRegistry.register(p));

const registries: Record<ProviderKind, Registry<STTProvider | LLMProvider>> = { stt: sttRegistry, llm: llmRegistry };

/** Serializable descriptors for the renderer. */
function describeProviders(): { stt: ProviderDescriptor[]; llm: ProviderDescriptor[] } {
  return { stt: sttRegistry.describeAll(), llm: llmRegistry.describeAll() };
}

/** Config keys contributed by providers: [{configKey, type, providerId, kind}]. */
function providerConfigKeys() {
  const seen = new Set();
  const out = [];
  for (const [kind, registry] of Object.entries(registries)) {
    for (const field of registry.configKeys()) {
      if (seen.has(field.configKey)) continue;
      seen.add(field.configKey);
      out.push({ ...field, kind });
    }
  }
  return out;
}

export { sttRegistry, llmRegistry, registries, describeProviders, providerConfigKeys };
