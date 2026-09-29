/**
 * The single place providers are registered. To add an engine:
 *   1. create electron/providers/{stt|llm}/<name>.js (see docs/ADDING_PROVIDERS.md)
 *   2. add one line below
 *   3. add an icon in renderer/components/settings/providers/providerIcons.js
 */
const { createRegistry } = require('./registry');

const sttRegistry = createRegistry('stt', ['transcribe', 'test']);
const llmRegistry = createRegistry('llm', ['generate', 'test']);

[
  require('./stt/google'),
  require('./stt/sarvam'),
  require('./stt/assemblyai'),
  require('./stt/groq'),
].forEach((p) => sttRegistry.register(p));

[
  require('./llm/gemini'),
  require('./llm/groq'),
].forEach((p) => llmRegistry.register(p));

const registries = { stt: sttRegistry, llm: llmRegistry };

/** Serializable descriptors for the renderer. */
function describeProviders() {
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

module.exports = { sttRegistry, llmRegistry, registries, describeProviders, providerConfigKeys };
