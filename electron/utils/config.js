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
  noteOutputMode: {
    type: 'string',
    default: 'json',
  },
  autoCheckUpdates: {
    type: 'boolean',
    default: true,
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
  let selectedModel = store.get('selectedModel');
  if (selectedModel in DEPRECATED_GEMINI_MODELS) {
    selectedModel = DEPRECATED_GEMINI_MODELS[selectedModel];
    store.set('selectedModel', selectedModel);
  }
  if (!AVAILABLE_MODELS.includes(selectedModel)) {
    selectedModel = DEFAULT_GEMINI_MODEL;
    store.set('selectedModel', selectedModel);
  }

  // Migration: if systemAudioDevice was saved as the WASAPI virtual ID but this
  // FFmpeg build doesn't support it, recorder.js will fall back automatically on
  // the next startRecording call and persist the real device. No action needed here
  // — the value is just returned as-is so the fallback path can run.

  return {
    googleApiKey:          store.get('googleApiKey'),
    googleCloudProjectId:     store.get('googleCloudProjectId') || '',
    googleCloudStorageBucket:  store.get('googleCloudStorageBucket') || '',
    googleCloudStorageKeyPath: store.get('googleCloudStorageKeyPath') || '',
    geminiApiKey:              store.get('geminiApiKey'),
    notionToken:      store.get('notionToken'),
    notionDatabaseId: store.get('notionDatabaseId'), // kept for migration
    notionPageId:     store.get('notionPageId') || store.get('notionDatabaseId') || '',
    selectedModel:    selectedModel || DEFAULT_GEMINI_MODEL,
    systemAudioDevice: store.get('systemAudioDevice'),
    micDevice:        store.get('micDevice'),
    autoLaunch:       store.get('autoLaunch'),
    theme:            store.get('theme'),
    websocketPort:    store.get('websocketPort'),
    onboardingComplete: store.get('onboardingComplete'),
    sttService:       store.get('sttService') || 'google',
    assemblyAiApiKey: store.get('assemblyAiApiKey') || '',
    assemblyAiPrompt: store.get('assemblyAiPrompt') || '',
    sarvamApiKey:     store.get('sarvamApiKey') || '',
    geminiSystemPrompt: store.get('geminiSystemPrompt') || '',
    noteOutputMode:   store.get('noteOutputMode') || 'json',
    autoCheckUpdates: store.get('autoCheckUpdates') !== false,
  };
}

function setConfig(key, value) {
  store.set(key, value);
}

function setMultipleConfig(updates) {
  for (const [key, value] of Object.entries(updates)) {
    store.set(key, value);
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
