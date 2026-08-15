## Changelog

### v2.0.8

- **Multi-Version Release Notes Generator** — created `scripts/generate-release-notes.js` to reliably parse and bundle all changelog entries between the new release and the last published release tag on GitHub, eliminating shell string escaping issues in CI/CD.

### v2.0.7

- **Symmetrical Sidebar Bottom Spacing** — removed the compounding `pb-6` on `<aside>` and set uniform `py-3` padding on the recording CTA section so top and bottom margins around the button are equal.

### v2.0.6

- **Theme-Aware Sarvam AI Logo** — updated `SarvamIcon` to load `sarvam-dark.svg` with `dark:invert`, providing a dark logo in light mode and automatically inverting to white in dark mode.

### v2.0.5

- **Conditional Save Button in Settings** — the "Save Changes" button now only appears when there are actual unsaved changes in the Settings form (`isDirty`), or during the active saving/saved feedback cycle.

### v2.0.4

- **Refined Sidebar Theme Control** — cleaned up the theme toggle button in the sidebar to clearly label the control as `"Theme"` with dynamic icon (`Monitor` / `Sun` / `Moon`) and distinct `"System"`, `"Light"`, or `"Dark"` badge, eliminating duplicate words.

## Downloads

- **Windows installer** (recommended):

  - `MeetMind Setup 2.0.8.exe`
- **Optional browser extension bundle**:

  - `meetmind-extension.zip` - for manual installation of the extension.

## Setup

### Windows App

1. Install the Windows `.exe` from the Assets section below.
2. Open MeetMind -> **Settings -> API Keys**.
3. Choose your **Transcription Service**:
   - For **AssemblyAI** (Recommended):
     - Paste your AssemblyAI API key.
     - (Optional) Add a short prompt to fine-tune behavior for English/Malayalam meetings.
   - For **Google STT**: Enter your Google Cloud API key and Project ID.
   - For **Sarvam AI STT**: Paste your Sarvam AI API key
4. Configure **Audio Devices** (System + Microphone) and run a quick test recording.

### Browser Extension

1. Extract the `meetmind-extension.zip` archive
2. Open Chrome -> `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select the `meetmind-chrome-extension` folder
