// "How to get a key" guides for integrations. STT/LLM provider guides live in their descriptors
// (electron/providers).
export const KEY_GUIDES = {
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
