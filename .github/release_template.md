## Changelog

{CHANGELOG_BODY}

## Downloads

- **Windows installer** (Windows 10 and 11):

  - `MeetMind-Setup-x.y.z.exe`
- **macOS app** (beta, macOS 14.2 or later):

  - `MeetMind-x.y.z-arm64.dmg` for Apple silicon (M1 and later)
  - `MeetMind-x.y.z-x64.dmg` for Intel Macs
  - The `-mac.zip` files and `latest-mac.yml` are used by the in-app update check; you don't need them.
- **Optional browser extension bundle**:

  - `meetmind-extension.zip` - for manual installation of the extension.

Every download has a signed build-provenance attestation. To check that a file was built by this repository's release workflow from the tagged commit, run (with the [GitHub CLI](https://cli.github.com/)):

```bash
gh attestation verify MeetMind-x.y.z-arm64.dmg --repo aslahtp/meetmind
```

## Setup

### Windows App

1. Install the Windows `.exe` from the Assets section below.
2. Open MeetMind -> **Settings**.
3. Under **System**, click **Download & Install FFmpeg** if FFmpeg isn't already installed.
4. Choose your **Transcription Service**:
   - For **AssemblyAI** (Recommended):
     - Paste your AssemblyAI API key.
     - (Optional) Add a short prompt to fine-tune behavior for meetings that mix English and Indic languages.
   - For **Google STT**: Enter your Google Cloud API key and Project ID.
   - For **Sarvam AI STT**: Paste your Sarvam AI API key
   - For **Groq Whisper**: Paste your Groq API key (no speaker labels)
   - Each engine has a model picker under its key.
5. Run a quick test recording.

### macOS App (beta)

The macOS app isn't signed by Apple yet, so macOS asks you to confirm it once:

1. Open the `.dmg` for your Mac and drag **MeetMind** to **Applications**.
2. Open MeetMind. When macOS says it can't verify the developer, click **Done**, then go to **System Settings -> Privacy & Security** and click **Open Anyway** next to the MeetMind message.
3. Set up your keys as for Windows (step 4 above). FFmpeg is already included.
4. In **Settings -> System -> Permissions**, allow **Microphone** and **Screen & System Audio Recording**.
5. Play a video and click **Test** under **Settings -> System -> Test system audio** to check that MeetMind hears your Mac's audio.

macOS forgets the permissions of an unsigned app after each update, so allow them again after updating. Updates aren't installed automatically on macOS: MeetMind tells you when one is out and opens this page. Meeting detection isn't available on macOS yet.

### Browser Extension

1. Extract the `meetmind-extension.zip` archive
2. Open Chrome -> `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked**
5. Select the extracted extension folder

## Quick Start

1. Open the **MeetMind** desktop app.
2. Join a meeting on **Google Meet** or **Zoom**.
3. On Windows, accept MeetMind's floating prompt when the call starts; on either system, press **Record** in the app or use the Chrome extension's button.
4. When finished, stop recording — MeetMind will automatically transcribe the audio, generate notes with your chosen model (Gemini, Groq or Claude), and sync to Notion if it's connected.
