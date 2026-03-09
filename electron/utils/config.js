const Store = require('electron-store');

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
    default: 'gemini-3.1-flash-lite-preview',
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
};

const store = new Store({ schema, name: 'meetmind-config' });

const DEPRECATED_GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-thinking-exp'];
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

function getConfig() {
  let selectedModel = store.get('selectedModel');
  if (DEPRECATED_GEMINI_MODELS.includes(selectedModel)) {
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
};
