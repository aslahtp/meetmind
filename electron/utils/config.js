const Store = require('electron-store');

const schema = {
  googleApiKey: {
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
  selectedModel: {
    type: 'string',
    default: 'gemini-1.5-flash',
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

function getConfig() {
  return {
    googleApiKey:     store.get('googleApiKey'),
    geminiApiKey:     store.get('geminiApiKey'),
    notionToken:      store.get('notionToken'),
    notionDatabaseId: store.get('notionDatabaseId'),
    selectedModel:    store.get('selectedModel'),
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
