const Store = require('electron-store');
const { DEFAULT_SYSTEM_PROMPT } = require('../services/prompts');
const { sttRegistry, llmRegistry, providerConfigKeys } = require('../providers');
const { migrateLegacyModels } = require('./configMigration');
const { LEGACY_GOOGLE_KEYS, migrateLegacyCalendar, sanitizeSources } = require('../calendar/calendar-sources');
const { v4: uuidv4 } = require('uuid');
const { DEFAULT_MAC_CAPTURE_STRATEGY, normalizeMacCaptureStrategy } = require('../audio/mac-capture');

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
  // macOS only: how system audio is captured (see electron/audio/mac-capture.js).
  macCaptureStrategy: {
    type: 'string',
    default: DEFAULT_MAC_CAPTURE_STRATEGY,
  },
  // Calendar sources (Google accounts and ICS links), see electron/calendar/. No default: an
  // unset key tells migrateLegacyCalendar the pre-4.15 Google keys below haven't moved yet.
  calendars: { type: 'array' },
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
};

// Provider credential/option keys (API keys, project IDs, ...) come from the provider registries.
for (const field of providerConfigKeys()) {
  schema[field.configKey] = { type: 'string', default: '' };
}

const store = new Store({ schema, name: 'meetmind-config' });

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
  for (const key of remove) store.delete(key);

  const rawCalendar = { calendars: store.get('calendars') };
  for (const key of LEGACY_GOOGLE_KEYS) rawCalendar[key] = store.get(key);
  const calendar = migrateLegacyCalendar(rawCalendar, uuidv4);
  for (const [key, value] of Object.entries(calendar.set)) store.set(key, value);
  for (const key of calendar.remove) store.delete(key);
}

/** Saved model per provider, validated against each provider's list. */
function resolveModels(registry, saved = {}) {
  const out = {};
  for (const provider of registry.list()) {
    out[provider.id] = registry.resolveModel(provider, saved[provider.id]);
  }
  return out;
}

function getConfig() {
  applyLegacyMigration();

  const llmProvider = llmRegistry.has(store.get('llmProvider')) ? store.get('llmProvider') : llmRegistry.defaultId();
  const sttService = sttRegistry.has(store.get('sttService')) ? store.get('sttService') : sttRegistry.defaultId();
  const fallback = store.get('llmFallback') || {};
  const llmFallback = llmRegistry.has(fallback.provider)
    ? { provider: fallback.provider, model: llmRegistry.resolveModel(llmRegistry.get(fallback.provider), fallback.model) }
    : {};

  const providerFields = {};
  for (const field of providerConfigKeys()) {
    providerFields[field.configKey] = store.get(field.configKey) || '';
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
    theme:                     store.get('theme') || 'light',
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
    macCaptureStrategy:        normalizeMacCaptureStrategy(store.get('macCaptureStrategy')),
    calendars:                 sanitizeSources(store.get('calendars')),
    dashboardRecentLimit:      store.get('dashboardRecentLimit') || 5,
    notionUploadTranscript:    store.get('notionUploadTranscript') !== false,
    pdfExportDir:              store.get('pdfExportDir') || '',
    pdfIncludeTranscript:      store.get('pdfIncludeTranscript') === true,
  };
}

function setConfig(key, value) {
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

function setMultipleConfig(updates) {
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

module.exports = {
  store,
  getConfig,
  setConfig,
  setMultipleConfig,
  isFirstRun,
  markOnboardingComplete,
  DEFAULT_SYSTEM_PROMPT,
};
