# MeetMind v{VERSION} 📎

## Changelog

{CHANGELOG_BODY}

## Downloads

- **Windows installer** (recommended):

  - `MeetMind Setup x.y.z.exe`

- **Optional browser extension bundle** :

  - `meetmind-extension.zip` – for manual installation of the extension.

> Note: Auto‑update is not yet wired up. To upgrade, download and run the latest installer from this release.

## Setup

### Windows App

1. Install the Windows `.exe` from the Assets section below.
2. Open MeetMind → **Settings → API Keys**.
3. Choose your **Transcription Service**:
   - For **AssemblyAI** (Recommended):
     - Paste your AssemblyAI API key.
     - (Optional) Add a short prompt to fine‑tune behavior for English/Malayalam meetings.
   - For **Google STT**: Enter your Google Cloud API key and Project ID.
   - For **Sarvam AI STT**: Paste your Sarvam AI API key
4. Configure **Audio Devices** (System + Microphone) and run a quick test recording.

### Browser Extension

1. Extract the `meetmind-extension.zip` archive
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select the `meetmind-chrome-extension` folder