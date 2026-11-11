// STT / LLM provider types. Sources: electron/providers/{registry,index}.js and the provider modules
// (stt/*.js, llm/*.js). `ProviderDescriptor` is what `describe()` sends to the renderer (functions and
// `_`-prefixed keys stripped); `STTProvider` / `LLMProvider` add the runtime functions (used from Phase 5).

import type { TranscriptSegment } from './session';

export type ProviderKind = 'stt' | 'llm';

export interface ProviderLink {
  href: string;
  label: string;
}

/** One credential or option stored in config under `configKey`. */
export interface CredentialField {
  configKey: string;
  label: string;
  type: 'password' | 'text';
  placeholder?: string;
  link?: ProviderLink;
  required?: boolean;
  [key: string]: unknown;
}

export interface ModelOption {
  id: string;
  name: string;
  badge?: string;
  description?: string;
}

export interface GuideStep {
  text: string;
  url?: string;
}

export interface ProviderCapabilities {
  diarization: boolean;
  languages: string[];
}

/** Serializable provider metadata (what `providers:list` returns for each engine). */
export interface ProviderDescriptor {
  id: string;
  name: string;
  badge?: string;
  /** Icon key, see renderer/components/settings/providers/providerIcons.js. */
  icon?: string;
  pricing?: string;
  description?: string;
  credentials: CredentialField[];
  guide?: GuideStep[];
  models: ModelOption[];
  /** Auto-updating aliases (e.g. Gemini's `*-latest`). */
  latestModels?: ModelOption[];
  defaultModel: string;
  allowCustomModel?: boolean;
  /** STT only. */
  capabilities?: ProviderCapabilities;
  [key: string]: unknown;
}

/** `providers:list` */
export interface ProviderDescriptors {
  stt: ProviderDescriptor[];
  llm: ProviderDescriptor[];
}

/** `providers:test` input. `values` are the (possibly unsaved) form values. */
export interface ProviderTestInput {
  kind: ProviderKind;
  id: string;
  values?: Record<string, string>;
  model?: string;
}

/** Test hook shared by both kinds: throws when the credentials don't work. */
export interface ProviderTestArgs {
  config: Record<string, unknown>;
  model: string;
}

/** Test doubles for the network/SDK, passed as the second argument by unit tests. */
export interface ProviderDeps {
  fetchImpl?: typeof fetch;
  sdk?: unknown;
}

export interface STTProvider extends ProviderDescriptor {
  // Parameters are filled in when providers are ported (Phase 5); the shape is checked against
  // electron/services/transcription.js, which is the only caller.
  transcribe: (args: Record<string, unknown>, deps?: ProviderDeps) => Promise<TranscriptSegment[]>;
  test: (args: ProviderTestArgs, deps?: ProviderDeps) => Promise<void>;
}

export interface LLMGenerateArgs {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  config: Record<string, unknown>;
  /** Ask for JSON output (false in Markdown mode). */
  json?: boolean;
  /** Called with each streamed piece of text. */
  onText?: (delta: string) => void;
}

export interface LLMProvider extends ProviderDescriptor {
  generate: (args: LLMGenerateArgs, deps?: ProviderDeps) => Promise<string>;
  test: (args: ProviderTestArgs, deps?: ProviderDeps) => Promise<void>;
  /** Retired model IDs mapped to their replacements (not sent to the renderer). */
  _deprecatedModels?: Record<string, string>;
}
