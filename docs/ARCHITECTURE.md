# MeetMind Architecture

This document is a complete technical reference for the MeetMind codebase: process
architecture, data flow, persistence, third party integrations, packages, assets, build
pipeline, and CI/CD. It describes the system as implemented at version 3.6.2, not an
aspirational design. Where behavior is a deliberate tradeoff, the reasoning is included so
future changes do not accidentally regress it.

For UI visual language (colors, tokens, component patterns) see [`DESIGN.md`](../DESIGN.md).
For contributor commands and day to day workflow rules see [`AGENTS.md`](../AGENTS.md).

---

## 1. What MeetMind is

MeetMind is a free, MIT licensed, Windows only desktop app that turns online meetings into
written meeting notes. It:

1. Records system audio (via WASAPI loopback or a DirectShow fallback) and the microphone at
   the same time, on the user's own PC. Nothing joins the meeting as a bot or participant.
2. Sends the recording to a speech to text engine chosen by the user (AssemblyAI, Google Cloud
   Speech to Text v1/v2, or Sarvam AI) to get a speaker labeled transcript.
3. Sends the transcript to Google Gemini to produce structured meeting notes (executive
   summary, agenda, decisions, an action items table) as either structured JSON or Markdown.
4. Stores everything locally in a SQLite database (via `sql.js`), and optionally exports a PDF,
   copies Markdown, or syncs a formatted page to Notion.

Three build artifacts come out of this one repository:

| Artifact | Source | Purpose |
| --- | --- | --- |
| Electron desktop app | `electron/` (main process) + `renderer/` (React UI) | The app itself: recording, processing pipeline, notes UI, settings |
| Chrome MV3 extension | `extension/` | Bridges Google Meet / Zoom tabs to the desktop app: adds a record button and a floating overlay |
| Marketing site | `site/` | Static GitHub Pages site (`https://aslahtp.github.io/meetmind/`) |

### 1.1 High level data flow

```
 Google Meet / Zoom tab
        |
        | content script injects overlay, relays clicks
        v
 extension/background.js (MV3 service worker)
        |
        | WebSocket (ws://127.0.0.1:39842-39852), origin-checked
        v
 electron/websocket-server.js  <---------------------+
        |                                            |
        | START_RECORDING / STOP_RECORDING           | APP_STATUS,
        v                                            | RECORDING_STARTED,
 electron/main.js (recording state machine)          | PROCESSING_PROGRESS,
        |                                            | PROCESSING_COMPLETE
        | renderer capture (primary) or               |
        | ffmpeg dshow capture (fallback)             |
        v                                            |
 electron/audio/recorder.js -> .webm/.wav on disk     |
        |                                            |
        v                                            |
 runProcessingPipeline() in main.js  ------------------+
   Stage 1: electron/services/transcription.js  (Google STT / AssemblyAI / Sarvam)
   Stage 2: electron/services/gemini.js         (structured JSON or Markdown notes)
   Stage 3: electron/services/notion.js         (optional, if configured)
        |
        v
 electron/db/sessions.js (sql.js, persisted to meetmind.db)
        |
        v
 renderer/app.jsx (Dashboard, NoteViewer, TranscriptViewer, Settings, LogsViewer)
```

---

## 2. Repository layout

```
electron/        Main process, IPC handlers, recording state machine, all backend services
renderer/        React renderer (Vite), the app's UI
extension/       Chrome MV3 extension (background worker, content script, overlay, popup)
assets/          Icons (source + generated), FFmpeg placeholder dir, NSIS installer script
scripts/         Build/tooling scripts (icon generation, extension zipping, release notes, etc.)
tests/           Vitest suite (pure logic only, kept out of electron-builder's file set)
docs/            This file, GCS setup guide, known issues, new-features notes, brand assets, screenshots
site/            Static marketing site published to GitHub Pages
.github/         Workflows, reusable actions, CODEOWNERS, Dependabot config
electron-builder.yml   Packaging config for the Windows NSIS installer
vite.config.js         Renderer build config
vitest.config.mjs      Test runner config (separate root from vite.config.js)
eslint.config.mjs      Flat ESLint config, scoped per directory
pnpm-workspace.yaml    pnpm settings (hoisted node_modules, allowBuilds, minimumReleaseAge)
```

---

## 3. Electron process architecture

### 3.1 Main process (`electron/main.js`, ~1700 lines)

Owns:

- The `BrowserWindow` (frameless, custom titlebar controlled by renderer via `window:*` IPC),
  the tray icon, and `app.requestSingleInstanceLock()` to prevent duplicate windows/tray icons
  on relaunch (focuses the existing window on `second-instance` instead).
- Registration of the `meetmind://` custom protocol as the app's default protocol client, but
  **only when packaged** (`app.isPackaged`). Registering it from `pnpm run dev` would steal the
  handler and point "Open App" links at the raw `electron.exe`, breaking the flow after a real
  install.
- Registration of a second custom protocol, `meetmind-audio://`, as a privileged, streaming
  scheme (`protocol.registerSchemesAsPrivileged`, called before `app.whenReady()`). This is how
  the renderer's `<audio>` player streams a session's recording straight off disk, with HTTP
  Range support, without exposing a general file:// URL to the renderer. URL forms:
  `meetmind-audio://session/<sessionId>` (preferred) and a legacy
  `meetmind-audio://<sessionId>` form.
- Every `ipcMain.handle` channel (the full list is in section 3.2).
- The recording state machine (`isRecording` flag, start/stop orchestration, fallback capture
  path selection).
- `runProcessingPipeline()`: the three-stage transcribe -> notes -> Notion pipeline described in
  section 5.
- Top level crash guards: `process.on('uncaughtException'/'unhandledRejection')` log rather
  than crash the app, since a main-process crash takes the whole app down.

Recording is orchestrated from `main.js` but the actual capture mechanics live in
`electron/audio/recorder.js` and `electron/audio/mixer.js` (section 4).

Notion re-sync safety: `uploadSessionToNotion()` always creates the new Notion page **before**
deleting the old one, so a failed upload never destroys a working page; the previous page is
only moved to Notion's trash after the new one succeeds.

### 3.2 Preload (`electron/preload.js`)

Exposes a single `window.meetmind` object via `contextBridge.exposeInMainWorld`, with
`contextIsolation: true` and `nodeIntegration: false`. The renderer has no direct Node or
Electron API access; every capability is an explicit, named IPC round trip. The surface is
grouped by feature:

| Namespace | Channels | Purpose |
| --- | --- | --- |
| `window` | `window:minimize/maximize/close/isMaximized` | Custom titlebar controls (frameless window) |
| `shell` | `shell:open-external` | Open a URL in the system default browser |
| `logs` | `logs:get`, `logs:clear`, `logs:openFolder` | Backing store for the Logs viewer |
| `config` | `config:get`, `config:set`, `config:set-multiple` | Settings read/write |
| `recording` | `recording:start/stop`, `audio:list-devices`, `audio:probe-device`, `audio:import-file` | Recording control and device enumeration |
| `sessions` | `sessions:list`, `session:get/delete/update-notes/open-recording/create-from-transcript` | Session CRUD |
| `dialog` | `dialog:choose-folder` | Native folder picker |
| `pdf` | `pdf:export`, `pdf:reveal`, `pdf:default-dir` | PDF export |
| `notion` | `notion:upload`, `notion:test` | Notion sync and connection test |
| `models` | `models:list` | Available Gemini models |
| `gemini` | `gemini:default-system-prompt`, `gemini:default-md-system-prompt` | Default prompt text for Settings |
| `api` | `api:test-google`, `api:test-gemini`, `api:test-assemblyai`, `api:test-sarvam` | Settings-screen "Test connection" buttons |
| `processing` | `processing:run`, `processing:retry` | Manually (re)run the pipeline on a session |
| `capture` | `capture:start/stop` (main -> renderer), `capture:started/failed/chunk/audio-data` (renderer -> main) | Renderer-side system audio capture handshake |
| `calendar` | `calendar:auth/disconnect/events/status` | Google Calendar OAuth and event polling |
| `updater` | `updater:check/download/install/get-status` | Auto-update control |
| `app` | `app:version` | App version string |
| `ffmpeg` | `ffmpeg:check`, `ffmpeg:install`, `ffmpeg:onProgress` | FFmpeg presence check and runtime download |

Event subscriptions go through a single `on(channel, callback)` / `off(...)` pair with an
explicit allowlist of valid channel names (`recording:started`, `recording:stopped`,
`recording:error`, `transcription:progress`, `processing:progress`, `processing:complete`,
`processing:error`, `ws:extension-connected`, `ws:recording-requested`,
`sessions:durations-updated`, `updater:status`, `calendar:meeting-starting`,
`gemini:fallback-used`, `log:entry`) so the renderer cannot subscribe to an arbitrary IPC
channel.

Preload also injects the startup theme class (`light`/`dark`) onto `<html>` synchronously, by
reading a `--meetmind-theme=` argument that main passes via
`webPreferences.additionalArguments`. This is read from `process.argv` only, with no IPC round
trip, so it can never block or deadlock startup; a failure here just costs a brief flash of the
wrong theme, and is wrapped so it can never take down the actual `contextBridge` exposure above
it.

### 3.3 Renderer (`renderer/`)

React 18 + Vite 6, no router: `renderer/app.jsx` is a single view-state switch between:

- `Dashboard.jsx`: stats and a recent-sessions list.
- `Meetings.jsx`: full session list.
- `NoteViewer.jsx` / `TranscriptViewer.jsx`: a completed session's notes or raw transcript.
- `Settings.jsx`, composed of `settings/GeneralSection.jsx`, `TranscriptionSection.jsx`,
  `NotesSection.jsx`, `IntegrationsSection.jsx`, `SystemSection.jsx`: API keys, service
  selection, FFmpeg install flow, onboarding.
- `LogsViewer.jsx`: tails `electron/utils/logger.js` output live via the `log:entry` IPC event.

Supporting pieces: `RecordingBar.jsx` (persistent recording control), `ProcessingIndicator.jsx`
(pipeline progress), `SessionCard.jsx`, `UpcomingMeetings.jsx` (Google Calendar),
`PasteTranscriptModal.jsx` (manual transcript import), `note/` (Markdown rendering,
`copyMarkdown.js` for JSON<->Markdown conversion, `pdfDocument.jsx` for the PDF export
template, `AudioPlayer.jsx` streaming from `meetmind-audio://`), `ui/` (Dialog, ConfirmDialog).

State/plumbing: `lib/app-context.js`, `lib/hooks.js`, `lib/status.js`, `lib/format.js`,
`lib/platform.js`, `lib/scrollMemory.js`.

Styling: Tailwind CSS (`darkMode: 'class'`, with `<html class="dark">` toggled by preload/React
based on the `theme` setting) driven by CSS custom properties in `renderer/styles/globals.css`
(`--color-*` tokens), consumed via Tailwind arbitrary values, e.g.
`bg-[rgb(var(--color-background))]`, rather than hardcoded hex colors. Icons from
`lucide-react` plus a handful of hand-authored brand icon components
(`GeminiIcon`, `AssemblyAiIcon`, `SarvamIcon`, `NotionIcon`, `GoogleCloudIcon`,
`GoogleCalendarIcon`). Notes/transcript Markdown rendering uses `react-markdown` +
`remark-gfm`, shared between the in-app notes view and the PDF export document.

---

## 4. Audio capture pipeline

MeetMind has two independent capture paths, tried in order.

### 4.1 Primary path: renderer capture

The renderer captures system audio via Electron's display-media loopback API
(`getDisplayMedia`) and the microphone via the Web Audio API, in-process, then streams encoded
chunks to main over the `capture:chunk` IPC channel. Main appends each chunk to an
in-progress `.webm` file on disk as it arrives, so a crash mid-recording still leaves a usable
partial file. On stop, `convertWebmToWav()` (`electron/audio/recorder.js`, ffmpeg-backed)
produces the final `.wav` used by the transcription stage.

### 4.2 Fallback path: direct ffmpeg capture

If renderer capture fails to start, `handleStartRecording()` in `main.js` falls back to a direct
ffmpeg DirectShow (`dshow`) capture combining the microphone and system audio, using
`electron/audio/mixer.js`:

- **WASAPI loopback** (`WASAPI_LOOPBACK_ID`): captures whatever is currently playing through the
  Windows default output device (speakers, 3.5mm, USB, or Bluetooth headphones), without
  requiring "Stereo Mix" to be enabled. This is the recommended device and is tried first.
- **Stereo Mix / named dshow device**: a fallback for systems where WASAPI loopback capture is
  unsupported (`wasapiKnownUnsupported` is latched once detected, to avoid repeatedly retrying a
  mode known not to work on this machine).
- `buildAmixFilter(systemDevice, micDevice)` builds the ffmpeg `filter_complex` graph that mixes
  the two input streams; `parseDeviceList`, `detectDshowLoopback`, `detectMicrophone` handle
  device enumeration and classification.

### 4.3 FFmpeg resolution

`electron/audio/ffmpeg-path.js` resolves the ffmpeg/ffprobe binary path in this order: a bundled
copy under Electron's `extraResources` (production installs), then a locally committed copy at
`assets/ffmpeg/` (dev machines that downloaded it manually), then a runtime download via the
`ffmpeg:install` IPC handler, which fetches a build from
[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (the same builds as
[GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg) on GitHub). FFmpeg binaries are never
committed to git (they exceed GitHub's 100 MB file limit and CI's repo-hygiene job actively
rejects any `.exe`/`.dll`/`.msi` in the tree).

---

## 5. Processing pipeline

`runProcessingPipeline()` in `main.js` drives three stages in sequence. Progress is pushed to
the renderer via `processing:progress` and, via the WebSocket bridge, to the extension's overlay
(`PROCESSING_PROGRESS` / `PROCESSING_COMPLETE`) at each stage boundary. Each stage can be
independently retried through `processing:retry` if it fails (e.g. a transient network error on
Stage 1 does not force re-transcription to be repeated once Stage 2 later fails).

### 5.1 Stage 1: Transcription (`electron/services/transcription.js`, ~1080 lines)

The engine is selected by the `sttService` setting: `google` (default), `assemblyai`, or
`sarvam`.

**Google Cloud Speech-to-Text.** Two API versions are supported, both called from this file:

- **v1** (`speech:longrunningrecognize` / `speech:recognize`,
  `https://speech.googleapis.com/v1/...`): authenticated with a plain API key. Used as the
  fallback when no Google Cloud project ID is configured. Inline request body is limited to
  about 10 MB (roughly 160 seconds of 16 kHz mono 16-bit WAV), so longer audio is chunked into
  `CHUNK_DURATION_SECONDS = 55` second slices, each sent as its own `longrunningrecognize` call,
  polled via `v1/operations/<name>`.
- **v2** (`https://speech.googleapis.com/v2/...` for sync recognize, and a separate
  `STT_V2_ENDPOINT` for BatchRecognize): faster and uses the `chirp_3` model, but **does not
  support API-key authentication** at all; it requires a Bearer token from a service account.
  Two sub-modes:
  - **Sync recognize** (`projects.locations.recognizers.recognize`): 60 second limit per
    request, so also chunked at `CHUNK_DURATION_SECONDS`.
  - **BatchRecognize** (`projects.locations.recognizers:batchRecognize`): a single request for
    the whole recording with no chunking at all, but it only accepts `gs://` URIs, so the WAV
    must first be uploaded to a Google Cloud Storage bucket (`@google-cloud/storage`). This mode
    is used automatically when a GCS bucket is configured; see
    [`docs/GCS-SETUP.md`](GCS-SETUP.md) for the bucket/service-account setup guide. It requires
    write+delete access on the bucket for MeetMind, and read access for the Speech-to-Text
    service agent (same project is usually sufficient).

  Diarization output differs between versions and is normalized in a shared parser: v1 uses
  `startTime`/`endTime` and a numeric `speakerTag`; v2 uses `startOffset`/`endOffset` and a
  `speakerLabel`.

- **AssemblyAI** (`https://api.assemblyai.com/v2`): REST upload + polling, via the `assemblyai`
  npm SDK for the connection test (`GET /v2/account`) and REST calls for the actual transcription
  job, with built in speaker diarization.

- **Sarvam AI** (`https://api.sarvam.ai`): job-based flow (`sarvamPost`/`sarvamGet` helpers)
  against `/speech-to-text/job/v1/...`: create job (model `saaras:v3`) -> upload file -> start
  job -> poll status -> download result. `saaras:v3` is used specifically because meetings
  commonly mix English and Malayalam, and this model supports that code-switching
  automatically, without a language being pinned in advance. This is the only engine of the
  three built for that use case; Google STT and AssemblyAI are configured with a single
  `language` setting (default `ml-IN`).

### 5.2 Stage 2: Notes generation (`electron/services/gemini.js`, ~430 lines)

Uses the `@google/generative-ai` SDK against the Gemini API. Available models
(`AVAILABLE_MODELS`): `gemini-3.8-flash` (default), `gemini-3.7-flash`,
`gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`. A `DEPRECATED_GEMINI_MODELS` remap table in
`electron/utils/config.js` transparently migrates settings that still reference retired model
IDs (e.g. `gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-3-flash-preview`) forward to a current
model the first time config is read, so existing installs do not silently start failing after a
model is sunset.

Two output modes, controlled by `noteOutputMode`:

- **`json`** (default): Gemini is asked for structured JSON (executive summary, agenda, key
  decisions, an action items array with owner/deadline/priority per item, participants, notable
  mentions, and per-topic sections with options discussed / open questions). This structured
  form is what is rendered as cards in the Summary tab and is what the `copyMarkdown.js`
  converter round-trips to/from Markdown for editing.
- **`markdown`**: Gemini is asked to write executive-style Markdown directly (`DEFAULT_MD_SYSTEM_PROMPT`), and that Markdown is stored and rendered as-is, with no structured
  round trip.

A secondary model can be configured (`secondaryGeminiModel`) as an automatic fallback if the
primary model call fails, surfaced to the renderer via the `gemini:fallback-used` event so the
user knows a fallback model produced the notes they are reading.

### 5.3 Stage 3: Notion upload (`electron/services/notion.js`, ~730 lines, optional)

Only runs if a Notion integration token and a target page ID are both configured. Uses the
official `@notionhq/client` SDK. Notes are hand-converted into Notion blocks by a small custom
Markdown parser (`parseMarkdownRichText`) supporting bold, italic, strikethrough, inline code,
and links, rather than a generic Markdown-to-Notion library. Notion's API caps block-append
requests at 100 blocks, so uploads are chunked in batches of `NOTION_BLOCK_LIMIT = 100`.
Whether the transcript is included alongside the notes is controlled by
`notionUploadTranscript` (default on).

---

## 6. Persistence

### 6.1 Sessions database (`electron/db/sessions.js`)

Uses `sql.js` (SQLite compiled to WebAssembly), held entirely in memory while the app runs, and
rewritten to a single file, `<userData>/meetmind.db`, on every mutation (`db.export()` to a
`Buffer`, written with `fs.writeFileSync`). There is no migration system: the schema is defined
with `CREATE TABLE IF NOT EXISTS`, so schema evolution has so far meant additive columns only.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT 'Untitled Meeting',
  meeting_url       TEXT,
  started_at        DATETIME,
  ended_at          DATETIME,
  duration_seconds  INTEGER,
  audio_path        TEXT,
  transcript        TEXT,   -- JSON-serialized array
  notes             TEXT,   -- JSON-serialized object, or Markdown string in `markdown` mode
  notion_page_url   TEXT,
  status            TEXT NOT NULL DEFAULT 'recording'
)
```

Indexes on `started_at DESC` and `status`. `markStaleRecordingSessionsAsError()` runs at
startup and flips any session still marked `recording` after more than 2 hours (e.g. the app
crashed mid-recording, or stop failed) to `error`, so the Dashboard never shows a phantom
in-progress recording indefinitely.

### 6.2 Settings (`electron/utils/config.js`)

Wraps `electron-store` (itself backed by a JSON file in `userData`) with a typed schema covering:
API keys (`googleApiKey`, `geminiApiKey`, `assemblyAiApiKey`, `sarvamApiKey`, Notion, Google
Calendar OAuth client), service selection (`sttService`, `selectedModel`/`geminiModel`,
`secondaryGeminiModel`), audio device selection, diarization parameters
(`enableDiarization`, `minSpeakers`, `maxSpeakers`), output preferences (`noteOutputMode`,
`language`, custom `geminiSystemPrompt`), UI preferences (`theme`, `autoLaunch`,
`hideLogsInSidebar`, `pinNotesViewToggle`, `dashboardRecentLimit`), update behavior
(`autoCheckUpdates`), PDF export (`pdfExportDir`, `pdfIncludeTranscript`), and the WebSocket
port (`websocketPort`, default `39842`).

Several settings keys have deliberate aliases kept in sync on write (`setConfig`), for backward
compatibility with older releases' field names: `notionToken`/`notionApiKey`,
`notionDatabaseId`/`notionPageId`, `geminiModel`/`selectedModel`,
`systemPrompt`/`geminiSystemPrompt`, `promptOutputMode`/`noteOutputMode`.

---

## 7. Desktop <-> extension bridge

### 7.1 WebSocket server (`electron/websocket-server.js`)

A plain Node `http` server plus a `ws` `WebSocketServer` attached to it, bound to
`127.0.0.1` only. On startup it scans ports `39842` through `39852` (`PORT_RANGE = 11`,
starting from the configured `websocketPort`) until it finds a free one, so a second app
instance, or a port collision with another local tool, does not prevent the bridge from coming
up.

Security: incoming WebSocket connections are checked against their `Origin` header and rejected
(WebSocket close code `4001`) unless it starts with `chrome-extension://`. This is the only
access control on the bridge; it relies on the browser enforcing that origin header honestly for
extension-initiated connections, and on the server being loopback-only so it is not reachable
from other machines on the network.

Two plain HTTP endpoints exist alongside the WebSocket upgrade, for cases where the extension
needs to reach the app without an open socket:

- `GET /health`: returns `{ ok: true, app: 'MeetMind' }`, used by the extension to detect
  whether the desktop app is running at all.
- `GET /open`: raises/focuses the main window, used by the "Open App" affordance.

Message protocol (JSON over the WebSocket):

| Direction | Type | Payload | Meaning |
| --- | --- | --- | --- |
| extension -> app | `START_RECORDING` | `meetingUrl`, `meetingTitle` | Extension's record button was clicked |
| extension -> app | `STOP_RECORDING` | - | Extension's stop button was clicked |
| extension -> app | `APP_STATUS` | - | Heartbeat (extension polls this roughly every 10s); logged at debug level only, to avoid flooding the log |
| extension -> app | `SHOW_WINDOW` | - | Raise the app window |
| app -> extension | `APP_STATUS` | `recording`, `sessionId` | Sent on connect and in reply to a heartbeat |
| app -> extension | (broadcast) | pipeline progress/completion events | Relayed to the floating overlay |

### 7.2 Extension (`extension/`)

Manifest V3. Permissions: `tabs`, `activeTab`, `storage`, `scripting`. Host permissions:
`https://meet.google.com/*`, `https://*.zoom.us/*`, `http://127.0.0.1/*` (needed to reach the
loopback WebSocket/HTTP server from the service worker and content script).

- `background.js` (service worker): probes the same port range as the main process to find the
  running app, opens the WebSocket, sends `START_RECORDING`/`STOP_RECORDING`/`APP_STATUS`, and
  relays `RECORDING_STARTED`/`PROCESSING_PROGRESS`/`PROCESSING_COMPLETE` broadcasts onward to
  whichever tab has the overlay open.
- `content.js`: injected into Meet (`https://meet.google.com/*`) and Zoom's web client
  (`https://*.zoom.us/wc/*`, `https://*.zoom.us/j/*`) at `document_idle`. Injects the floating
  overlay UI.
- `overlay/` (`overlay.html`/`.css`/`.js`): the floating record button and progress overlay,
  served as a `web_accessible_resource` (along with its font and icons) so it can be embedded
  into the Meet/Zoom page's own DOM context.
- `popup.html`/`popup.js`: the toolbar popup shown when the extension icon is clicked.
- `open-app.html`/`open-app.js`: a small page used to hand off to the `meetmind://` protocol or
  the `/open` HTTP endpoint when the desktop app needs to be brought to the foreground from a
  context the content script cannot reach directly.

The extension is built from source, not committed as a zip: `scripts/build-extension.js` zips
`extension/` into `dist/meetmind-extension.zip`, run via `pnpm run build:ext`, and as part of
`predev`/`prebuild` so it is always in sync with the current source.

---

## 8. Google Calendar integration (`electron/services/google-calendar.js`)

Optional. Uses `googleapis`' OAuth2 client with a user-supplied OAuth client ID/secret (the user
creates their own Google Cloud OAuth client, since MeetMind ships no client secret of its own).
Scopes are read-only: `calendar.readonly` and `userinfo.email`.

The OAuth redirect is handled by a short-lived local HTTP server bound to a loopback port in the
range `39880`-`39890` (separate from the WebSocket bridge's port range), which Google redirects
back to after consent; the resulting code is exchanged for tokens and the server is torn down.

Once connected, `startEventPoller()` polls upcoming events on an interval, cached for
`CACHE_TTL_MS = 2 minutes`, with concurrent fetches for the same window collapsed into a single
in-flight request (`inflightFetches`) rather than each caller hitting the API independently. When
a calendar event is about to start, the app surfaces a `calendar:meeting-starting` event so the
renderer can prompt the user to start recording. If Google rejects the stored refresh token
(revoked or expired), that token is remembered as rejected and calls fail fast locally for 24
hours (`AUTH_RETRY_INTERVAL_MS`) instead of repeatedly hitting Google with a token known to be
bad; reconnecting with a fresh token, or disconnecting, clears that state immediately.

---

## 9. Auto update (`electron/services/updater.js`)

Uses `electron-updater` against the `github` publish provider configured in
`electron-builder.yml` (owner `aslahtp`, repo `meetmind`, release type `release`). Background
checks run every `BACKGROUND_CHECK_INTERVAL_MS = 4 hours` while `autoCheckUpdates` is enabled,
and pause after `MAX_CONSECUTIVE_FAILURES = 3` consecutive failures in a row (so a persistent
network problem does not retry forever in the background); state
(`idle`/`checking`/`available`/`not-available`/`downloading`/`downloaded`/`error`, download
progress, last check time, error message, and failure count) is exposed to the renderer via
`updater:get-status` and pushed live over the `updater:status` event.

After an update installs, a post-update check verifies FFmpeg is still present and correctly
resolvable (since `assets/ffmpeg/` is excluded from the packaged app's files and only ships via
`extraResources`), so a broken FFmpeg path after an upgrade is caught and surfaced rather than
silently breaking the next recording.

---

## 10. PDF export

The renderer builds a self-contained HTML document
(`renderer/components/note/pdfDocument.jsx`, loaded on demand), reusing the same
`react-markdown` + `remark-gfm` rendering pipeline as the in-app notes view so the PDF matches
what the user sees on screen. `pdf:export` in `main.js` hands that HTML to
`electron/services/pdf-export.js`, which prints it via a hidden, sandboxed `BrowserWindow` to a
file named `YYYY-MM-DD-HHmm-Title.pdf`. Output goes to `config.pdfExportDir`, or the Windows
Downloads folder when that setting is empty, and an existing file at that name is never
overwritten (a fresh timestamp/name is used instead). Whether the transcript is appended to the
PDF is controlled by `pdfIncludeTranscript` (default off).

---

## 11. Third-party APIs and services

| Service | Used for | Auth | Called from |
| --- | --- | --- | --- |
| Google Cloud Speech-to-Text v1 | Transcription (fallback, no project ID configured) | API key | `electron/services/transcription.js` |
| Google Cloud Speech-to-Text v2 | Transcription (`chirp_3` sync, or BatchRecognize for long audio) | Service account Bearer token (no API-key auth) | `electron/services/transcription.js` |
| Google Cloud Storage | Staging WAV files for v2 BatchRecognize | Service account key file | `electron/services/transcription.js` (`@google-cloud/storage`) |
| Google Gemini API | Meeting notes generation (Stage 2) | API key | `electron/services/gemini.js` (`@google/generative-ai`) |
| AssemblyAI | Transcription (alternative engine) | API key | `electron/services/transcription.js` (`assemblyai` SDK + REST) |
| Sarvam AI | Transcription, `saaras:v3` model for English/Malayalam code-switching | API key | `electron/services/transcription.js` (REST) |
| Notion API | Optional notes sync (Stage 3) | Internal integration token | `electron/services/notion.js` (`@notionhq/client`) |
| Google Calendar API | Optional upcoming-meeting reminders | OAuth2 (user-supplied client ID/secret) | `electron/services/google-calendar.js` (`googleapis`) |
| GitHub Releases | Auto-update distribution | none (public releases) | `electron-updater`, configured in `electron-builder.yml` |
| gyan.dev / GyanD/codexffmpeg | FFmpeg binary distribution | none | `ffmpeg:install` IPC handler; pinned + SHA-256 verified in `release.yml` for the bundled build |

All of the above except GitHub Releases and FFmpeg distribution are bring-your-own-credentials:
MeetMind ships no API keys or secrets of its own. Every key lives in the user's local
`electron-store` settings file, in plaintext (there is no OS keychain integration or at-rest
encryption of these values; see section 14).

---

## 12. Package inventory

From `package.json` (pnpm, Node 22.12+, Windows only).

### 12.1 Runtime dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| `@google-cloud/storage` | ^7.22.0 | GCS upload for Speech-to-Text v2 BatchRecognize |
| `@google/generative-ai` | ^0.21.0 | Gemini API client (notes generation) |
| `@notionhq/client` | ^2.3.0 | Notion API client (Stage 3 upload) |
| `assemblyai` | ^4.41.2 | AssemblyAI SDK (transcription engine + connection test) |
| `electron-store` | ^8.2.0 | Persisted settings (JSON-backed key/value store) |
| `electron-updater` | ^6.8.9 | Auto-update via GitHub Releases |
| `fluent-ffmpeg` | ^2.1.3 | ffmpeg process control (audio capture and conversion) |
| `googleapis` | ^176.0.0 | Google Calendar OAuth2 + Calendar API client |
| `lucide-react` | ^1.48.0 | Renderer icon set |
| `react-markdown` | ^10.1.0 | Notes/transcript Markdown rendering (in-app and PDF) |
| `remark-gfm` | ^4.0.1 | GitHub-flavored Markdown extensions (tables, task lists) for `react-markdown` |
| `sql.js` | ^1.14.2 | SQLite compiled to WASM, backs the sessions database |
| `uuid` | ^10.0.0 | Session ID generation |
| `ws` | ^8.21.3 | WebSocket server for the desktop <-> extension bridge |

### 12.2 Dev dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| `electron` | ^33.4.11 | Runtime (pinned exact version also set in `electron-builder.yml`) |
| `electron-builder` | ^25.1.8 | Packaging the Windows NSIS installer |
| `react`, `react-dom` | ^18.3.1 | Renderer UI framework |
| `vite`, `@vitejs/plugin-react` | ^6.4.3 / ^4.7.0 | Renderer dev server and build |
| `vitest` | ^5.0.1 | Test runner (`tests/**/*.test.{js,jsx}`, Node environment) |
| `tailwindcss`, `autoprefixer`, `postcss`, `@tailwindcss/typography` | | Styling pipeline |
| `eslint`, `@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals` | | Linting (flat config, scoped per directory: `electron/`, `renderer/`, `extension/`, `scripts/`, `tests/`) |
| `concurrently` | ^9.2.4 | Runs Vite + Electron together in `pnpm run dev` |
| `cross-env` | ^7.0.3 | Cross-platform env var setting in npm scripts |
| `sharp` | ^0.35.4 | Icon raster generation (`generate-icons.js`) |
| `png-to-ico` | ^3.0.2 | `.ico` generation for the Windows installer/app icon |
| `rcedit` | ^5.0.2 | Editing the packaged `.exe`'s resources (icon, version info) |

pnpm specifics: `pnpm-workspace.yaml` sets `nodeLinker: hoisted` so electron-builder sees a flat
`node_modules` tree, and `allowBuilds` lists dependencies permitted to run install scripts
(extend with `pnpm approve-builds <pkg>`). `verifyDepsBeforeRun: warn` stops `pnpm run` from
silently reinstalling after `package.json` changes without an explicit `pnpm install`, because
that reinstall replaces `node_modules/electron` out from under a currently-running app.
`minimumReleaseAge: 1440` is a supply-chain guard: pnpm refuses to install a package version
published less than 24 hours ago (Dependabot has its own separate 7-day cooldown in
`.github/dependabot.yml`); this setting is not to be removed, only temporarily excepted via
`minimumReleaseAgeExclude` for an urgent security fix.

---

## 13. Assets and branding

| Path | Contents |
| --- | --- |
| `assets/icons/` | Source SVG/PNG icon plus every generated resolution (16 through 512px) and the Windows `.ico`, regenerated by `pnpm run generate-icons` (`scripts/generate-icons.js`, via `sharp` + `png-to-ico`); also holds third-party service icons (Google Calendar, Google Meet, Notion) used in the UI, and an `icons/services` subfolder |
| `assets/ffmpeg/` | Empty at rest (only a `README.md`); ffmpeg.exe/ffprobe.exe are never committed (over GitHub's 100 MB limit and actively rejected by CI's repo-hygiene check) and are either placed here manually for local dev or downloaded at runtime/build time |
| `assets/installer.nsh` | Custom NSIS installer script logic (referenced by `electron-builder.yml`'s `nsis.include`) |
| `renderer/assets/fonts/` and `extension/fonts/` | `DMSans-Variable.woff2` (OFL licensed, see accompanying `OFL.txt`), used identically in the app UI and the injected extension overlay so both match the design system in `DESIGN.md` |
| `docs/brand/` | Wordmark images (light/dark) used in `README.md` |
| `docs/screenshots/` | App screenshots (light/dark) used in `README.md` |
| `site/` | Static marketing site: `index.html`, `og.html` (Open Graph preview), `sitemap.xml`, and a Google Search Console verification file, published to GitHub Pages by `.github/workflows/pages.yml` |

---

## 14. Security model

- **Renderer isolation**: `contextIsolation: true`, `nodeIntegration: false`. The renderer's
  only access to the OS/Node is the explicit, allowlisted `window.meetmind` surface described in
  section 3.2.
- **Local network bridge**: the WebSocket server binds to `127.0.0.1` only and accepts
  connections solely from a `chrome-extension://` origin. There is no additional
  authentication token exchanged, so any locally running process capable of spoofing that
  origin header (in practice, only the extension's own runtime does this reliably) is trusted;
  this is an accepted tradeoff for a purely local, single-user bridge.
- **API keys and OAuth tokens at rest**: stored via `electron-store` in a JSON file under the
  OS user profile, in plaintext. There is no OS keychain (Windows Credential Manager) integration
  and no additional at-rest encryption layer. This is a known limitation, not a hidden one:
  anyone with file-system access to the user's profile can read these values.
- **Custom protocols**: `meetmind://` is only registered as the default handler when the app is
  packaged, to avoid a dev build silently hijacking the protocol from the installed app.
  `meetmind-audio://` is scoped to session IDs resolved server-side against the sessions
  database; it does not accept an arbitrary file path from the renderer.
- **Supply chain (CI/CD)**: every third-party GitHub Action is pinned to a full 40-character
  commit SHA (never a tag or branch), with `permissions: contents: read` at the top of every
  workflow and elevated permissions granted only per-job with a comment explaining why. Workflows
  trigger on `pull_request` (never `pull_request_target` or `workflow_run` against PR code), so
  fork PRs run CI with a read-only token and no secrets. `${{ }}` expressions from event data
  (PR titles, branch names, labels) are never interpolated directly into `run:` scripts; they go
  through `env:` instead. Binaries a workflow downloads (gitleaks, the bundled FFmpeg build) are
  checksum-verified. See `.github/workflows/*.yml` and the "CI/CD" section of `AGENTS.md` for the
  full ruleset.
- **Dependency hygiene**: `pnpm audit --prod --audit-level high` runs in CI; Dependabot opens
  grouped weekly minor/patch PRs and monthly action updates, each with a 7-day cooldown on top of
  pnpm's own 24-hour `minimumReleaseAge`; `.github/CODEOWNERS` requires maintainer review on
  workflow, dependency, build, and updater files specifically.

---

## 15. Build and packaging

- **Renderer**: Vite (`vite.config.js`, `root: 'renderer'`) builds to `dist/renderer/`. The app
  version is injected into the renderer bundle at build time as a `__APP_VERSION__` global,
  read straight from `package.json` so the UI's displayed version can never drift from the
  packaged app's actual version.
- **Extension**: `scripts/build-extension.js` zips `extension/` into
  `dist/meetmind-extension.zip` (`pnpm run build:ext`).
- **Electron packaging** (`electron-builder.yml`): `appId: com.meetmind.app`, Windows NSIS
  installer (`x64` only), `signAndEditExecutable: false` (unsigned), custom installer/uninstaller
  icons, desktop and start-menu shortcuts created, an `afterPack` hook
  (`scripts/after-pack.js`), and the `meetmind://` protocol association declared via `protocols`.
  FFmpeg is pulled in as `extraResources` (`assets/ffmpeg/` -> `ffmpeg/` in the packaged app),
  explicitly excluded from the `asar` archive's `files` list (`!assets/ffmpeg/**`) since ffmpeg
  needs to run as a native subprocess, not live inside the packed archive. `electronVersion` is
  pinned to the exact same version as the `electron` devDependency, so electron-builder never
  silently packages a mismatched runtime.
- **Build must include `dist/renderer/**` in `build.files`**; since `dist/` is gitignored,
  omitting this would ship an installer whose window is blank (a documented, previously-hit
  failure mode, called out explicitly in `AGENTS.md`'s "Learned Workspace Facts").
- **Production build** (`pnpm run build`) requires `assets/ffmpeg/ffmpeg.exe`,
  `assets/ffmpeg/ffprobe.exe`, and `assets/icons/icon.ico` to already exist locally (none of
  these are committed); developers get FFmpeg from the app's own Settings screen download flow
  or directly from gyan.dev.
- **`pnpm run build:dir`**: production renderer build + an unpacked Electron app under
  `dist/desktop/`, for fast local iteration without building the full installer.

---

## 16. CI/CD (`.github/workflows/`)

All workflows share `.github/actions/setup` (pnpm from the `packageManager` field, Node 24,
`pnpm install --frozen-lockfile`).

- **`ci.yml`**: runs on every PR against `main` and every push to `main`; also a reusable
  workflow (`workflow_call`) invoked by `release.yml` as a required gate. Jobs: lint
  (`pnpm run lint`), test (`pnpm run test`), build the renderer and the extension, a repo-hygiene
  job (rejects a committed npm/yarn lockfile, committed `.exe`/`.dll`/`.msi`, a real `.env` file,
  or any file over 10 MB), a gitleaks secret scan (checksum-verified download) over the full git
  history, `pnpm audit --prod --audit-level high`, and a zizmor audit of the workflows
  themselves.
- **`release.yml`**: triggers on a push to `main` that touches `package.json` (i.e. a version
  bump). Calls `ci.yml` as a gate first. The `build` job then builds the Windows installer with a
  read-only token and no dependency cache, bundling FFmpeg at a pinned version
  (`FFMPEG_VERSION`) checked against a pinned SHA-256 (`FFMPEG_SHA256`), from the same builds
  gyan.dev serves (GyanD/codexffmpeg releases). A separate `publish` job, the only one granted
  `contents: write`, runs no dependency code and no third-party actions, and creates the GitHub
  release using the runner's own `gh` CLI. `pnpm run build` is always invoked with
  `--publish never`, so electron-builder itself never needs a publish token.
- **`pr-checks.yml`**: PR-only. Enforces that any PR changing code also bumps `package.json`'s
  `version` and adds a matching `## [X.Y.Z] - YYYY-MM-DD` heading to `CHANGELOG.md` (docs and
  `.github/` changes are exempt; a `skip-version-check` label overrides it for the rest). Also
  runs a dependency-review check that fails a PR adding a runtime dependency with a
  high-severity advisory.
- **`codeql.yml`**: CodeQL security analysis on PRs, pushes to `main`, and weekly on a schedule.
- **`pages.yml`**: publishes `site/` to GitHub Pages.
- **`.github/dependabot.yml`**: grouped weekly minor/patch dependency update PRs and monthly
  GitHub Actions updates, each with a 7-day cooldown.
- **`.github/CODEOWNERS`**: requires maintainer review specifically for workflow files,
  dependency manifests, build config, and the auto-updater code.

---

## 17. Testing

`pnpm run test` runs Vitest (`vitest.config.mjs`, Node environment) over `tests/**/*.test.{js,jsx}`. Tests live in a separate `tests/` directory rather than beside the code they cover, specifically so electron-builder's packaged `files` list (which does not reference `tests/`)
never ships them in the installed app.

Current coverage is pure logic only:

| Test file | Covers |
| --- | --- |
| `tests/copyMarkdown.test.js` | Notes JSON <-> Markdown round-tripping (`renderer/components/note/copyMarkdown.js`) |
| `tests/format.test.js` | Formatting helpers (`renderer/lib/format.js`) |
| `tests/markdown.test.jsx` | Markdown rendering (`renderer/components/note/markdown.jsx`) |
| `tests/pdf-export.test.js` | PDF file naming (`electron/services/pdf-export.js`) |

This suite does **not** cover the UI, IPC handlers, the recording state machine, or any of the
third-party API integrations. Per `AGENTS.md`, UI and main-process changes must additionally be
verified by running the app (`pnpm run dev`) and exercising the affected flow directly; passing
tests confirm the covered logic is correct, not that a given feature actually works end to end.

---

## 18. Known limitations

Tracked in detail in [`docs/KNOWN_ISSUES.md`](KNOWN_ISSUES.md); at the time of writing this
includes a Markdown round-trip bug where a fenced code block inside a list-based notes section
(Action Items, Participants, Notable Mentions, or a topic's Options Discussed/Open Questions)
gets flattened into extra list items on save, because the list-line parser in
`copyMarkdown.js` does not track code-fence state independently of the section splitter that
does track it.

Structural limitations, by design rather than oversight:

- **Windows only.** The audio capture path (WASAPI loopback, DirectShow fallback) and the
  installer are Windows-specific; there is no macOS or Linux build target.
- **No database migrations.** `sessions` table changes have so far been additive
  (`CREATE TABLE IF NOT EXISTS` plus new nullable columns); a genuinely breaking schema change
  would need a migration strategy that does not exist yet.
