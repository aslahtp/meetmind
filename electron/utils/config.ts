import Store from 'electron-store';
import type { CalendarSyncMinutes, Config, LlmFallback, ProviderConfigFields, ThemeSetting } from '../shared';
import { DEFAULT_SYSTEM_PROMPT } from '../services/prompts';
import { sttRegistry, llmRegistry, providerConfigKeys } from '../providers';
import type { Registry } from '../providers/registry';
import { migrateLegacyModels } from './configMigration';
import { LEGACY_GOOGLE_KEYS, DEFAULT_SYNC_MINUTES, migrateLegacyCalendar, sanitizeSources, normalizeSyncMinutes } from '../calendar/calendar-sources';
// uuid is ESM-only in its types but loads fine through require(); keep it a plain synchronous require.
const { v4: uuidv4 } = require('uuid');
import { DEFAULT_MAC_CAPTURE_STRATEGY, normalizeMacCaptureStrategy } from '../audio/mac-capture';
import { DEFAULT_RETENTION_DAYS, normalizeRetentionDays } from '../services/storage-rules';

/**
 * What electron-store holds: the settings as saved (any may be missing, and some are legacy keys),
 * not the validated, aliased view `getConfig()` returns. Provider credentials are stored under keys
 * the provider registries define, so they are read and written through plain string keys.
 */
interface StoredConfig {
  notionToken?: string;
  notionApiKey?: string;
  notionDatabaseId?: string;
  notionPageId?: string;
  selectedModel?: string;
  geminiModel?: string;
  secondaryGeminiModel?: string;
  llmProvider?: string;
  llmModels?: Record<string, string>;
  llmFallback?: LlmFallback;
  sttModels?: Record<string, string>;
  systemAudioDevice?: string;
  micDevice?: string;
  autoLaunch?: boolean;
  theme?: string;
  websocketPort?: number;
  onboardingComplete?: boolean;
  sttService?: string;
  geminiSystemPrompt?: string;
  systemPrompt?: string;
  noteOutputMode?: string;
  promptOutputMode?: string;
  language?: string;
  enableDiarization?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
  autoCheckUpdates?: boolean;
  autoInstallUpdates?: boolean;
  hideLogsInSidebar?: boolean;
  pinNotesViewToggle?: boolean;
  showAudioWaveform?: boolean;
  meetingDetection?: boolean;
  recordUsesDetectedMeeting?: boolean;
  macCaptureStrategy?: string;
  calendars?: unknown[];
  calendarSyncMinutes?: number;
  googleCalendarClientId?: string;
  googleCalendarClientSecret?: string;
  googleCalendarRefreshToken?: string;
  googleCalendarEnabled?: boolean;
  googleCalendarEmail?: string;
  dashboardRecentLimit?: number;
  notionUploadTranscript?: boolean;
  pdfExportDir?: string;
  pdfIncludeTranscript?: boolean;
  recordingRetentionDays?: number;
  // Kept by services/updater.ts.
  lastSeenVersion?: string;
  updateRelaunchHiddenAt?: number;
}

const schema = {
  notionToken: {
    type: 'string',
    default: '',
  },
  notionApiKey: {
    type: 'string',
    default: '',
  },
  notionDatabaseId: {
    type: 'string',
    default: '',
  },
  notionPageId: {
    type: 'string',
    default: '',
  },
  // Legacy (pre-4.0) single-Gemini keys; read once by migrateLegacyModels, then removed.
  selectedModel: { type: 'string' },
  geminiModel: { type: 'string' },
  secondaryGeminiModel: { type: 'string' },
  // Active LLM provider, per-provider model choices ({providerId: modelId}) and the
  // optional cross-provider fallback ({provider, model}; empty object = disabled).
  llmProvider: { type: 'string', default: 'gemini' },
  llmModels: { type: 'object', default: {} },
  llmFallback: { type: 'object', default: {} },
  sttModels: { type: 'object', default: {} },
  systemAudioDevice: {
    type: 'string',
    default: '',
  },
  micDevice: {
    type: 'string',
    default: '',
  },
  autoLaunch: {
    type: 'boolean',
    default: true,
  },
  theme: {
    type: 'string',
    default: 'light',
  },
  websocketPort: {
    type: 'number',
    default: 39842,
  },
  onboardingComplete: {
    type: 'boolean',
    default: false,
  },
  sttService: {
    type: 'string',
    default: 'google',
  },
  geminiSystemPrompt: {
    type: 'string',
    default: '',
  },
  systemPrompt: {
    type: 'string',
    default: '',
  },
  noteOutputMode: {
    type: 'string',
    default: 'json',
  },
  promptOutputMode: {
    type: 'string',
    default: 'json',
  },
  language: {
    type: 'string',
    default: 'ml-IN',
  },
  enableDiarization: {
    type: 'boolean',
    default: true,
  },
  minSpeakers: {
    type: 'number',
    default: 1,
  },
  maxSpeakers: {
    type: 'number',
    default: 6,
  },
  autoCheckUpdates: {
    type: 'boolean',
    default: true,
  },
  // Download updates by themselves and install them when the app is idle or quits.
  autoInstallUpdates: {
    type: 'boolean',
    default: false,
  },
  hideLogsInSidebar: {
    type: 'boolean',
    default: false,
  },
  pinNotesViewToggle: {
    type: 'boolean',
    default: true,
  },
  showAudioWaveform: {
    type: 'boolean',
    default: true,
  },
  meetingDetection: {
    type: 'boolean',
    default: true,
  },
  // Beta: the app's Record button and the tray take the detected meeting's platform, link and
  // title (the detection prompt always does). See resolveMeetingSource in services/meeting-title.ts.
  recordUsesDetectedMeeting: {
    type: 'boolean',
    default: true,
  },
  // macOS only: how system audio is captured (see electron/audio/mac-capture.ts).
  macCaptureStrategy: {
    type: 'string',
    default: DEFAULT_MAC_CAPTURE_STRATEGY,
  },
  // Calendar sources (Google accounts and ICS links), see electron/calendar/. No default: an
  // unset key tells migrateLegacyCalendar the pre-4.15 Google keys below haven't moved yet.
  calendars: { type: 'array' },
  // Minutes between calendar syncs (one of SYNC_INTERVALS in calendar-sources.ts).
  calendarSyncMinutes: { type: 'number', default: DEFAULT_SYNC_MINUTES },
  // Legacy (pre-4.15) single Google Calendar keys; read once by migrateLegacyCalendar, then removed.
  googleCalendarClientId: { type: 'string' },
  googleCalendarClientSecret: { type: 'string' },
  googleCalendarRefreshToken: { type: 'string' },
  googleCalendarEnabled: { type: 'boolean' },
  googleCalendarEmail: { type: 'string' },
  dashboardRecentLimit: {
    type: 'number',
    default: 5,
  },
  notionUploadTranscript: {
    type: 'boolean',
    default: true,
  },
  // PDF export: '' means the Downloads folder (resolved when exporting).
  pdfExportDir: {
    type: 'string',
    default: '',
  },
  pdfIncludeTranscript: {
    type: 'boolean',
    default: false,
  },
  // Days to keep recordings' audio (0 = forever); older audio is deleted at startup. See
  // electron/services/storage-rules.ts.
  recordingRetentionDays: {
    type: 'number',
    default: DEFAULT_RETENTION_DAYS,
  },
};

// Provider credential/option keys (API keys, project IDs, ...) come from the provider registries.
const providerSchema: Record<string, { type: string; default: string }> = {};
for (const field of providerConfigKeys()) {
  providerSchema[field.configKey] = { type: 'string', default: '' };
}

// The schema is assembled from the registries at runtime, so it can't satisfy the per-key schema type.
type StoreSchema = NonNullable<ConstructorParameters<typeof Store<StoredConfig>>[0]>['schema'];
const store = new Store<StoredConfig>({
  schema: { ...schema, ...providerSchema } as unknown as StoreSchema,
  name: 'meetmind-config',
});

function applyLegacyMigration() {
  const raw = {
    selectedModel: store.get('selectedModel'),
    geminiModel: store.get('geminiModel'),
    secondaryGeminiModel: store.get('secondaryGeminiModel'),
    llmModels: store.get('llmModels'),
    llmFallback: store.get('llmFallback'),
  };
  const { set, remove } = migrateLegacyModels(raw, llmRegistry.get('gemini')._deprecatedModels);
  for (const [key, value] of Object.entries(set)) store.set(key, value);
  // The keys come from the migrations: they are StoredConfig's legacy keys.
  for (const key of remove) store.delete(key as keyof StoredConfig);

  const rawCalendar: Record<string, unknown> = { calendars: store.get('calendars') };
  for (const key of LEGACY_GOOGLE_KEYS) rawCalendar[key] = store.get(key);
  const calendar = migrateLegacyCalendar(rawCalendar, uuidv4);
  for (const [key, value] of Object.entries(calendar.set)) store.set(key, value);
  for (const key of calendar.remove) store.delete(key as keyof StoredConfig);
}

/** Saved model per provider, validated against each provider's list. */
function resolveModels(registry: Registry, saved: Record<string, string | undefined> = {}) {
  const out: Record<string, string> = {};
  for (const provider of registry.list()) {
    out[provider.id] = registry.resolveModel(provider, saved[provider.id]);
  }
  return out;
}

function getConfig(): Config {
  applyLegacyMigration();

  const savedLlmProvider = store.get('llmProvider');
  const llmProvider = savedLlmProvider && llmRegistry.has(savedLlmProvider) ? savedLlmProvider : llmRegistry.defaultId();
  const savedSttService = store.get('sttService');
  const sttService = savedSttService && sttRegistry.has(savedSttService) ? savedSttService : sttRegistry.defaultId();
  const fallback: LlmFallback = store.get('llmFallback') || {};
  const llmFallback: LlmFallback = fallback.provider && llmRegistry.has(fallback.provider)
    ? { provider: fallback.provider, model: llmRegistry.resolveModel(llmRegistry.get(fallback.provider), fallback.model) }
    : {};

  // One entry per credential or option the providers declare; `Config` lists today's keys.
  const providerFields = {} as ProviderConfigFields;
  for (const field of providerConfigKeys()) {
    (providerFields as unknown as Record<string, string>)[field.configKey] = (store.get(field.configKey) as string | undefined) || '';
  }

  const notionToken = store.get('notionToken') || store.get('notionApiKey') || '';
  const notionDbId = store.get('notionDatabaseId') || store.get('notionPageId') || '';
  const sysPrompt = store.get('geminiSystemPrompt') || store.get('systemPrompt') || '';
  const outMode = store.get('noteOutputMode') || store.get('promptOutputMode') || 'json';

  return {
    ...providerFields,
    notionToken,
    notionApiKey:              notionToken,
    notionDatabaseId:          notionDbId,
    notionPageId:              notionDbId,
    llmProvider,
    llmModels:                 resolveModels(llmRegistry, store.get('llmModels')),
    llmFallback,
    sttModels:                 resolveModels(sttRegistry, store.get('sttModels')),
    systemAudioDevice:         store.get('systemAudioDevice') || '',
    micDevice:                 store.get('micDevice') || '',
    autoLaunch:                store.get('autoLaunch') ?? true,
    theme:                     (store.get('theme') || 'light') as ThemeSetting,
    websocketPort:             store.get('websocketPort') || 39842,
    onboardingComplete:        store.get('onboardingComplete') || false,
    sttService,
    geminiSystemPrompt:        sysPrompt,
    systemPrompt:              sysPrompt,
    noteOutputMode:            outMode,
    promptOutputMode:          outMode,
    language:                  store.get('language') || 'ml-IN',
    enableDiarization:         store.get('enableDiarization') ?? true,
    minSpeakers:               store.get('minSpeakers') || 1,
    maxSpeakers:               store.get('maxSpeakers') || 6,
    autoCheckUpdates:          store.get('autoCheckUpdates') !== false,
    autoInstallUpdates:        store.get('autoInstallUpdates') === true,
    hideLogsInSidebar:         store.get('hideLogsInSidebar') || false,
    pinNotesViewToggle:        store.get('pinNotesViewToggle') !== false,
    showAudioWaveform:         store.get('showAudioWaveform') !== false,
    meetingDetection:          store.get('meetingDetection') !== false,
    recordUsesDetectedMeeting: store.get('recordUsesDetectedMeeting') !== false,
    macCaptureStrategy:        normalizeMacCaptureStrategy(store.get('macCaptureStrategy')),
    calendars:                 sanitizeSources(store.get('calendars')),
    calendarSyncMinutes:       normalizeSyncMinutes(store.get('calendarSyncMinutes')) as CalendarSyncMinutes,
    dashboardRecentLimit:      store.get('dashboardRecentLimit') || 5,
    notionUploadTranscript:    store.get('notionUploadTranscript') !== false,
    pdfExportDir:              store.get('pdfExportDir') || '',
    pdfIncludeTranscript:      store.get('pdfIncludeTranscript') === true,
    recordingRetentionDays:    normalizeRetentionDays(store.get('recordingRetentionDays')),
  };
}

function setConfig(key: string, value: unknown) {
  store.set(key, value);
  // Keep key aliases in sync
  if (key === 'notionApiKey') store.set('notionToken', value);
  if (key === 'notionToken') store.set('notionApiKey', value);
  if (key === 'notionDatabaseId') store.set('notionPageId', value);
  if (key === 'notionPageId') store.set('notionDatabaseId', value);
  if (key === 'systemPrompt') store.set('geminiSystemPrompt', value);
  if (key === 'geminiSystemPrompt') store.set('systemPrompt', value);
  if (key === 'promptOutputMode') store.set('noteOutputMode', value);
  if (key === 'noteOutputMode') store.set('promptOutputMode', value);
}

function setMultipleConfig(updates: Record<string, unknown>) {
  for (const [key, value] of Object.entries(updates)) {
    setConfig(key, value);
  }
}

function isFirstRun() {
  return !store.get('onboardingComplete');
}

function markOnboardingComplete() {
  store.set('onboardingComplete', true);
}

export {
  store,
  getConfig,
  setConfig,
  setMultipleConfig,
  isFirstRun,
  markOnboardingComplete,
  DEFAULT_SYSTEM_PROMPT,
};
