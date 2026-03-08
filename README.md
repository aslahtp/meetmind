# MeetMind

AI-powered meeting notes for Windows. Records system audio + microphone, transcribes with Google Speech-to-Text, generates structured notes with Gemini, and uploads to Notion — automatically triggered from Google Meet or Zoom via a Chrome extension.

---

## Features

- **Dual audio capture** — System audio (loopback) + microphone merged via FFmpeg
- **Speaker diarization** — Google STT identifies who said what
- **AI-structured notes** — Gemini generates action items, key points, decisions, and open questions
- **Notion sync** — Full block hierarchy uploaded directly to your Notion database
- **Chrome extension** — Floating overlay in Google Meet and Zoom with one-click recording
- **Session history** — SQLite-backed local storage of all sessions, transcripts, and notes
- **System tray** — Runs in the background, always accessible

---

## Architecture

```
Chrome Extension (MV3)
    ↕ WebSocket ws://localhost:39842
Electron Main Process
    ├── FFmpeg  →  WAV file
    ├── Google STT  →  transcript JSON
    ├── Gemini API  →  notes JSON
    ├── Notion API  →  page URL
    └── SQLite  →  local session store
         ↕ IPC (contextBridge)
React Renderer (Vite)
```

---

## Prerequisites


| Requirement              | Notes                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Windows 10/11 x64        | Required for WASAPI/dshow audio capture                            |
| Node.js 20+              | [nodejs.org](https://nodejs.org)                                   |
| FFmpeg for Windows       | See [setup instructions](#ffmpeg-setup)                            |
| Google Cloud API key     | Speech-to-Text enabled                                             |
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

- Google Cloud API Key (Speech-to-Text)
- Gemini API Key
- Notion Integration Token
- Notion Database ID

---

## API Key Setup

### Google Cloud Speech-to-Text

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable **Cloud Speech-to-Text API**
4. Go to **Credentials** → **Create credentials** → **API key**
5. Paste the key into MeetMind Settings

### Gemini API

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Paste into MeetMind Settings

### Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration** → fill in name → **Submit**
3. Copy the **Internal Integration Token** (`secret_xxx…`)
4. Open your target Notion database → **⋯ menu** → **Connections** → add your integration
5. Copy the **Database ID** from the URL: `notion.so/workspace/{DATABASE_ID}?v=…`
6. Paste both into MeetMind Settings

### System Audio (Stereo Mix)

For system audio capture, Windows requires "Stereo Mix" to be enabled:

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
│   │   ├── transcription.js    # Google STT REST, chunking, polling
│   │   ├── gemini.js           # Gemini LLM, model selector, system prompt
│   │   └── notion.js           # Notion block builder, batched upload
│   ├── db/
│   │   └── sessions.js         # SQLite session store (better-sqlite3)
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
│   └── generate-icons.js       # Icon generation script
├── package.json
├── vite.config.js
├── electron-builder.yml
└── .env.example
```

---

## Available Scripts


| Script                   | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `npm run dev`            | Start Electron + Vite dev server concurrently           |
| `npm run build`          | Build renderer + package Windows NSIS installer         |
| `npm run build:renderer` | Build renderer only (Vite)                              |
| `npm run build:electron` | Package Electron app only                               |
| `npm run build:ext`      | Zip Chrome extension into `dist/meetmind-extension.zip` |
| `npm run generate-icons` | Generate PNG icons from `assets/icons/icon.svg`         |


---

## Building for Production

```bash
# 1. Ensure ffmpeg.exe is in assets/ffmpeg/
# 2. Ensure icon.ico is in assets/icons/
# 3. Build everything:
npm run build
```

Output: `dist-electron/MeetMind Setup 1.0.0.exe`

### Package the Chrome extension

```powershell
npm run build:ext
# Output: dist/meetmind-extension.zip
```

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


| Model ID                        | Label                              | Best for               |
| ------------------------------- | ---------------------------------- | ---------------------- |
| `gemini-2.0-flash`              | Gemini 2.0 Flash (Fast)            | Quick summaries        |
| `gemini-3.1-flash-lite-preview` | Gemini 3.1 Flash Lite (Fast)       | Default                 |
| `gemini-1.5-pro`                | Gemini 1.5 Pro (Best)              | Long, complex meetings |
| `gemini-2.0-flash-thinking-exp` | Gemini 2.0 Thinking (Experimental) | Deep reasoning         |


---

## Session Statuses


| Status         | Meaning                           |
| -------------- | --------------------------------- |
| `recording`    | Audio is being captured           |
| `transcribing` | Google STT running                |
| `generating`   | Gemini generating notes           |
| `uploading`    | Uploading to Notion               |
| `complete`     | All done                          |
| `error`        | Pipeline failed (retry available) |


---

## License

MIT