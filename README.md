![Electron.js](https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=Electron&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![FFmpeg](https://shields.io/badge/FFmpeg-%23171717.svg?logo=ffmpeg&style=for-the-badge&labelColor=171717&logoColor=5cb85c)
![Google Gemini](https://img.shields.io/badge/google%20gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white)
![Notion](https://img.shields.io/badge/Notion-%23000000.svg?style=for-the-badge&logo=notion&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)
![Google Chrome](https://img.shields.io/badge/Google%20Chrome-4285F4?style=for-the-badge&logo=GoogleChrome&logoColor=white)

# MeetMind

AI-powered meeting notes for Windows. Records system audio + microphone, transcribes with **Google Speech-to-Text (v1/v2)**, **AssemblyAI**, or **Sarvam AI**, generates structured notes with Gemini, and uploads to Notion — automatically triggered from Google Meet or Zoom via a Chrome extension.

---

## Features

- **Dual audio capture** — System audio (loopback) + microphone (renderer capture, with FFmpeg fallback)
- **Speaker diarization** — Supported (Google STT where available, AssemblyAI speaker labels, or Sarvam AI diarization)
- **AI-structured notes** — Gemini generates action items, key points, decisions, and open questions
- **Notion sync** — Full block hierarchy uploaded to a Notion **database or parent page** (auto-detected)
- **Chrome extension** — Floating overlay in Google Meet and Zoom with one-click recording
- **Session history** — SQLite-backed local storage of all sessions, transcripts, and notes (persisted via `sql.js`; includes session deletion)
- **System tray / Single-instance** — Runs in the background (always accessible) and strictly prevents duplicate running instances/tray icons
- **Bilingual code-switching** — Transcription and AI support mixed English & Malayalam meetings (Sarvam AI is optimized for this)

---

## Architecture

```
Chrome Extension (MV3)
    ↕ WebSocket ws://localhost:39842
Electron Main Process
    ├── Renderer capture (loopback+mic) → webm → FFmpeg convert → WAV
    ├── (fallback) FFmpeg dshow/WASAPI  →  WAV file
    ├── Google STT / AssemblyAI / Sarvam AI  →  transcript JSON
    ├── Gemini API  →  notes JSON
    ├── Notion API  →  page URL (created under a parent page or database)
    └── SQLite  →  local session store (sql.js → `meetmind.db` in app userData)
         ↕ IPC (contextBridge)
React Renderer (Vite + Tailwind CSS config with CSS var theming)
```

---

## Prerequisites

| Requirement              | Notes                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Windows 10/11 x64        | Required for WASAPI/dshow audio capture                            |
| Node.js 20+              | [nodejs.org](https://nodejs.org)                                   |
| FFmpeg for Windows       | See [setup instructions](#ffmpeg-setup)                            |
| Google Cloud API key     | Required only if using Google Speech-to-Text                       |
| AssemblyAI API key       | Optional alternative to Google STT                                 |
| Sarvam AI API key        | Optional STT provider; strong Malayalam–English code-switching     |
| Gemini API key           | [aistudio.google.com](https://aistudio.google.com/app/apikey)      |
| Notion integration token | [notion.so/my-integrations](https://www.notion.so/my-integrations) |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourname/meetmind.git
cd meetmind
npm install
```

### 2. FFmpeg setup

Download FFmpeg for Windows from [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) (essentials build), then:

```bash
# Copy ffmpeg.exe and ffprobe.exe into:
assets/ffmpeg/ffmpeg.exe
assets/ffmpeg/ffprobe.exe
```

### 3. Configure API keys [skip]

Copy `.env.example` to `.env` and fill in your keys (for reference only — keys are stored in the app's Settings screen at runtime, not from `.env`).

### 4. Run in development

```bash
npm run dev
```

This starts the Vite dev server (port 5173) and Electron simultaneously.

### 5. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 6. First run

The app will prompt you to enter your API keys in Settings. Fill in:

- Speech-to-Text provider (Google STT, AssemblyAI, or Sarvam AI)
- Google Cloud API Key (if using Google STT)
- AssemblyAI API Key (if using AssemblyAI)
- Sarvam AI API Key (if using Sarvam AI)
- Gemini API Key
- Notion Integration Token
- Notion parent **Page ID or Database ID**

---

## API Key Setup

### Google Cloud Speech-to-Text

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable **Cloud Speech-to-Text API**
4. Go to **Credentials** → **Create credentials** → **API key**
5. Paste the key into MeetMind Settings

### Sarvam AI

Indian STT with native Malayalam–English code-switching. MeetMind uses the **saaras:v3** model in **codemix** mode with automatic language detection and speaker diarization.

1. Go to [dashboard.sarvam.ai](https://dashboard.sarvam.ai)
2. Create an account or sign in
3. Generate an API key from the **API Keys** section
4. In MeetMind Settings, choose **Sarvam AI** as the Speech-to-Text provider
5. Paste the key into the **Sarvam AI API Key** field

### Gemini API

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Paste into MeetMind Settings
4. Choose a Gemini model in Settings (default: **Gemini 3.5 Flash Lite**)

### Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration** → fill in name → **Submit**
3. Copy the **Internal Integration Token** (`secret_xxx…`)
4. Open your target Notion database → **⋯ menu** → **Connections** → add your integration
5. Copy the **Database ID** from the URL: `notion.so/workspace/{DATABASE_ID}?v=…`
6. Paste both into MeetMind Settings

### GCS credentials for v2 BatchRecognize (optional)

To use Speech-to-Text v2 **BatchRecognize** (long audio without chunking), audio must be in Google Cloud Storage. You need:

- **Bucket** — MeetMind uploads the WAV here; Speech-to-Text reads it.
- **Service account** — With **Storage Object Admin** (or Creator + Deleter) on that bucket; download its JSON key.
- **Speech-to-Text service agent** — Must have **Storage Object Viewer** on the bucket (automatic when the bucket is in the same project).

**Step-by-step:** See **[docs/GCS-SETUP.md](docs/GCS-SETUP.md)** for bucket creation, IAM roles, key download, and MeetMind Settings.

### System Audio (Stereo Mix)

For system audio capture, MeetMind prefers **WASAPI loopback** (works with speakers, headphones, USB, and Bluetooth). If FFmpeg loopback isn’t available on your system, you can fall back to "Stereo Mix":

1. Right-click the speaker icon in the taskbar → **Sound settings**
2. Scroll to **More sound settings** → **Recording** tab
3. Right-click empty area → **Show Disabled Devices**
4. Right-click **Stereo Mix** → **Enable**

Alternatively, install [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) for a virtual loopback device.

---

## Project Structure

```
meetmind/
├── electron/
│   ├── main.js                 # Electron main process, IPC handlers, tray
│   ├── preload.js              # contextBridge API exposed to renderer
│   ├── websocket-server.js     # WebSocket bridge to Chrome extension
│   ├── audio/
│   │   ├── recorder.js         # FFmpeg dual-track capture + device enumeration
│   │   ├── mixer.js            # FFmpeg filter graph construction
│   │   └── ffmpeg-path.js      # Dev/packaged FFmpeg path resolution
│   ├── services/
│   │   ├── transcription.js    # Google STT, AssemblyAI, and Sarvam AI transcription
│   │   ├── gemini.js           # Gemini LLM, model selector, system prompt
│   │   └── notion.js           # Notion block builder, batched upload
│   ├── db/
│   │   └── sessions.js         # SQLite session store (sql.js persisted to disk)
│   └── utils/
│       ├── config.js           # electron-store configuration
│       └── logger.js           # Structured file + console logger
├── renderer/
│   ├── index.html
│   ├── app.jsx                 # React root, routing, app context
│   ├── components/
│   │   ├── Dashboard.jsx       # Session list with sentiment badges
│   │   ├── NoteViewer.jsx      # Notes display: action items → key points → decisions
│   │   ├── TranscriptViewer.jsx # Speaker transcript with search + copy
│   │   ├── RecordingBar.jsx    # Live timer + stop button
│   │   ├── Settings.jsx        # API keys, model selector, audio devices, onboarding
│   │   └── ProcessingOverlay.jsx # 3-stage animated progress overlay
│   └── styles/globals.css      # Tailwind + dark theme CSS vars
├── extension/
│   ├── manifest.json           # Chrome MV3
│   ├── background.js           # Tab detection, WebSocket, badge management
│   ├── content.js              # Overlay iframe injection into meeting pages
│   ├── popup.html / popup.js   # Extension action popup
│   └── overlay/
│       ├── overlay.html        # Floating pill shell
│       ├── overlay.js          # 5 states: IDLE/RECORDING/PROCESSING/COMPLETE/OFFLINE
│       └── overlay.css         # Pill styles + pulse/spin animations
├── assets/
│   ├── ffmpeg/                 # Place ffmpeg.exe + ffprobe.exe here
│   └── icons/                  # App icons (icon.svg + generated PNGs)
├── scripts/
│   ├── build-extension.js      # Package extension zip (Extension/ folder)
│   └── generate-icons.js       # Icon generation script
├── package.json
├── vite.config.js
├── electron-builder.yml
└── .env.example
```

---

## Available Scripts

| Script                   | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `npm run dev`            | Start Electron + Vite dev server concurrently                                      |
| `npm run build`          | Build renderer, extension zip, and Windows NSIS installer                          |
| `npm run build:renderer` | Build renderer only (Vite)                                                         |
| `npm run build:electron` | Package Electron app only                                                          |
| `npm run build:ext`      | Zip Chrome extension into `dist/meetmind-extension.zip` (`Extension/` root folder) |
| `npm run generate-icons` | Generate PNG icons from `assets/icons/icon.svg`                                    |

---

## Building for Production

```bash
# 1. Ensure ffmpeg.exe is in assets/ffmpeg/
# 2. Ensure icon.ico is in assets/icons/
# 3. Build everything:
npm run build
```

Output:

- `dist/desktop/MeetMind Setup 1.0.0.exe`
- `dist/meetmind-extension.zip` — contains an `Extension/` folder with the unpacked Chrome extension

> [!CAUTION]
> Ensure `dist/renderer/**` is included in `package.json` `build.files` before building. Otherwise, the installed app will open a blank window because the `dist` folder is in `.gitignore`. Note: Never commit downloaded FFmpeg `.exe` files, as they exceed GitHub's 100MB file size limit and are ignored by default.

To build only the Chrome extension:

```powershell
npm run build:ext
```

Extract the zip and load the inner `Extension/` folder in Chrome (**Load unpacked**), or continue using the repo's `extension/` folder during development.

---

## WebSocket Protocol

The desktop app listens on `ws://localhost:39842`. The Chrome extension communicates via:

**Extension → Desktop**

| Message                                                 | Description     |
| ------------------------------------------------------- | --------------- |
| `{ type: "START_RECORDING", meetingUrl, meetingTitle }` | Begin recording |
| `{ type: "STOP_RECORDING" }`                            | End recording   |
| `{ type: "APP_STATUS" }`                                | Heartbeat ping  |

**Desktop → Extension**

| Message                                                 | Description         |
| ------------------------------------------------------- | ------------------- |
| `{ type: "APP_STATUS", recording, sessionId }`          | Status response     |
| `{ type: "RECORDING_STARTED", sessionId }`              | Recording confirmed |
| `{ type: "RECORDING_STOPPED" }`                         | Recording ended     |
| `{ type: "PROCESSING_PROGRESS", stage, percent }`       | Pipeline progress   |
| `{ type: "PROCESSING_COMPLETE", notionUrl, sessionId }` | Done                |
| `{ type: "PROCESSING_ERROR", error }`                   | Error               |

Security: only connections from `chrome-extension://` origins are accepted.

---

## Gemini Models

| Model ID                 | Label                         | Best for                       |
| ------------------------ | ----------------------------- | ------------------------------ |
| `gemini-3.5-flash-lite`  | Gemini 3.5 Flash Lite         | Default — fast, cost-effective |
| `gemini-3.5-flash`       | Gemini 3.5 Flash              | Balanced quality and speed     |
| `gemini-3.6-flash`       | Gemini 3.6 Flash              | Latest flash model             |
| `gemini-3.1-flash-lite`  | Gemini 3.1 Flash Lite         | Lightweight summaries          |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (Experimental) | Long or complex meetings       |

Older model IDs saved in settings are migrated automatically (for example, `gemini-3-flash-preview` → `gemini-3.6-flash`).

---

## Session Statuses

| Status         | Meaning                           |
| -------------- | --------------------------------- |
| `recording`    | Audio is being captured           |
| `transcribing` | Speech-to-text running            |
| `generating`   | Gemini generating notes           |
| `uploading`    | Uploading to Notion               |
| `complete`     | All done                          |
| `error`        | Pipeline failed (retry available) |

---

## License

MIT
