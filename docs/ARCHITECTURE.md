# MeetMind Architecture

This document is a complete technical reference for the MeetMind codebase: process
architecture, data flow, persistence, third party integrations, packages, assets, build
pipeline, and CI/CD. It describes the system as implemented at version 4.6.0, not an
aspirational design. Where behavior is a deliberate tradeoff, the reasoning is included so
future changes do not accidentally regress it.

For UI visual language (colors, tokens, component patterns) see [`DESIGN.md`](../DESIGN.md).
For contributor commands and day to day workflow rules see [`AGENTS.md`](../AGENTS.md).

---

## 1. What MeetMind is

MeetMind is a free, MIT licensed desktop app for Windows 10/11 and (as a beta) macOS 14.2+ that
turns online meetings into written meeting notes. It:

1. Records system audio (Windows: WASAPI loopback, or a DirectShow fallback; macOS: the CoreAudio
   Tap API) and the microphone at the same time, on the user's own computer. Nothing joins the
   meeting as a bot or participant.
2. Sends the recording to a speech to text engine chosen by the user (AssemblyAI, Google Cloud
   Speech to Text v1/v2, Sarvam AI, or Groq Whisper) to get a speaker labeled transcript.
3. Sends the transcript to the user's chosen LLM (Google Gemini, Groq or Anthropic Claude, with an optional cross-provider fallback) to produce structured meeting notes (executive
   summary, agenda, decisions, an action items table) as either structured JSON or Markdown.
4. Stores everything locally in a SQLite database (via `sql.js`), and optionally exports a PDF,
   copies Markdown, or syncs a formatted page to Notion.

Three build artifacts come out of this one repository:

| Artifact | Source | Purpose |
| --- | --- | --- |
| Electron desktop app | `electron/` (main process) + `renderer/` (React UI) | The app itself: recording, processing pipeline, notes UI, settings |
| Chrome MV3 extension | `extension/` | Optional. Bridges Google Meet / Zoom tabs to the desktop app: adds a record button and an in-tab overlay. The desktop app detects meetings on its own (section 3.4) |
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
        | ffmpeg dshow capture (Windows fallback)     |
        v                                            |
 electron/audio/recorder.js -> .webm/.wav on disk     |
        |                                            |
        v                                            |
 runProcessingPipeline() in main.js  ------------------+
   Stage 1: electron/services/transcription.js  -> electron/providers/stt/* (Google / AssemblyAI / Sarvam / Groq)
   Stage 2: electron/services/notes.js          -> electron/providers/llm/* (Gemini / Groq / Claude; JSON or Markdown notes)
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
assets/          Icons (source + generated), FFmpeg placeholder dir, NSIS installer script, macOS entitlements
scripts/         Build/tooling scripts (icon generation, extension zipping, release notes, etc.)
tests/           Vitest suite (pure logic only, kept out of electron-builder's file set)
docs/            This file, GCS setup guide, known issues, new-features notes, brand assets, screenshots
site/            Static marketing site published to GitHub Pages
.github/         Workflows, reusable actions, CODEOWNERS, Dependabot config
electron-builder.yml   Packaging config: Windows NSIS installer, macOS DMGs + update zips
vite.config.js         Renderer build config
vitest.config.mjs      Test runner config (separate root from vite.config.js)
eslint.config.mjs      Flat ESLint config, scoped per directory
pnpm-workspace.yaml    pnpm settings (hoisted node_modules, supportedArchitectures, allowBuilds, minimumReleaseAge)
```

---

## 3. Electron process architecture

### 3.1 Main process (`electron/main.js`, ~1700 lines)

Owns:

- The `BrowserWindow` (custom titlebar in the renderer: frameless on Windows, with the window
  buttons drawn by the renderer and driven by `window:*` IPC; on macOS `titleBarStyle:
  'hiddenInset'` keeps the native traffic lights inset into the renderer's top bar, which leaves
  room for them and hides its own buttons), the tray icon (a monochrome `trayTemplate.png` in the
  macOS menu bar), the macOS application menu (`createAppMenu()`: About, Settings… ⌘, which sends
  `app:navigate`, Hide/Quit, Edit and Window menus), and `app.requestSingleInstanceLock()` to
  prevent duplicate windows/tray icons on relaunch (focuses the existing window on
  `second-instance` instead). Closing the window only hides it on both platforms.
- Launch at login (`autoLaunch`, `electron/services/auto-launch.js`). On Windows the
  `HKCU\…\CurrentVersion\Run` entry is named `MeetMind` and passes `--hidden`, so a login launch
  creates the window without showing it and the app starts in the tray, with meeting detection
  running. Electron's `getLoginItemSettings().openAtLogin` only looks for a value named after the
  AppUserModelId, never a custom name, so the state is read from `launchItems` (the entries that
  start this exe, with whether Task Manager has disabled them). At startup, once the entry
  exists Windows is the source of truth: a disabled entry stays disabled and the stored setting
  follows it; with no entry the stored setting decides. Leftover entries for this exe under other
  names are removed. Only the packaged app writes an entry (an unpackaged run would point it at the
  bare dev electron binary). macOS keeps plain `openAtLogin`.
- Registration of the `meetmind://` custom protocol as the app's default protocol client, but
  **only when packaged** (`app.isPackaged`). Registering it from `pnpm run dev` would steal the
  handler and point "Open App" links at the raw `electron.exe`, breaking the flow after a real
  install. Windows delivers links in `argv` (`second-instance`, or `process.argv` on a cold
  start); macOS delivers them through `open-url`, registered before `ready` so the link that
  launched the app isn't lost, and gets the scheme from electron-builder's `protocols`.
- `--smoke` (checked on the first line of `main.js`, before anything else loads): hands over to
  `electron/smoke.js`, a headless self-test of the packaged app run by CI (section 16).
- Registration of a second custom protocol, `meetmind-audio://`, as a privileged, streaming
  scheme (`protocol.registerSchemesAsPrivileged`, called before `app.whenReady()`). This is how
  the renderer's `<audio>` player streams a session's recording straight off disk, with HTTP
  Range support, without exposing a general file:// URL to the renderer. URL forms:
  `meetmind-audio://session/<sessionId>` (preferred) and a legacy
  `meetmind-audio://<sessionId>` form.
- Every `ipcMain.handle` channel (the full list is in section 3.2).
- Native meeting detection and the floating meeting overlay window (section 3.4): one
  `overlayState` object, updated by `broadcastStatus()` alongside every status message sent to
  the extension.
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
| `platform` | (value, not a channel) | `process.platform`, read by the renderer through `renderer/lib/os.js` (`isMac`, `isWindows`) |
| `window` | `window:minimize/maximize/close/isMaximized` | Custom titlebar controls (frameless window; Windows only, macOS uses its traffic lights) |
| `shell` | `shell:open-external` | Open a URL in the system default browser |
| `logs` | `logs:get`, `logs:clear`, `logs:openFolder` | Backing store for the Logs viewer |
| `config` | `config:get`, `config:set`, `config:set-multiple` | Settings read/write |
| `recording` | `recording:start/stop`, `audio:list-devices`, `audio:probe-device`, `audio:import-file` | Recording control and device enumeration (FFmpeg devices are Windows-only; macOS returns an error) |
| `sessions` | `sessions:list`, `session:get/delete/update-notes/rename/open-recording/create-from-transcript` | Session CRUD; `rename` sets the title, the notes title and `meeting_title` |
| `dialog` | `dialog:choose-folder` | Native folder picker |
| `pdf` | `pdf:export`, `pdf:reveal`, `pdf:default-dir` | PDF export |
| `notion` | `notion:upload`, `notion:test` | Notion sync and connection test |
| `providers` | `providers:list`, `providers:test` | Provider descriptors (models, credential fields, guides) and generic connection test |
| `gemini` | `gemini:default-system-prompt`, `gemini:default-md-system-prompt` | Default prompt text for Settings |
| `processing` | `processing:run`, `processing:retry` | Manually (re)run the pipeline on a session |
| `capture` | `capture:start/stop` (main -> renderer), `capture:started/failed/chunk/audio-data` (renderer -> main; `capture:started` carries `{ systemAudio, mic }`), `capture:test-begin/test-end` (invoke) | Renderer-side system audio capture handshake; the test pair switches the macOS capture strategy for Settings' "Test system audio" |
| `permissions` | `permissions:status`, `permissions:request`, `permissions:open-settings` | macOS microphone and Screen & System Audio Recording status, prompts, and System Settings deep links (`not-applicable` elsewhere) |
| `calendar` | `calendar:auth/disconnect/events/status` | Google Calendar OAuth and event polling |
| `updater` | `updater:check/download/install/get-status` | Auto-update control |
| `app` | `app:version` | App version string |
| `ffmpeg` | `ffmpeg:check`, `ffmpeg:install`, `ffmpeg:onProgress` | FFmpeg presence check (`source`: bundled, installed or system) and runtime download |

Event subscriptions go through a single `on(channel, callback)` / `off(...)` pair with an
explicit allowlist of valid channel names (`recording:started`, `recording:stopped`,
`recording:error`, `transcription:progress`, `processing:progress`, `processing:complete`,
`processing:error`, `processing:cancelled`, `notes:preview`, `ws:extension-connected`, `ws:recording-requested`,
`sessions:durations-updated`, `updater:status`, `calendar:meeting-starting`,
`llm:fallback-used`, `log:entry`, `app:open-session`, `app:navigate` (macOS app menu, e.g.
Settings… ⌘,)) so the renderer cannot subscribe to an arbitrary IPC channel.

The meeting overlay window uses its own, smaller preload (`electron/overlay-preload.js`, run
sandboxed) exposing only `window.meetmindOverlay`: `overlay:ready`, `overlay:start`,
`overlay:stop`, `overlay:dismiss`, `overlay:keep-recording`, `overlay:open-session` (invoke),
`overlay:shown`, `overlay:resize`, `overlay:move` and `overlay:closed` (send), and the
`overlay:state` / `overlay:theme` push events. `overlay:ready`, `overlay:shown`,
`overlay:resize`, `overlay:move` and `overlay:closed` are registered by
`overlay/overlay-window.js` itself (`registerOverlayIpc()`); the actions are in `main.js`.

Preload also injects the startup theme class (`light`/`dark`) onto `<html>` synchronously, by
reading a `--meetmind-theme=` argument that main passes via
`webPreferences.additionalArguments`. This is read from `process.argv` only, with no IPC round
trip, so it can never block or deadlock startup; a failure here just costs a brief flash of the
wrong theme, and is wrapped so it can never take down the actual `contextBridge` exposure above
it.

### 3.3 Renderer (`renderer/`)

React 18 + Vite 6, no router: `renderer/app.jsx` is a single view-state switch between:

- `Dashboard.jsx`: stats and a recent-sessions list; its search button opens Meetings with the
  search field focused (`requestFocus`/`consumeFocus` in `lib/scrollMemory.js`).
- `Meetings.jsx`: full session list with search, status chips, a sort menu and a Filters panel
  (date preset or range, length, platform, content); the filter/sort logic is pure, in
  `lib/meetingFilters.js`. Search is `lib/meetingSearch.js`, run in the renderer over the notes
  and transcripts `sessions:list` already returns: stemming, a curated meeting-vocabulary
  concept map, BM25 ranking over weighted fields (title > headings/decisions/action items >
  people > notes > transcript), typo and prefix matching against the corpus vocabulary, and
  verbatim "quoted phrases", with the best-matching passage returned as a highlighted snippet.
  No embeddings or network calls.
- `NoteViewer.jsx` / `TranscriptViewer.jsx`: a completed session's notes or raw transcript.
- `Settings.jsx`, composed of `settings/GeneralSection.jsx`, `TranscriptionSection.jsx`,
  `NotesSection.jsx`, `IntegrationsSection.jsx`, `SystemSection.jsx`: API keys, service
  selection, FFmpeg install flow, onboarding. On macOS, `SystemSection` also shows
  `settings/MacPermissions.jsx`: permission statuses and the "Test system audio" check, which
  records 3 s with each capture strategy and offers to switch to one that heard audio
  (`lib/audioTest.js`).
- `LogsViewer.jsx`: tails `electron/utils/logger.js` output live via the `log:entry` IPC event.

Supporting pieces: `RecordingBar.jsx` (persistent recording control), `ProcessingIndicator.jsx`
(pipeline progress), `SessionCard.jsx`, `UpcomingMeetings.jsx` (Google Calendar),
`PasteTranscriptModal.jsx` (manual transcript import), `note/` (Markdown rendering,
`copyMarkdown.js` for JSON<->Markdown conversion, `pdfDocument.jsx` for the PDF export
template, `AudioPlayer.jsx` streaming from `meetmind-audio://`), `ui/` (Dialog, ConfirmDialog,
`Menu.jsx` for keyboard-navigable dropdown menus).

State/plumbing: `lib/app-context.js`, `lib/hooks.js`, `lib/status.js`, `lib/format.js`,
`lib/platform.js` (meeting platforms), `lib/os.js` (host OS), `lib/meetingFilters.js`, `lib/meetingSearch.js`, `lib/scrollMemory.js`,
`lib/audioMeter.js`, `lib/audioTest.js`, `lib/greeting.js`.

A second Vite entry, `renderer/overlay.html` -> `overlay.jsx` ->
`components/overlay/MeetingOverlay.jsx`, renders the floating meeting overlay (section 3.4)
with the same `globals.css` design-system classes.

Styling: Tailwind CSS (`darkMode: 'class'`, with `<html class="dark">` toggled by preload/React
based on the `theme` setting) driven by CSS custom properties in `renderer/styles/globals.css`
(`--color-*` tokens), consumed via Tailwind arbitrary values, e.g.
`bg-[rgb(var(--color-background))]`, rather than hardcoded hex colors. Icons from
`lucide-react` plus a handful of hand-authored brand icon components
(`GeminiIcon`, `ClaudeIcon`, `AssemblyAiIcon`, `SarvamIcon`, `GroqIcon`, `NotionIcon`, `GoogleCloudIcon`,
`GoogleCalendarIcon`). Notes/transcript Markdown rendering uses `react-markdown` +
`remark-gfm`, shared between the in-app notes view and the PDF export document; the live
preview of notes still being written runs the Markdown through `remend` first.

### 3.4 Meeting detection and overlay (`electron/detection/`, `electron/overlay/`)

The desktop app notices calls by itself, without the extension, the way Notion's and Granola's
desktop apps do. This is Windows-only for now: on macOS `win32.js` reports itself unavailable,
the detector logs that and stays off, and Settings shows "Not available on macOS yet" instead of
the switch. `detection/meeting-detector.js` polls every 1.5 s, using two Win32 reads made
through `koffi` FFI in `detection/win32.js` (loaded lazily, so a load failure only disables
detection):

- **Who holds the mic**, from two sources merged by `mergeMicUsers()`:
  - the apps with an active WASAPI capture session on any active microphone
    (`IMMDeviceEnumerator` → each capture endpoint's `IAudioSessionManager2` → sessions in the
    active state → `IAudioSessionControl2::GetProcessId` → exe), called through each COM object's
    vtable with `koffi.call`. This is the documented audio API and the primary source.
  - the privacy-indicator consent registry
    `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`
    (`NonPackaged\<path with # for \>` for win32 apps, package family names for packaged apps),
    where an app is on the mic when its `LastUsedTimeStop` is `0`. Some Windows installs stop
    updating these values, so on its own it misses calls; it still adds packaged apps the
    sessions don't name.

  MeetMind's own exe is ignored.
- **Window titles**: `EnumWindows` + `GetWindowTextW`, with the owning exe resolved via
  `QueryFullProcessImageNameW`.

The pure rules and state machine in `detection/meeting-rules.js` (unit-tested) decide:

- A browser (Chrome, Edge, Brave, Firefox, Opera, Vivaldi, Arc) holding the mic counts as a
  meeting only if it showed a Google Meet, Zoom web or Teams web title in the last 2 minutes, so
  switching tabs mid-call keeps the meeting but voice search on another site never prompts.
- The Zoom and Teams desktop apps holding the mic count on their own.
- Two consecutive positive polls emit `meeting-detected`; 15 s with no positive poll emits
  `meeting-ended`. "Not now" suppresses a meeting until it ends.

Detection runs in the main process, so it keeps working while the window is minimised or hidden
in the tray. The detector logs which mic source works when it starts, a warning if the audio
sessions become unreadable (and when they recover), a note the first time the sessions show a
browser on the mic that the registry doesn't, and a heartbeat every 10 minutes (ticks, failed
ticks, the longest gap between ticks, the apps seen on the mic). After sleep (`powerMonitor`
`resume`) it polls at once rather than waiting for the next tick.

`main.js` turns those events into overlay states, each a single compact row: `prompt` (Record / ×),
`recording` (timer + Stop), `ended` ("Meeting ended?": it asks, never stops on its own),
`processing`, `complete` (Open) and `error`. Recordings started from the app, tray or
extension show the overlay too, and processing updates apply only to the session the overlay is
following. `overlay/overlay-window.js` owns the window: frameless, transparent, always on top,
`focusable: false` and shown with `showInactive()` so it never takes focus from the call (on
macOS a `type: 'panel'` window, which also floats over full-screen apps and every Space without
the Dock flicker `setVisibleOnAllWorkspaces` causes there),
placed at the top centre of the display showing the meeting (Windows reports the meeting
window's bounds in physical pixels, converted to DIPs with `screen.screenToDipRect`), and sized
to the card's reported height. The bar animates open (the mic tile drops in, then unfolds to full
width) and closed (it collapses back to the tile and lifts away; `renderer/styles/overlay.css`).
To hide, main sends a hidden state and waits for the renderer's `overlay:closed` after the close
animation, with a 1.2 s fallback.

The overlay window is created for each show and destroyed once it has closed, never kept hidden
between meetings: a long-lived hidden, transparent window can stop painting (renderer or GPU
process gone after sleep) and then "shows" as nothing. The pure lifecycle in
`overlay/overlay-lifecycle.js` (unit-tested) drives it. The window is shown when its renderer
invokes `overlay:ready`; the renderer then sends `overlay:shown` once a visible state is on
screen, and a `capturePage()` check confirms something was painted (again after `resume` and
display changes). A window that crashes (`render-process-gone`), fails to load, hangs, isn't
acknowledged within 5 s or paints nothing is replaced once. If the replacement fails too, main
shows the prompt as a system notification instead ("Meeting detected · Click to start
recording", which starts recording like the Record button, and closes when the meeting ends or
a recording starts). Each step is logged (`Meeting overlay shown`/`failed`/`recovered`), and
main also logs any child process (e.g. the GPU process) that dies. For testing the fallback, an
unpackaged app run with `MEETMIND_DEBUG_OVERLAY_FAIL=1` never acknowledges the overlay. The
`meetingDetection` setting (default on) turns detection and the overlay off.

---

## 4. Audio capture pipeline

MeetMind has two independent capture paths, tried in order (the second on Windows only).

### 4.1 Primary path: renderer capture

The renderer captures system audio via Electron's display-media loopback API
(`getDisplayMedia`) and the microphone via the Web Audio API, in-process, then streams encoded
chunks to main over the `capture:chunk` IPC channel. Main appends each chunk to an
in-progress `.webm` file on disk as it arrives, so a crash mid-recording still leaves a usable
partial file. On stop, `convertWebmToWav()` (`electron/audio/recorder.js`, ffmpeg-backed)
produces the final `.wav` used by the transcription stage.

Main's display-media handler (`installDisplayMediaHandler()`) approves the request without a
picker and answers with `audio: 'loopback'`:

- **Windows**: Chromium's WASAPI loopback, capturing whatever the default output device plays.
  The video source is a screen from `desktopCapturer`; the renderer stops that track at once.
- **macOS 14.2+**: the CoreAudio Tap API (Electron 39+), which needs `NSAudioCaptureUsageDescription`
  in Info.plist (without it macOS returns a silent stream with no error) and the user's Screen &
  System Audio Recording permission. Electron's macOS loopback is new and behaves differently
  per video source, so the source is configurable as `config.macCaptureStrategy`
  (`electron/audio/mac-capture.js`): `screen` (default; a `desktopCapturer` screen), `frame`
  (MeetMind's own frame, which may avoid the Screen Recording prompt) or `picker` (the macOS
  system picker). Settings › System › "Test system audio" runs a 3 s capture per strategy via
  `capture:test-begin`/`capture:test-end` and lets the user switch. On macOS `main.js` asks for
  microphone access before a recording and allows 60 s for the renderer to start (permission
  prompts), versus 6 s on Windows.

If the renderer gets no system audio (the request is refused, or the stream has no audio track),
it fails on Windows, so main falls back to 4.2, which can still capture it; on other platforms
it records the microphone alone and shows a warning.

### 4.2 Fallback path: direct ffmpeg capture (Windows)

If renderer capture fails to start, `handleStartRecording()` in `main.js` falls back on Windows
to a direct
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

macOS has no fallback (ffmpeg's `avfoundation` can't capture system audio without a virtual
device, and the renderer already covers the mic-only case): a failed start ends with an error
pointing at the Privacy & Security permissions.

### 4.3 FFmpeg resolution

`electron/audio/ffmpeg-path.js` resolves the ffmpeg/ffprobe binary path (`ffmpeg.exe` on
Windows, `ffmpeg` elsewhere) in this order: a bundled copy under Electron's `extraResources`
(production installs) or a local copy at `assets/ffmpeg/` (dev machines that downloaded it
manually; per-arch `assets/ffmpeg/mac-<arch>/` on macOS), then on macOS the in-app install in
`userData/ffmpeg/` and Homebrew's `/opt/homebrew/bin` and `/usr/local/bin` (Finder-launched apps
don't inherit the shell PATH), and finally the bare command on PATH. The candidate list is built
by the pure `ffmpegCandidates()` (unit-tested in `tests/ffmpeg-path.test.js`). If nothing is
found, Settings → System offers a runtime download via the `ffmpeg:install` IPC handler
(`electron/services/ffmpeg-installer.js`).

Every FFmpeg MeetMind ships or installs comes from one table of pinned downloads,
`electron/audio/ffmpeg-sources.js`, and goes through `electron/audio/ffmpeg-fetch.js`: each zip
is checked against its pinned SHA-256 (`electron/utils/download.js`) before it is unpacked
(PowerShell `Expand-Archive` on Windows, `ditto` on macOS). The same code serves the in-app
installer and `scripts/fetch-ffmpeg.js`, which stages the binaries for CI and release builds.

- **Windows**: the essentials build from [GyanD/codexffmpeg](https://github.com/GyanD/codexffmpeg)
  on GitHub (the same builds [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) serves), one zip with
  both executables. The in-app installer copies them next to where the bundled copy lives.
- **macOS**: per-architecture release builds from
  [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de/) (static, Developer ID signed), one zip
  per tool. The in-app installer puts them in `userData/ffmpeg/`, never inside the app bundle,
  whose signature it would break. Intel release builds there end in January 2027, so the pinned
  x64 zips need mirroring before then (see [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)).

FFmpeg binaries are never committed to git (they exceed GitHub's 100 MB file limit and CI's
repo-hygiene job actively rejects any `.exe`/`.dll`/`.msi`/`.dylib`, or anything in
`assets/ffmpeg/` but its README).

---

## 5. Processing pipeline

`runProcessingPipeline()` in `main.js` drives three stages in sequence. Progress is pushed to
the renderer via `processing:progress` and, via the WebSocket bridge, to the extension's overlay
(`PROCESSING_PROGRESS` / `PROCESSING_COMPLETE`) at each stage boundary: transcription fills
0–60%, notes 60–85% and Notion 85–100%. Within the notes stage the bar keeps moving as the
model writes (see 5.2). Each stage can be
independently retried through `processing:retry` if it fails (e.g. a transient network error on
Stage 1 does not force re-transcription to be repeated once Stage 2 later fails).

### 5.0 Provider layer (`electron/providers/`)

Every speech-to-text and LLM engine is a self-describing module registered in
`electron/providers/index.js` (two registries built by `providers/registry.js`). A module
exports its metadata (`id`, `name`, `credentials[]`, curated `models[]`, `defaultModel`,
`allowCustomModel`, `guide[]`, `capabilities`) plus `transcribe()` (STT) or `generate()` (LLM)
and `test()`. Consequences:

- The renderer gets serializable descriptors from `providers:list` and renders Settings, the
  "key set" pills, model pickers and connection tests generically (`ProviderSection.jsx`); the
  generic `providers:test` IPC replaces the old per-vendor `api:test-*` handlers.
- Config keys (API keys, project IDs, ...) are derived from each module's `credentials`, so
  `config.js` needs no edit for a new provider.
- The controllers stay provider-agnostic: `services/transcription.js` (silence check, dispatch)
  and `services/notes.js` (prompt/mode resolution, JSON parsing, primary -> fallback).
- Shared helpers live in `providers/shared/` (`http.js`, `wav.js`, `log.js`). Provider modules
  must not import `electron` at load time, so they are unit-testable.

To add an engine see [`ADDING_PROVIDERS.md`](ADDING_PROVIDERS.md).

### 5.1 Stage 1: Transcription (`electron/services/transcription.js` + `electron/providers/stt/*`)

The engine is selected by the `sttService` setting: `google` (default), `assemblyai`, `sarvam`
or `groq`. The model comes from `sttModels[<engine>]` (curated list per engine, validated on
read). The controller checks that the recording is not silent and then calls the provider.

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
  job, with built in speaker diarization. Models: `universal-3-5-pro` (default; sent with
  `language_detection` and Universal-2 as the fallback for languages outside its 18, which code-
  switch natively) and `universal-2` (with a fixed `language_codes` list). It replaced
  `universal-3-pro`, which a saved config resolves to the default.

- **Sarvam AI** (`https://api.sarvam.ai`): job-based flow (`sarvamPost`/`sarvamGet` helpers)
  against `/speech-to-text/job/v1/...`: create job (model `saaras:v3`) -> upload file -> start
  job -> poll status -> download result. `saaras:v3` is used specifically because meetings
  commonly mix English and Indic languages, and this model supports that code-switching
  automatically, without a language being pinned in advance. This is the only engine
  built for that use case; Google STT is configured with a single `language` setting (default
  `ml-IN`), and AssemblyAI's default Universal-3.5 Pro detects the language itself.

- **Groq** (`https://api.groq.com/openai/v1/audio/transcriptions`): Whisper models
  `whisper-large-v3-turbo` (default) and `whisper-large-v3`, called with multipart `fetch`
  and `verbose_json` segment timestamps. Groq caps uploads at 25 MB on the free tier, so the
  WAV is split into 10 minute chunks (2 s overlap, merged with the shared `mergeTranscriptSegments`)
  and 429 responses are retried honoring `retry-after`. It has no diarization, so every segment
  is labelled `Speaker 1` (`capabilities.diarization: false`), and it is weaker than Sarvam on
  English/Indic code-switching. The same `groqApiKey` is used by the Groq LLM provider.

### 5.2 Stage 2: Notes generation (`electron/services/notes.js` + `electron/providers/llm/*`)

`generateNotes(transcript, config, { meetingTitle, onPreview })` resolves the primary target from
`llmProvider` and `llmModels[<provider>]`, builds the prompt for the output mode, calls
`provider.generate()` and parses the result (`services/notes-normalize.js`: fence stripping,
`normalizeNotes`, JSON fallback). Providers only return raw text.

All three providers stream their answer, passing each text delta to `generate()`'s `onText`
callback (Claude and Groq read server-sent events with `providers/shared/sse.js`, Gemini uses
`generateContentStream`). While the notes are being written, `generateNotes` rebuilds a preview
from the text so far at most every 100 ms (`buildNotesPreview`: incomplete JSON is completed by
`partial-json` and run through `normalizeNotes`; Markdown is passed through) and
`generateAndStampNotes` sends it to the renderer as `notes:preview`
(`{ sessionId, attempt, provider, model, notes, progress }`, a full snapshot each time, `notes: null` when an
attempt starts so a fallback begins with a clean preview). The meeting page shows it in place of
any old notes, rendering the same cards or Markdown as the final notes; Markdown goes through
`remend` first, which closes half-written bold, code and links. Previews are never saved: the
DB is only written once the final text parses, and on failure the old notes are shown again.

`progress` is `estimateNotesProgress()` (`notes-normalize.js`): the notes are expected to run to
about 12% of the transcript plus 1,200 characters (between 1,500 and 12,000), progress is linear
to 90% at that length and then creeps towards 100% without reaching it. `main.js` maps it onto
60–84% of the bar and sends `processing:progress` (`generating`) whenever the whole percentage
goes up, never down, so a fallback that starts over doesn't move the bar backwards.

The session's `meeting_title` column holds the meeting's own title: the detected tab or window
title, the extension's tab title, a calendar event's title, a pasted transcript's title, or a
name the user gave it on the meeting page (`session:rename`; the pipeline re-reads it, so a
rename during processing sticks). Source titles are filtered by `sourceMeetingTitle()` (`services/meeting-title.js`), which drops placeholders,
app names (`Google Meet`, `Zoom Meeting`, `Microsoft Teams`…) and ad-hoc Meet codes
(`abc-defg-hij`). When it is set, the user prompt names it as the title and context, and
`applyMeetingTitle()` makes it the notes title (and the Markdown `#` heading) whatever the model
wrote. Without one, the session takes the LLM's title.

- **Gemini** (`llm/gemini.js`, `@google/generative-ai`): `gemini-3.8-flash` (default),
  `gemini-3.7-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, plus Google's auto-updating
  `latestModels` (`gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`), which
  Settings offers under a Latest / Pinned / Custom toggle. Retired model IDs saved
  by older versions are remapped through the provider's `_deprecatedModels` table.
- **Groq** (`llm/groq.js`, OpenAI-compatible `chat/completions`): `llama-3.3-70b-versatile`
  (default), `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.1-8b-instant`. JSON mode sends
  `response_format: {type: "json_object"}`, and asks again without streaming if a model refuses to stream in JSON mode. Free-tier tokens-per-minute limits can reject long
  transcripts (HTTP 413/429); the error says so and the fallback below covers it.
- **Claude** (`llm/claude.js`, Anthropic Messages API `POST /v1/messages` via `fetch`, no SDK):
  `claude-sonnet-5-5` (default), `claude-fable-5-1`, `claude-opus-5-5`, `claude-haiku-5-5`.
  Authenticated with `claudeApiKey` (`x-api-key` + `anthropic-version` headers).
- All three allow a custom model ID.

Two output modes, controlled by `noteOutputMode` (the model is asked for JSON or Markdown):

- **`json`** (default): the model is asked for structured JSON (executive summary, agenda, key
  decisions, an action items array with owner/deadline/priority per item, participants, notable
  mentions, and per-topic sections with options discussed / open questions). This structured
  form is what is rendered as cards in the Summary tab and is what the `copyMarkdown.js`
  converter round-trips to/from Markdown for editing.
- **`markdown`**: the model is asked to write executive-style Markdown directly (`DEFAULT_MD_SYSTEM_PROMPT`), and that Markdown is stored and rendered as-is, with no structured
  round trip.

A fallback (`llmFallback: {provider, model}`) can be any provider and model, tried once if the
primary call fails (or the primary has no key). It is surfaced to the renderer via the
`llm:fallback-used` event so the user knows a fallback produced the notes they are reading.
Notes record `_llmProvider`, `_llmModel`, `_sttService` and `_sttModel` (plus the legacy
`_geminiModel`) for the note header.

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
  status            TEXT NOT NULL DEFAULT 'recording',
  last_error        TEXT,   -- added in 4.0.0 via ALTER TABLE: why the last processing run failed
  meeting_title     TEXT    -- added in 4.10.0 via ALTER TABLE: the meeting's own title (see 5.2)
)
```

Indexes on `started_at DESC` and `status`. `markStaleRecordingSessionsAsError()` runs at
startup and flips any session still marked `recording` after more than 2 hours (e.g. the app
crashed mid-recording, or stop failed) to `error`, so the Dashboard never shows a phantom
in-progress recording indefinitely.

### 6.2 Settings (`electron/utils/config.js`)

Wraps `electron-store` (itself backed by a JSON file in `userData`) with a typed schema covering:
API keys (`googleApiKey`, `geminiApiKey`, `claudeApiKey`, `assemblyAiApiKey`, `sarvamApiKey`, `groqApiKey`,
Notion, Google Calendar OAuth client; the provider ones are generated from the provider
registries), service and model selection (`sttService`, `sttModels`, `llmProvider`,
`llmModels`, `llmFallback`), audio device selection (Windows FFmpeg fallback:
`systemAudioDevice`, `micDevice`; macOS system-audio capture strategy: `macCaptureStrategy`,
`screen`/`frame`/`picker`, default `screen`), diarization parameters
(`enableDiarization`, `minSpeakers`, `maxSpeakers`), output preferences (`noteOutputMode`,
`language`, custom `geminiSystemPrompt`), UI preferences (`theme`, `autoLaunch`,
`hideLogsInSidebar`, `pinNotesViewToggle`, `dashboardRecentLimit`), meeting detection
(`meetingDetection`, default `true`), update behavior
(`autoCheckUpdates`), PDF export (`pdfExportDir`, `pdfIncludeTranscript`), and the WebSocket
port (`websocketPort`, default `39842`).

Several settings keys have deliberate aliases kept in sync on write (`setConfig`), for backward
compatibility with older releases' field names: `notionToken`/`notionApiKey`,
`notionDatabaseId`/`notionPageId`,
`systemPrompt`/`geminiSystemPrompt`, `promptOutputMode`/`noteOutputMode`. The pre-4.0 keys `selectedModel`/`geminiModel` and
`secondaryGeminiModel` are migrated once into `llmModels.gemini` and `llmFallback`
(`utils/configMigration.js`).

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

macOS builds are ad-hoc signed (no Apple Developer ID yet), and Squirrel.Mac won't install an
update into an app without a stable signature. So on macOS `CAN_SELF_UPDATE` is false (exposed
as `canSelfUpdate` in the state): the app still checks `latest-mac.yml`, but "Download" opens
the GitHub release page instead of downloading, and the UI says "Download from GitHub". Once
mac builds are Developer ID signed and notarized, flipping that one constant enables in-app
updates there too.

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
file named `YYYY-MM-DD-HHmm-Title.pdf`. Output goes to `config.pdfExportDir`, or the user's
Downloads folder when that setting is empty, and an existing file at that name is never
overwritten (a fresh timestamp/name is used instead). Whether the transcript is appended to the
PDF is controlled by `pdfIncludeTranscript` (default off).

---

## 11. Third-party APIs and services

| Service | Used for | Auth | Called from |
| --- | --- | --- | --- |
| Google Cloud Speech-to-Text v1 | Transcription (fallback, no project ID configured) | API key | `electron/providers/stt/google.js` |
| Google Cloud Speech-to-Text v2 | Transcription (`chirp_3` sync, or BatchRecognize for long audio) | Service account Bearer token (no API-key auth) | `electron/providers/stt/google.js` |
| Google Cloud Storage | Staging WAV files for v2 BatchRecognize | Service account key file | `electron/providers/stt/google.js` (`@google-cloud/storage`) |
| Google Gemini API | Meeting notes generation (Stage 2) | API key | `electron/providers/llm/gemini.js` (`@google/generative-ai`) |
| Anthropic Claude API | Notes generation (Sonnet, Fable, Opus, Haiku) | API key | `electron/providers/llm/claude.js` (REST via `fetch`) |
| Groq | Notes generation (Llama, GPT-OSS) and Whisper transcription | API key (one key for both) | `electron/providers/llm/groq.js`, `electron/providers/stt/groq.js` (REST via `fetch`) |
| AssemblyAI | Transcription (alternative engine) | API key | `electron/providers/stt/assemblyai.js` (`assemblyai` SDK + REST) |
| Sarvam AI | Transcription, `saaras:v3` model for English/Indic code-switching | API key | `electron/providers/stt/sarvam.js` (REST) |
| Notion API | Optional notes sync (Stage 3) | Internal integration token | `electron/services/notion.js` (`@notionhq/client`) |
| Google Calendar API | Optional upcoming-meeting reminders | OAuth2 (user-supplied client ID/secret) | `electron/services/google-calendar.js` (`googleapis`) |
| GitHub Releases | Auto-update distribution | none (public releases) | `electron-updater`, configured in `electron-builder.yml` |
| GyanD/codexffmpeg (gyan.dev builds) | Windows FFmpeg binaries | none | Pinned + SHA-256 verified in `electron/audio/ffmpeg-sources.js`, used by `scripts/fetch-ffmpeg.js` (bundled build) and `ffmpeg:install` |
| ffmpeg.martin-riedl.de | macOS FFmpeg binaries (arm64 + x64) | none | Pinned + SHA-256 verified in `electron/audio/ffmpeg-sources.js`, used by `scripts/fetch-ffmpeg.js` (bundled build) and `ffmpeg:install` |
| Sigstore (via `actions/attest`) | Signed build-provenance attestations for release files | GitHub OIDC (release workflow only) | `attest` job in `release.yml` |

All of the above except GitHub Releases and FFmpeg distribution are bring-your-own-credentials:
MeetMind ships no API keys or secrets of its own. Every key lives in the user's local
`electron-store` settings file, in plaintext (there is no OS keychain integration or at-rest
encryption of these values; see section 14).

---

## 12. Package inventory

From `package.json` (pnpm, Node 22.12+, Windows or macOS).

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
| `koffi` | ^3.3.3 | FFI to `user32`/`kernel32`/`advapi32` for meeting detection (mic users, window titles) on Windows, and to CoreGraphics for the macOS screen-capture permission check; prebuilt binaries from its `@koromix/koffi-<os>-<cpu>` optional dependencies (each package ships only its own OS's, via `electron-builder.yml` `files`), so its install script stays disabled in `allowBuilds` |
| `lucide-react` | ^1.48.0 | Renderer icon set |
| `react-markdown` | ^10.1.0 | Notes/transcript Markdown rendering (in-app and PDF) |
| `remark-gfm` | ^4.0.1 | GitHub-flavored Markdown extensions (tables, task lists) for `react-markdown` |
| `remend` | ^1.4.0 | Closes unterminated Markdown (bold, code, links) in the live notes preview |
| `partial-json` | ^0.1.7 | Parses the incomplete JSON an LLM has streamed so far, for the live notes preview |
| `sql.js` | ^1.14.2 | SQLite compiled to WASM, backs the sessions database |
| `uuid` | ^10.0.0 | Session ID generation |
| `ws` | ^8.21.3 | WebSocket server for the desktop <-> extension bridge |

### 12.2 Dev dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| `electron` | ^44.7.0 | Runtime; electron-builder packages the version the lockfile installed. Since Electron 42 the package has no install script: the binary downloads the first time Electron is launched, or with `pnpm exec install-electron` |
| `electron-builder` | ^26.17.0 | Packaging the Windows NSIS installer and the macOS DMGs (26.0.13+ is needed for ad-hoc `identity: "-"` signing) |
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
`node_modules` tree, `supportedArchitectures` (`cpu: [current, arm64, x64]`) so an Apple Silicon
runner also installs the x64 native packages it needs to package the Intel build, and `allowBuilds` records which dependencies may run install scripts
(extend with `pnpm approve-builds <pkg>`; `koffi` and `electron-winstaller` are explicitly
denied because their scripts aren't needed). `verifyDepsBeforeRun: warn` stops `pnpm run` from
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
| `assets/icons/` | Source SVG/PNG icon plus every generated resolution (16 through 1024px; the 1024px `icon.png` is what electron-builder turns into the macOS `.icns`), the Windows `.ico`, and the macOS menu-bar `trayTemplate.png`/`@2x` (from `tray-template.svg`), regenerated by `pnpm run generate-icons` (`scripts/generate-icons.js`, via `sharp` + `png-to-ico`); also holds third-party service icons (Google Calendar, Google Meet, Notion) used in the UI, and an `icons/services` subfolder |
| `assets/ffmpeg/` | Empty at rest (only a `README.md`); FFmpeg binaries are never committed (over GitHub's 100 MB limit and actively rejected by CI's repo-hygiene check). Windows: `ffmpeg.exe`/`ffprobe.exe` at the root, placed manually or by `release.yml`. macOS: `mac-arm64/` and `mac-x64/`, filled by `scripts/fetch-ffmpeg.js` |
| `assets/installer.nsh` | Custom NSIS installer script logic (referenced by `electron-builder.yml`'s `nsis.include`) |
| `assets/entitlements.mac.plist` | macOS entitlements (JIT, library validation, audio input), applied once the hardened runtime is turned on with Developer ID signing |
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
- **Meeting detection** (Windows) reads only local state (the apps recording from a microphone,
  through the audio-session API and the mic consent registry, and visible window titles);
  nothing it reads leaves the machine or is stored beyond the detected meeting's title.
- **macOS code signing**: builds are ad-hoc signed only (`identity: "-"`, no hardened runtime,
  not notarized), so Gatekeeper asks the user to approve the app once (Privacy & Security →
  Open Anyway), privacy permissions don't survive updates, and the app never replaces itself
  (see section 9). The runtime FFmpeg download is installed into `userData`, outside the app
  bundle, and is SHA-256 checked against pins in the source.
  The overlay window runs sandboxed with its own minimal preload, denies navigation and new
  windows, and can only start or stop a recording through main.
- **API keys and OAuth tokens at rest**: stored via `electron-store` in a JSON file under the
  OS user profile, in plaintext. There is no OS keychain (Windows Credential Manager, macOS Keychain) integration
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
  through `env:` instead. Binaries a workflow downloads (gitleaks, the bundled FFmpeg builds) are
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
  packaged app's actual version. There are two HTML entries: `index.html` (the app) and
  `overlay.html` (the meeting overlay window).
- **Extension**: `scripts/build-extension.js` zips `extension/` into
  `dist/meetmind-extension.zip` (`pnpm run build:ext`).
- **Electron packaging** (`electron-builder.yml`): `appId: com.meetmind.app`, Windows NSIS
  installer (`x64` only), `signAndEditExecutable: false` (unsigned), custom installer/uninstaller
  icons, desktop and start-menu shortcuts created, an `afterPack` hook
  (`scripts/after-pack.js`), and the `meetmind://` protocol association declared via `protocols`.
  FFmpeg is pulled in as per-platform `extraResources` (`assets/ffmpeg/*.exe` on Windows,
  `assets/ffmpeg/mac-${arch}/` on macOS -> `ffmpeg/` in the packaged app),
  explicitly excluded from the `asar` archive's `files` list (`!assets/ffmpeg/**`) since ffmpeg
  needs to run as a native subprocess, not live inside the packed archive. There is deliberately
  no `electronVersion`: electron-builder packages the Electron installed from the lockfile
  (`node_modules/electron`), so the shipped runtime always matches dev and the tests (a pin there
  drifted whenever Dependabot bumped `electron` in `package.json`). `asarUnpack` keeps `koffi` and its
  `@koromix/koffi-*` native binary outside the archive, since a `.node` file can't be loaded from
  inside it.
- **macOS packaging** (`mac:` in `electron-builder.yml`): `dmg` + `zip` targets for `arm64` and
  `x64` (`MeetMind-X.Y.Z-<arch>.dmg` to download, `MeetMind-X.Y.Z-<arch>-mac.zip` +
  `latest-mac.yml` for the update check; `${arch}` stays in the names because electron-updater
  picks the file by it), `minimumSystemVersion: 14.2` (system-audio capture needs the CoreAudio
  Tap API), icon from `assets/icons/icon.png`, ad-hoc `identity: "-"`, `hardenedRuntime: false`
  and `notarize: false` until there is a Developer ID, entitlements ready in
  `assets/entitlements.mac.plist`, and `extendInfo` adding `NSMicrophoneUsageDescription` and
  `NSAudioCaptureUsageDescription`. `pnpm run build:mac` builds both arches in one run so a single
  `latest-mac.yml` lists both; it must run on a Mac. `scripts/after-pack.js` (rcedit) and
  `assets/installer.nsh` are Windows-only.
- **Build must include `dist/renderer/**` in `build.files`**; since `dist/` is gitignored,
  omitting this would ship an installer whose window is blank (a documented, previously-hit
  failure mode, called out explicitly in `AGENTS.md`'s "Learned Workspace Facts").
- **Production build** (`pnpm run build`) requires `assets/ffmpeg/ffmpeg.exe` and
  `assets/ffmpeg/ffprobe.exe` to already exist locally (not committed), and `pnpm run build:mac`
  needs `assets/ffmpeg/mac-<arch>/`; `pnpm run fetch-ffmpeg` stages either from the pins.
- **`pnpm run build:dir`** / **`pnpm run build:mac:dir`**: production renderer build + an
  unpacked Electron app under `dist/desktop/`, for fast local iteration without building the full
  installer.
- **Smoke test**: a packaged app started with `--smoke` (`electron/smoke.js`) uses a throwaway
  profile, opens no window, checks config + DB, finds and runs ffmpeg/ffprobe, encodes a 1 s Opus
  WebM and converts it with `convertWebmToWav`, loads koffi, queries the permissions API and the
  meeting-detection backend (including the WASAPI audio sessions, whose status it reports without
  failing, since a CI runner may have no audio service), prints `MEETMIND_SMOKE {json}` and exits non-zero on any failure.
  `scripts/check-smoke.js` reads that output in CI, fails the step unless every check passed,
  and writes a table of the checks to the job summary.

---

## 16. CI/CD (`.github/workflows/`)

All workflows share `.github/actions/setup` (pnpm from the `packageManager` field, Node 24,
`pnpm install --frozen-lockfile`).

- **`ci.yml`**: runs on every PR against `main` and every push to `main`; also a reusable
  workflow (`workflow_call`) invoked by `release.yml` as a required gate. Jobs: lint
  (`pnpm run lint`), test (`pnpm run test`), build the renderer and the extension;
  `windows-build` on `windows-latest` (tests, fetch the pinned FFmpeg, `build:dir`, `--smoke`);
  `mac-build` on `macos-latest` (tests, fetch the pinned arm64 FFmpeg, `build:mac:dir`,
  `codesign --verify`, Info.plist privacy keys, `--smoke`, and the zipped `.app` uploaded as a
  7-day artifact for testers); a `changes` job that skips those two builds on PRs touching only
  docs (a skipped job still satisfies a required check); a repo-hygiene job (rejects a committed
  npm/yarn lockfile, committed `.exe`/`.dll`/`.msi`/`.dylib` or anything in `assets/ffmpeg/` but
  its README, a real `.env` file, or any file over 10 MB), a gitleaks secret scan (checksum-verified download) over the full git
  history, `pnpm audit --prod --audit-level high`, and a zizmor audit of the workflows
  themselves. No job has secrets, so all of it is safe on fork PRs. A new commit on a PR cancels
  that PR's run still in progress (`concurrency`, as in `pr-checks.yml` and `codeql.yml`). On a
  push to `main`, an `already-tested` job finds the merged PR through the API and skips every job
  except the dependency audit (new advisories need no file change) when the merged commit's file
  tree is identical to the PR's last commit and CI passed on that commit; anything else (the PR was
  behind `main`, no PR found, an API error) runs everything, and release gates (`release.yml` passes
  `always-run: true`, and grants the read scopes this job needs, since a called workflow can't
  exceed its caller's permissions), PRs and manual runs never skip. It runs no repository code and only has `actions`/`pull-requests`/`contents` read
  access. Reusing the PR's result adds no trust beyond what merging on its required checks
  already did: a PR can only fake a pass by changing `ci.yml`, which then reaches `main` with the
  identical tree it was tested with, after maintainer review (CODEOWNERS).
- **`release.yml`**: triggers on a push to `main` that touches `package.json` (i.e. a version
  bump). Calls `ci.yml` as a gate first. The `build` job then builds the Windows installer with a
  read-only token and no dependency cache, bundling the pinned, checksum-verified FFmpeg
  (`scripts/fetch-ffmpeg.js`), then smoke-tests the unpacked app. The `build-mac`
  job (`macos-latest`, same read-only/no-cache rules) fetches the pinned macOS FFmpeg for arm64
  and x64, runs `pnpm run build:mac`, verifies both apps' signatures and bundled FFmpeg and that
  `latest-mac.yml` lists both update zips, and smoke-tests the arm64 app; signing secrets would
  go in a protected environment on this job once there is a Developer ID. An `attest` job, the
  only one with `id-token: write` and `attestations: write` and running no project code, signs
  SLSA build provenance (`actions/attest`, Sigstore) for the installer, both DMGs, the mac update
  zips and the extension, so anyone can check a download with
  `gh attestation verify <file> --repo aslahtp/meetmind`. A separate `publish` job, which waits
  for the attestations, the only one granted
  `contents: write`, runs no dependency code and no third-party actions, and creates the GitHub
  release (Windows installer, both DMGs, the mac update zips, `latest.yml`, `latest-mac.yml`,
  blockmaps and the extension) using the runner's own `gh` CLI. `pnpm run build` is always invoked with
  `--publish never`, so electron-builder itself never needs a publish token.
- **`pr-checks.yml`**: PR-only. Enforces that any PR changing code also bumps `package.json`'s
  `version` and adds a matching `## [X.Y.Z] - YYYY-MM-DD` heading to `CHANGELOG.md` (docs and
  `.github/` changes are exempt; a `skip-version-check` label overrides it for the rest). Also
  runs a dependency-review check that fails a PR adding a runtime dependency with a
  high-severity advisory.
- **`codeql.yml`**: CodeQL security analysis of the JavaScript and of the workflows themselves
  (`actions` language, alongside zizmor) on PRs, pushes to `main`, and weekly on a schedule.
- **`pages.yml`**: publishes `site/` to GitHub Pages.
- **`.github/dependabot.yml`**: grouped weekly minor/patch dependency update PRs and monthly
  GitHub Actions updates (the workflows and the composite `.github/actions/setup`), each with a
  7-day cooldown.
- Every job sets `timeout-minutes` (smoke-test steps 3 minutes), so a hung build or app fails
  fast instead of running for GitHub's 6-hour default.
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
| `tests/meetingFilters.test.js` | Meetings filters and sorting (`renderer/lib/meetingFilters.js`) |
| `tests/meetingSearch.test.js` | Meeting search: stemming, concept map, typos, prefixes, phrases, ranking and snippets (`renderer/lib/meetingSearch.js`) |
| `tests/meetingDetection.test.js` | Meeting-detection rules: consent-key parsing, merging the two mic sources, meeting window titles, and the detect/end/dismiss state machine (`electron/detection/meeting-rules.js`) |
| `tests/autoLaunch.test.js` | Launch at login on Windows and macOS: reading the state from `launchItems`, `--hidden`, respecting an entry disabled in Task Manager, removing leftover entries, dev mode (`electron/services/auto-launch.js`) |
| `tests/settingsForm.test.js` | Settings dirty checks and saving only the changed fields (`renderer/lib/settingsForm.js`) |
| `tests/notesPreview.test.js` | Live notes preview: partial Markdown and JSON (`buildNotesPreview` in `electron/services/notes-normalize.js`) and the throttled `onPreview` snapshots of `generateNotes`, including a fallback |
| `tests/meetingTitle.test.js` | Which source titles name the meeting, and how one replaces the LLM's title and prompts it (`electron/services/meeting-title.js`, `buildUserPrompt`) |
| `tests/ffmpeg-path.test.js` | FFmpeg binary names and lookup order per OS/arch (`electron/audio/ffmpeg-path.js`) and the per-OS silent-recording hints (`electron/audio/audio-hints.js`) |
| `tests/macSupport.test.js` | macOS capture strategies (`electron/audio/mac-capture.js`), "Test system audio" verdicts (`renderer/lib/audioTest.js`), and the shape of the pinned macOS FFmpeg downloads (`electron/audio/ffmpeg-sources.js`) |
| `tests/macPermissions.test.jsx` | Server-renders the macOS Permissions card (`renderer/components/settings/MacPermissions.jsx`), which can't be seen in the Windows dev app |

The packaged app is additionally checked by its `--smoke` self-test in CI (section 15). There is
no maintainer Mac, so macOS behaviour beyond that (permission prompts, actual system-audio
capture) is verified by testers on real hardware, using the CI artifact and the in-app "Test
system audio" check.

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
does track it, and the pinned Intel Mac FFmpeg downloads, whose host stops publishing Intel builds
in January 2027 and which need mirroring before a removal breaks releases.

Structural limitations, by design rather than oversight:

- **macOS is a beta.** It needs macOS 14.2+, is ad-hoc signed (Gatekeeper approval once,
  permissions lost on every update, no in-app update install), has no FFmpeg capture fallback,
  and has no meeting detection yet. Electron's macOS system-audio loopback is new, which is why
  the capture strategy is configurable and testable in Settings. There is no Linux build target.
- **Meeting detection sees titles, not URLs.** A browser only exposes its active tab's title,
  so the meeting URL is unknown, and a meeting is recognised by its tab title (`Meet - …`,
  `Zoom Meeting`, `… | Microsoft Teams`). Other call apps (Slack, Discord, Webex) are recorded
  fine but not detected.
- **No database migrations.** `sessions` table changes have so far been additive
  (`CREATE TABLE IF NOT EXISTS` plus new nullable columns); a genuinely breaking schema change
  would need a migration strategy that does not exist yet.
