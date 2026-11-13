/**
 * Generic provider registry. One instance per provider kind ('stt' | 'llm').
 *
 * A provider is a plain object: serializable metadata (id, name, credentials,
 * models, ...) plus the runtime functions for its kind. `describe()` strips the
 * functions so the metadata can be sent to the renderer over IPC.
 */

import type { CredentialField, ProviderDescriptor, ProviderKind } from '../shared';

/** What the registry needs from any provider; `STTProvider` and `LLMProvider` both satisfy it. */
type AnyProvider = ProviderDescriptor;

export interface Registry<P extends AnyProvider = AnyProvider> {
  kind: ProviderKind;
  register(provider: P): P;
  get(id: string): P;
  has(id: string): boolean;
  list(): P[];
  defaultId(): string;
  describe(provider: P): ProviderDescriptor;
  configKeys(): Array<CredentialField & { providerId: string }>;
  resolveModel(provider: P, saved?: unknown): string;
  isConfigured(provider: P, config: Record<string, unknown>): boolean;
  describeAll(): ProviderDescriptor[];
}

const REQUIRED_META = ['id', 'name', 'credentials', 'models', 'defaultModel'];

function createRegistry<P extends AnyProvider = AnyProvider>(kind: ProviderKind, requiredFns: string[]): Registry<P> {
  const providers = new Map<string, P>();

  function register(provider: P) {
    for (const key of REQUIRED_META) {
      if (provider[key] === undefined) {
        throw new Error(`${kind} provider "${provider.id || '?'}" is missing "${key}"`);
      }
    }
    for (const fn of requiredFns) {
      if (typeof provider[fn] !== 'function') {
        throw new Error(`${kind} provider "${provider.id}" must implement ${fn}()`);
      }
    }
    if (providers.has(provider.id)) {
      throw new Error(`Duplicate ${kind} provider id "${provider.id}"`);
    }
    providers.set(provider.id, provider);
    return provider;
  }

  function get(id: string) {
    const provider = providers.get(id);
    if (!provider) throw new Error(`Unknown ${kind} provider "${id}"`);
    return provider;
  }

  const has = (id: string) => providers.has(id);
  const list = () => [...providers.values()];
  const defaultId = () => list()[0].id;

  /** Serializable metadata (no functions) for the renderer. */
  function describe(provider: P): ProviderDescriptor {
    const out: any = {};
    for (const [key, value] of Object.entries(provider)) {
      if (typeof value !== 'function' && !key.startsWith('_')) out[key] = value;
    }
    return out;
  }

  /** Every config key a provider stores (credentials + extra options). */
  function configKeys() {
    const keys: Array<CredentialField & { providerId: string }> = [];
    for (const provider of providers.values()) {
      for (const field of provider.credentials) keys.push({ ...field, providerId: provider.id });
    }
    return keys;
  }

  /** Model to use for a provider: the saved choice, else that provider's default. */
  function resolveModel(provider: P, saved?: unknown) {
    const model = typeof saved === 'string' ? saved.trim() : '';
    if (!model) return provider.defaultModel;
    if (provider.allowCustomModel) return model;
    const known = [...provider.models, ...(provider.latestModels || [])];
    return known.some((m) => m.id === model) ? model : provider.defaultModel;
  }

  /** True when every required credential of the provider is filled in `config`. */
  function isConfigured(provider: P, config: Record<string, unknown>) {
    return provider.credentials
      .filter((f) => f.required)
      .every((f) => String(config[f.configKey] ?? '').trim());
  }

  return {
    kind,
    register,
    get,
    has,
    list,
    defaultId,
    describe,
    configKeys,
    resolveModel,
    isConfigured,
    describeAll: () => list().map(describe),
  };
}

export { createRegistry };
