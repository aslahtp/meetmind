// Helpers over the provider descriptors served by `providers:list` (see electron/providers).

import type { ProviderDescriptor, ProviderDescriptors, ProviderKind } from '@shared';

type Providers = ProviderDescriptors | null | undefined;

/** Config values (or unsaved form values) that name the chosen engines. */
export interface ProviderSelection {
  sttService?: string;
  llmProvider?: string;
}

/** A config or form object read by key (credentials differ per provider). */
type Values = object | null | undefined;

function valueOf(values: Values, key: string): unknown {
  return values ? (values as Record<string, unknown>)[key] : undefined;
}

export function findProvider(
  providers: Providers,
  kind: ProviderKind,
  id: string | null | undefined,
): ProviderDescriptor | null {
  return providers?.[kind]?.find((p) => p.id === id) || null;
}

/** The provider chosen in config for a kind ('stt' uses sttService, 'llm' uses llmProvider). */
export function selectedProvider(
  providers: Providers,
  kind: ProviderKind,
  cfg: ProviderSelection | null | undefined,
): ProviderDescriptor | null {
  const id = kind === 'stt' ? cfg?.sttService : cfg?.llmProvider;
  return findProvider(providers, kind, id) || providers?.[kind]?.[0] || null;
}

/** True when every required credential of the provider has a value in `values`. */
export function isProviderConfigured(provider: ProviderDescriptor | null | undefined, values: Values): boolean {
  if (!provider) return false;
  return provider.credentials
    .filter((f) => f.required)
    .every((f) => String(valueOf(values, f.configKey) ?? '').trim());
}

/** Every config key stored by providers (credentials + options), across both kinds. */
export function providerConfigKeys(providers: Providers): string[] {
  const keys = new Set<string>();
  const kinds: ProviderKind[] = ['stt', 'llm'];
  for (const kind of kinds) {
    for (const p of providers?.[kind] || []) {
      for (const f of p.credentials) keys.add(f.configKey);
    }
  }
  return [...keys];
}

/** Which engines are chosen and whether their credentials are filled in. */
export interface SetupState {
  /** False until the providers and the config have loaded. */
  ready: boolean;
  sttDone: boolean;
  llmDone: boolean;
  stt: ProviderDescriptor | null;
  llm: ProviderDescriptor | null;
}

/** Setup progress for the Dashboard card / Settings redirect. Unknown until providers load. */
export function getSetupState(providers: Providers, cfg: ProviderSelection | null | undefined): SetupState {
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
export function providerName(providers: Providers, kind: ProviderKind, id: string): string {
  return findProvider(providers, kind, id)?.name || id;
}
