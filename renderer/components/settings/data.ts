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
    { text: 'Enable the Google Calendar API in your project', url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', hint: 'Required: click "Enable" on this page with your project selected' },
    { text: 'Go to Credentials → "+ Create Credentials" → "OAuth client ID" → Application type: "Desktop app"' },
    { text: 'Copy the Client ID and Client Secret and paste them into the fields below' },
    { text: 'Click "Sign in with Google" to authorize read-only access' },
  ],
};

// Where each calendar app hands out its subscription (ICS / iCal / webcal) link.
export const ICS_GUIDES = [
  {
    id: 'google',
    label: 'Google',
    steps: [
      { text: 'Open Google Calendar settings on the web', url: 'https://calendar.google.com/calendar/r/settings' },
      { text: 'Under "Settings for my calendars", pick the calendar, then "Integrate calendar"' },
      { text: 'Copy the "Secret address in iCal format"', hint: 'Not the public address. Anyone with the secret address can see your events, so keep it private.' },
    ],
  },
  {
    id: 'outlook',
    label: 'Outlook',
    steps: [
      { text: 'Open Outlook on the web → Settings → Calendar → Shared calendars', url: 'https://outlook.office.com/calendar/options/calendar/SharedCalendars' },
      { text: 'Under "Publish a calendar", choose the calendar and "Can view all details", then Publish' },
      { text: 'Copy the ICS link', hint: 'Personal Outlook.com accounts work the same way. If Publish is missing, your organization has turned it off.' },
    ],
  },
  {
    id: 'apple',
    label: 'Apple',
    steps: [
      { text: 'On a Mac, open Calendar and Control-click the calendar in the sidebar → "Share Calendar"' },
      { text: 'Tick "Public Calendar" and click Done, then open the same menu and copy the webcal:// link', hint: 'On iPhone: Calendars → ⓘ next to the calendar → turn on Public Calendar → Share Link. The link is unlisted but anyone who has it can view the calendar.' },
    ],
  },
  {
    id: 'calcom',
    label: 'Cal.com',
    steps: [
      { text: 'Cal.com writes bookings into the calendar you connected to it (Google, Outlook or Apple)' },
      { text: 'Add that calendar’s link using its tab above, and your Cal.com bookings come with it' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    steps: [
      { text: 'Any calendar with a subscription, iCal, ICS or webcal link works: Proton, Fastmail, Zoho, Nextcloud and more' },
      { text: 'Look for "Share", "Publish" or "Subscribe" in the calendar’s settings and copy the link it gives you' },
    ],
  },
];
