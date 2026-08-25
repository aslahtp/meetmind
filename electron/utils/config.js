const Store = require('electron-store');
const { AVAILABLE_MODELS, DEFAULT_GEMINI_MODEL, DEFAULT_SYSTEM_PROMPT } = require('../services/gemini');

const schema = {
  googleApiKey: {
    type: 'string',
    default: '',
  },
  googleCloudProjectId: {
    type: 'string',
    default: '',
  },
  googleCloudStorageBucket: {
    type: 'string',
    default: '',
  },
  googleCloudStorageKeyPath: {
    type: 'string',
    default: '',
  },
  geminiApiKey: {
    type: 'string',
    default: '',
  },
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
  selectedModel: {
    type: 'string',
    default: DEFAULT_GEMINI_MODEL,
  },
  geminiModel: {
    type: 'string',
    default: DEFAULT_GEMINI_MODEL,
  },
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
    default: 'dark',
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
  assemblyAiApiKey: {
    type: 'string',
    default: '',
  },
  assemblyAiPrompt: {
    type: 'string',
    default: '',
  },
  sarvamApiKey: {
    type: 'string',
    default: '',
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
  hideLogsInSidebar: {
    type: 'boolean',
    default: false,
  },
  googleCalendarClientId: {
    type: 'string',
    default: '',
  },
  googleCalendarClientSecret: {
    type: 'string',
    default: '',
  },
  googleCalendarRefreshToken: {
    type: 'string',
    default: '',
  },
  googleCalendarEnabled: {
    type: 'boolean',
    default: false,
  },
  googleCalendarEmail: {
    type: 'string',
    default: '',
  },
  dashboardRecentLimit: {
    type: 'number',
    default: 5,
  },
};

const store = new Store({ schema, name: 'meetmind-config' });

const DEPRECATED_GEMINI_MODELS = {
  'gemini-1.5-flash': 'gemini-3.5-flash-lite',
  'gemini-1.5-pro': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash-thinking-exp': 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
  'gemini-3-flash-preview': 'gemini-3.6-flash',
  'gemini-3-pro-preview': 'gemini-3.6-flash',
};

function getConfig() {
  let selectedModel = store.get('selectedModel') || store.get('geminiModel');
  if (selectedModel in DEPRECATED_GEMINI_MODELS) {
    selectedModel = DEPRECATED_GEMINI_MODELS[selectedModel];
    store.set('selectedModel', selectedModel);
    store.set('geminiModel', selectedModel);
  }
  if (!AVAILABLE_MODELS.includes(selectedModel)) {
    selectedModel = DEFAULT_GEMINI_MODEL;
    store.set('selectedModel', selectedModel);
    store.set('geminiModel', selectedModel);
  }

  const notionToken = store.get('notionToken') || store.get('notionApiKey') || '';
  const notionDbId = store.get('notionDatabaseId') || store.get('notionPageId') || '';
  const sysPrompt = store.get('geminiSystemPrompt') || store.get('systemPrompt') || '';
  const outMode = store.get('noteOutputMode') || store.get('promptOutputMode') || 'json';

  return {
    googleApiKey:              store.get('googleApiKey') || '',
    googleCloudProjectId:      store.get('googleCloudProjectId') || '',
    googleCloudStorageBucket:  store.get('googleCloudStorageBucket') || '',
    googleCloudStorageKeyPath: store.get('googleCloudStorageKeyPath') || '',
    geminiApiKey:              store.get('geminiApiKey') || '',
    notionToken,
    notionApiKey:              notionToken,
    notionDatabaseId:          notionDbId,
    notionPageId:              notionDbId,
    selectedModel,
    geminiModel:               selectedModel,
    systemAudioDevice:         store.get('systemAudioDevice') || '',
    micDevice:                 store.get('micDevice') || '',
    autoLaunch:                store.get('autoLaunch') ?? true,
    theme:                     store.get('theme') || 'dark',
    websocketPort:             store.get('websocketPort') || 39842,
    onboardingComplete:        store.get('onboardingComplete') || false,
    sttService:                store.get('sttService') || 'google',
    assemblyAiApiKey:          store.get('assemblyAiApiKey') || '',
    assemblyAiPrompt:          store.get('assemblyAiPrompt') || '',
    sarvamApiKey:              store.get('sarvamApiKey') || '',
    geminiSystemPrompt:        sysPrompt,
    systemPrompt:              sysPrompt,
    noteOutputMode:            outMode,
    promptOutputMode:          outMode,
    language:                  store.get('language') || 'ml-IN',
    enableDiarization:         store.get('enableDiarization') ?? true,
    minSpeakers:               store.get('minSpeakers') || 1,
    maxSpeakers:               store.get('maxSpeakers') || 6,
    autoCheckUpdates:          store.get('autoCheckUpdates') !== false,
    hideLogsInSidebar:         store.get('hideLogsInSidebar') || false,
    googleCalendarClientId:    store.get('googleCalendarClientId') || '',
    googleCalendarClientSecret: store.get('googleCalendarClientSecret') || '',
    googleCalendarRefreshToken: store.get('googleCalendarRefreshToken') || '',
    googleCalendarEnabled:     store.get('googleCalendarEnabled') || false,
    googleCalendarEmail:       store.get('googleCalendarEmail') || '',
    dashboardRecentLimit:      store.get('dashboardRecentLimit') || 5,
  };
}

function setConfig(key, value) {
  store.set(key, value);
  // Keep key aliases in sync
  if (key === 'notionApiKey') store.set('notionToken', value);
  if (key === 'notionToken') store.set('notionApiKey', value);
  if (key === 'notionDatabaseId') store.set('notionPageId', value);
  if (key === 'notionPageId') store.set('notionDatabaseId', value);
  if (key === 'geminiModel') store.set('selectedModel', value);
  if (key === 'selectedModel') store.set('geminiModel', value);
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
