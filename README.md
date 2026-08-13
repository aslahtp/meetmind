![Electron.js](https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=Electron&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![FFmpeg](https://shields.io/badge/FFmpeg-%23171717.svg?logo=ffmpeg&style=for-the-badge&labelColor=171717&logoColor=5cb85c)
![Google Gemini](https://img.shields.io/badge/google%20gemini-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white)
![Notion](https://img.shields.io/badge/Notion-%23000000.svg?style=for-the-badge&logo=notion&logoColor=white)
![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)
![Google Chrome](https://img.shields.io/badge/Google%20Chrome-4285F4?style=for-the-badge&logo=GoogleChrome&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/github%20actions-%232671E5.svg?style=for-the-badge&logo=githubactions&logoColor=white)

# MeetMind

AI-powered meeting notes for Windows. Records system audio + microphone, transcribes with **Google Speech-to-Text (v1/v2)**, **AssemblyAI**, or **Sarvam AI**, generates structured notes or executive-grade Markdown with Gemini, and uploads to Notion — automatically triggered from Google Meet or Zoom via a Chrome extension.

---

## Features

- **Dual audio capture** — System audio (WASAPI loopback) + microphone (renderer capture with FFmpeg fallback)
- **Speaker diarization** — Google STT diarization, AssemblyAI speaker labels, or Sarvam AI diarization
- **Dual Note Output Modes (JSON / Markdown)** — Choose between structured JSON notes or executive-grade Markdown (Executive Summary, Discussion Points, Decisions, Action Items tables, Next Steps)
- **Native Notion sync** — Converts structured notes or raw Markdown into native Notion page blocks (tables, checklist tasks, sub-bullet trees, rich text formatting)
- **Chrome extension** — Floating overlay in Google Meet and Zoom with one-click recording and real-time status updates
- **Session history & smart retry** — SQLite-backed local storage of sessions, transcripts, and notes; reuses cached transcripts on processing retries to eliminate duplicate API calls
- **System tray / Single-instance** — Runs in the background and strictly prevents duplicate running instances or tray icons
- **Bilingual code-switching** — Full transcription and AI support for mixed English & Malayalam meetings (Sarvam AI **saaras:v3** codemix model)
- **Automated CI/CD Release Pipeline** — Automated GitHub Actions workflow builds, packages, and deploys Windows installers (`.exe`, `.blockmap`) and Chrome extension (`meetmind-extension.zip`) directly to GitHub Releases

---

## Architecture

```
Chrome Extension (MV3)
    ↕ WebSocket ws://localhost:39842
Electron Main Process
    ├── Renderer capture (loopback+mic) → webm → FFmpeg convert → WAV
    ├── (fallback) FFmpeg dshow/WASAPI  → WAV file
    ├── Google STT / AssemblyAI / Sarvam AI → transcript JSON (cached in SQLite)
    ├── Gemini API → JSON or Executive Assistant Markdown notes
    ├── Notion API → Native block tree parser (tables, checklists, rich text) → page URL
    └── SQLite → local session store (sql.js → `meetmind.db` in userData)
         ↕ IPC (contextBridge)
React Renderer (Vite + Tailwind CSS with CSS variable dark/light theming)
    ├── Dashboard, NoteViewer (JSON / Markdown support), TranscriptViewer, Settings
    
GitHub Actions CI/CD (.github/workflows/release.yml)
    ├── electron-builder → MeetMind Setup 1.x.x.exe + installer blockmap
    └── build-extension.js → meetmind-extension.zip → GitHub Release assets
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

Download FFmpeg for Windows from [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) (essentials build), then place executables in:

```bash
assets/ffmpeg/ffmpeg.exe
assets/ffmpeg/ffprobe.exe
```

### 3. Configure API keys [skip]

Copy `.env.example` to `.env` and fill in your keys (for reference only — keys are configured in the app's Settings screen at runtime).

### 4. Run in development

```bash
npm run dev
```

This automatically runs icon generation, packages the extension, starts the Vite dev server (port 5173), and launches Electron simultaneously.

### 5. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder (or extract `dist/meetmind-extension.zip`)

### 6. First run

The app will prompt you to enter your API keys in Settings. Fill in:

- Speech-to-Text provider (Google STT, AssemblyAI, or Sarvam AI)
- Google Cloud / AssemblyAI / Sarvam AI API Key
- Gemini API Key
- Note Output Mode (`JSON` or `Markdown`)
- Notion Integration Token & parent **Page ID or Database ID**

---

## API & Feature Setup

### Note Output Mode (JSON vs Markdown)

MeetMind supports two note generation modes in **Settings → Note Output Mode**:

- **JSON Mode** — Structured data rendered into dedicated UI cards (Action Items, Key Points, Decisions, Open Questions).
- **Markdown Mode** — Uses an Executive Assistant prompt structure to produce publication-ready prose notes (Executive Summary, Discussion Points, Action Items table, Decisions, Next Steps). Rendered with rich HTML tables, task checklists, and blockquote callouts, and uploaded to Notion as native Notion blocks.

### Google Cloud Speech-to-Text

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project and enable **Cloud Speech-to-Text API**
3. Go to **Credentials** → **Create credentials** → **API key**
4. Paste the key into MeetMind Settings

### Sarvam AI

Indian STT with native Malayalam–English code-switching. MeetMind uses the **saaras:v3** model in **codemix** mode with automatic language detection and speaker diarization.

1. Go to [dashboard.sarvam.ai](https://dashboard.sarvam.ai)
2. Generate an API key from the **API Keys** section
3. In MeetMind Settings, select **Sarvam AI** as the STT provider and paste your key

### Gemini API

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Create an API key and paste into MeetMind Settings
3. Select your preferred Gemini model (e.g. **Gemini 3.6 Flash**, **Gemini 3.5 Flash Lite**)

### Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new integration and copy the **Internal Integration Token**
3. Open your target Notion database or parent page → **⋯ menu** → **Connections** → add your integration
4. Copy the **Database ID** or **Page ID** from the URL
5. Paste both into MeetMind Settings

---

## Project Structure

```
meetmind/
├── .github/
│   ├── release_template.md     # Template for GitHub release notes automation
│   └── workflows/
│       └── release.yml         # GitHub Actions workflow for building & publishing releases
├── electron/
│   ├── main.js                 # Electron main process, IPC handlers, tray, single instance lock
│   ├── preload.js              # contextBridge API exposed to renderer
│   ├── websocket-server.js     # WebSocket bridge to Chrome extension (ws://localhost:39842)
│   ├── audio/
│   │   ├── recorder.js         # FFmpeg dual-track capture + device enumeration
│   │   ├── mixer.js            # FFmpeg filter graph construction
│   │   └── ffmpeg-path.js      # Dev/packaged FFmpeg path resolution
│   ├── services/
│   │   ├── transcription.js    # Google STT, AssemblyAI, and Sarvam AI transcription
│   │   ├── gemini.js           # Gemini LLM integration (JSON & Executive Markdown modes)
│   │   └── notion.js           # Notion API builder (JSON & native Markdown block parser)
│   ├── db/
│   │   └── sessions.js         # SQLite session store (sql.js persisted to disk)
│   └── utils/
│       ├── config.js           # electron-store schema & configuration
│       └── logger.js           # Structured file + console logger
├── renderer/
│   ├── index.html
│   ├── app.jsx                 # React root, routing, app context
│   ├── components/
│   │   ├── Dashboard.jsx       # Session list with sentiment badges & search
│   │   ├── NoteViewer.jsx      # Dual-mode viewer (Structured JSON cards & Executive Markdown)
│   │   ├── TranscriptViewer.jsx # Speaker transcript with search + copy
│   │   ├── RecordingBar.jsx    # Live timer + stop button
│   │   ├── Settings.jsx        # API keys, model selector, output mode toggle, setup guide
│   │   └── ProcessingOverlay.jsx # 3-stage animated progress overlay
│   └── styles/globals.css      # Tailwind + dark theme CSS variables
├── extension/
│   ├── manifest.json           # Chrome MV3 manifest
│   ├── background.js           # Tab detection, WebSocket, badge management
│   ├── content.js              # Overlay iframe injection into meeting pages
│   ├── popup.html / popup.js   # Extension action popup
│   └── overlay/                # Floating pill shell, scripts, and CSS
├── assets/
│   ├── ffmpeg/                 # Place ffmpeg.exe + ffprobe.exe here
│   └── icons/                  # App icons (icon.svg + generated PNG/ICO assets)
├── scripts/
│   ├── build-extension.js      # Cross-platform packaging script for Chrome extension zip
│   └── generate-icons.js       # SVG-to-PNG/ICO icon generation script
├── CHANGELOG.md                # Human-curated version changelog
├── package.json
├── vite.config.js
└── electron-builder.yml
```

---

## Available Scripts

| Script                   | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `npm run dev`            | Prebuilds icons/extension, then starts Electron + Vite dev server concurrently     |
| `npm run build`          | Build renderer, zip extension, and compile Windows NSIS installer                  |
| `npm run build:renderer` | Build renderer bundle only (Vite)                                                  |
| `npm run build:electron` | Package Electron application executable only                                       |
| `npm run build:dir`      | Build unpacked Windows binary directory                                            |
| `npm run build:ext`      | Package Chrome extension into `dist/meetmind-extension.zip` (`Extension/` root)    |
| `npm run generate-icons` | Generate PNG and ICO icons from `assets/icons/icon.svg`                            |

---

## Automated CI/CD & Releases

MeetMind features an automated release pipeline using **GitHub Actions** (`.github/workflows/release.yml`).

### Triggering a Release

1. Bump `version` in `package.json` and document changes in `CHANGELOG.md`.
2. Commit and push to `main` (or push a version tag like `v1.5.0`).
3. GitHub Actions automatically:
   - Sets up Node.js 20 and installs dependencies.
   - Builds the Vite renderer and cross-platform Chrome extension zip (`meetmind-extension.zip`).
   - Packages the Windows NSIS installer (`MeetMind Setup X.Y.Z.exe`) and blockmap (`.blockmap`).
   - Extracts release notes from `CHANGELOG.md` into `.github/release_template.md`.
   - Creates a new GitHub Release containing the `.exe`, `.blockmap`, and `.zip` binaries.

---

## Building Locally for Production

```bash
# 1. Ensure ffmpeg.exe is in assets/ffmpeg/
# 2. Ensure icon.ico is in assets/icons/
# 3. Build everything locally:
npm run build
```

Output files in `dist/`:

- `dist/desktop/MeetMind Setup 1.5.0.exe`
- `dist/meetmind-extension.zip` — packaged unpacked Chrome extension directory

> [!CAUTION]
> Ensure `dist/renderer/**` is included in `package.json` `build.files` before building. Otherwise, the installed app will open a blank window because the `dist` folder is in `.gitignore`. Note: Never commit downloaded FFmpeg `.exe` files, as they exceed GitHub's 100MB file size limit.

---

## Gemini Models

| Model ID                 | Label                         | Best for                       |
| ------------------------ | ----------------------------- | ------------------------------ |
| `gemini-3.6-flash`       | Gemini 3.6 Flash              | Recommended — latest Flash     |
| `gemini-3.5-flash-lite`  | Gemini 3.5 Flash Lite         | Fast, highly cost-effective    |
| `gemini-3.5-flash`       | Gemini 3.5 Flash              | Balanced quality and speed     |
| `gemini-3.1-flash-lite`  | Gemini 3.1 Flash Lite         | Lightweight summaries          |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (Experimental) | Long or complex meetings       |

---

## License

MIT
