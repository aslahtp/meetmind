import GoogleCloudIcon from '../GoogleCloudIcon.jsx';
import SarvamIcon from '../SarvamIcon.jsx';
import AssemblyAiIcon from '../AssemblyAiIcon.jsx';

// ── Service descriptions ──────────────────────────────────────────────────────

export const STT_SERVICES = [
  {
    id: 'google',
    name: 'Google Cloud STT',
    badge: 'v2 Chirp 3',
    icon: GoogleCloudIcon,
    pricing: 'Free tier available (60 mins/mo), then ~$0.016/min',
    description:
      'High accuracy with speaker diarization. Supports English and Malayalam (ml-IN) with code-switching. Best overall for multilingual meetings.',
    requiresKey: 'googleApiKey',
  },
  {
    id: 'sarvam',
    name: 'Sarvam AI',
    badge: 'Saarika v2.5',
    icon: SarvamIcon,
    pricing: 'Pay-as-you-go, INR-based billing (~₹0.50/min)',
    description:
      'Built specifically for Indian languages with excellent Malayalam-English code-switching and accent handling. Requires Sarvam API key.',
    requiresKey: 'sarvamApiKey',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    badge: 'Conformer-2',
    icon: AssemblyAiIcon,
    pricing: 'Free tier available (100 hrs), then $0.37/hr',
    description:
      'Production-ready transcription with built-in speaker diarization. Good for English meetings.',
    requiresKey: 'assemblyAiApiKey',
  },
];

export const GEMINI_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Default',
    description: 'Fast, high-quality reasoning and structured generation. Best overall balance of speed and accuracy.',
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    badge: 'Stable',
    description: 'Reliable previous-generation Flash model. Good fallback if 3.8 is unavailable.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    badge: 'Lite',
    description: 'Lightweight and ultra-fast. Best for short meetings or low-latency note generation.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    badge: 'Pro',
    description: 'Highest capability model for complex, lengthy, or multi-speaker technical discussions.',
  },
];

// Per-provider "How to get a key" guides, shown next to each key field.
export const KEY_GUIDES = {
  google: [
    { text: 'Go to Google AI Studio', url: 'https://aistudio.google.com/app/apikey' },
    { text: 'Click "Get API Key" → "Create API Key"' },
    { text: 'Copy the key and paste it into both the Google Cloud STT and Gemini fields' },
    { text: '(Optional) For Cloud STT v2, enable the Cloud Speech-to-Text API in Google Cloud Console', url: 'https://console.cloud.google.com/apis/library/speech.googleapis.com' },
  ],
  sarvam: [
    { text: 'Go to the Sarvam AI Dashboard', url: 'https://dashboard.sarvam.ai' },
    { text: 'Sign up / log in and open "API Keys"' },
    { text: 'Create a new key and paste it into the Sarvam API key field' },
  ],
  assemblyai: [
    { text: 'Go to the AssemblyAI Dashboard', url: 'https://www.assemblyai.com/dashboard/signup' },
    { text: 'Sign up and copy your API key from the dashboard home' },
    { text: 'Paste it into the AssemblyAI API key field' },
  ],
  notion: [
    { text: 'Go to the Notion Integrations page', url: 'https://www.notion.so/profile/integrations' },
    { text: 'Click "+ New integration", name it "MeetMind", select your workspace' },
    { text: 'Copy the "Internal Integration Secret" and paste it into the API key field' },
    { text: 'Open your target Notion page or database → "..." menu → "Connect to" → select "MeetMind"' },
    { text: 'Copy the Page ID, Database ID, or full Notion URL and paste it into the page field', hint: 'You can paste the 32-character ID or the full URL directly from your browser' },
  ],
  'google-calendar': [
    { text: 'Go to Google Cloud Console Credentials', url: 'https://console.cloud.google.com/apis/credentials' },
    { text: 'Enable the Google Calendar API in your project', url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', hint: 'Required: click "Enable" on this page for project 119097603796' },
    { text: 'Go to Credentials → "+ Create Credentials" → "OAuth client ID" → Application type: "Desktop app"' },
    { text: 'Copy the Client ID and Client Secret and paste them into the fields below' },
    { text: 'Click "Connect Google Calendar" to authorize access' },
  ],
};
