## Changelog

### Added

- Settings → Notion Integration: toggle to include or omit the full meeting transcript when uploading to Notion. Notes and summaries are always uploaded. Defaults to on.

### Fixed

- Release notes generator now parses Keep a Changelog headings (`## [X.Y.Z] - YYYY-MM-DD`) so GitHub Releases include the real changelog instead of a fallback placeholder.

## Downloads

- **Windows installer** (recommended):

  - `MeetMind Setup 2.9.0.exe`
- **Optional browser extension bundle**:

  - `meetmind-extension.zip` - for manual installation of the extension.

## Setup

### Windows App

1. Install the Windows `.exe` from the Assets section below.
2. Open MeetMind -> **Settings**.
3. Under **System Dependencies**, click **Download & Install FFmpeg** to automatically install required audio binaries.
4. Choose your **Transcription Service**:
   - For **AssemblyAI** (Recommended):
     - Paste your AssemblyAI API key.
     - (Optional) Add a short prompt to fine-tune behavior for English/Malayalam meetings.
   - For **Google STT**: Enter your Google Cloud API key and Project ID.
   - For **Sarvam AI STT**: Paste your Sarvam AI API key
5. Configure **Audio Devices** (System + Microphone) and run a quick test recording.

### Browser Extension

1. Extract the `meetmind-extension.zip` archive
2. Open Chrome -> `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select the extracted extension folder

## Quick Start

1. Open the **MeetMind** desktop app.
2. Join a meeting on **Google Meet** or **Zoom** in Chrome.
3. Click the floating MeetMind overlay button to start recording.
4. When finished, stop recording — MeetMind will automatically transcribe the audio, generate structured notes with Gemini, and sync to Notion.

