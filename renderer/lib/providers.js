// Helpers over the provider descriptors served by `providers:list` (see electron/providers).

export function findProvider(providers, kind, id) {
  return providers?.[kind]?.find((p) => p.id === id) || null;
}

/** The provider chosen in config for a kind ('stt' uses sttService, 'llm' uses llmProvider). */
export function selectedProvider(providers, kind, cfg) {
  const id = kind === 'stt' ? cfg?.sttService : cfg?.llmProvider;
  return findProvider(providers, kind, id) || providers?.[kind]?.[0] || null;
}

/** True when every required credential of the provider has a value in `values`. */
export function isProviderConfigured(provider, values) {
  if (!provider) return false;
  return provider.credentials
    .filter((f) => f.required)
    .every((f) => String(values?.[f.configKey] ?? '').trim());
}

/** Every config key stored by providers (credentials + options), across both kinds. */
export function providerConfigKeys(providers) {
  const keys = new Set();
  for (const kind of ['stt', 'llm']) {
    for (const p of providers?.[kind] || []) {
      for (const f of p.credentials) keys.add(f.configKey);
    }
  }
  return [...keys];
}

/** Setup progress for the Dashboard card / Settings redirect. Unknown until providers load. */
export function getSetupState(providers, cfg) {
  if (!providers || !cfg) return { ready: false, sttDone: true, llmDone: true, stt: null, llm: null };
  const stt = selectedProvider(providers, 'stt', cfg);
  const llm = selectedProvider(providers, 'llm', cfg);
  return {
    ready: true,
    stt,
    llm,
    sttDone: isProviderConfigured(stt, cfg),
    llmDone: isProviderConfigured(llm, cfg),
  };
}

/** Display name for a provider id, falling back to the raw id (e.g. for old sessions). */
export function providerName(providers, kind, id) {
  return findProvider(providers, kind, id)?.name || id;
}
