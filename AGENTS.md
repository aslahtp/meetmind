## Versioning and Changelog

For every change beyond a minor fix (typo, comment, formatting), update both files below in the same commit/PR:

1. **`package.json`** - Bump the `version` field using semantic versioning (`MAJOR.MINOR.PATCH`):

   - **Major (X.0.0):** Breaking changes, incompatible API changes, or removal of existing functionality.
   - **Minor (0.X.0):** New features or moderate changes that are backward-compatible.
   - **Patch (0.0.X):** Bug fixes, small tweaks, or internal changes with no user-facing behavior change.
   - Each number resets the ones to its right on bump (e.g. minor bump: `2.0.18` -> `2.1.0`; major bump: `2.1.5` -> `3.0.0`; patch bump: `2.0.18` -> `2.0.19`).
2. **`CHANGELOG.md`** - Add a new heading for the version, following [Keep a Changelog](https://keepachangelog.com/) format:

   - Place the newest version at the top, directly below the `# Changelog` title.
   - Use the format: `## [X.Y.Z] - YYYY-MM-DD`
   - Group entries under `Added`, `Changed`, `Fixed`, or `Removed` as applicable.
   - Write concise, single-line bullet points. No duplicate or near-duplicate entries; if a later change supersedes an earlier unreleased entry, edit the original instead of adding a new line.
   - Do not log purely internal changes (refactors, comment updates) unless they affect behavior or the public API.

Skip this process only for changes that touch no functionality: comments, formatting, whitespace, or internal documentation.

## Codebase Architecture

Three artifacts build from this one repo: the Electron desktop app, its React renderer, and a Chrome MV3 extension (`extension/`) that bridges Google Meet/Zoom to the desktop app.

- **Main process** (`electron/main.js`) owns the window/tray, all `ipcMain` handlers, the recording state machine, and `runProcessingPipeline()` (transcribe → generate notes → optional Notion upload). `electron/preload.js` exposes this surface to the renderer as `window.meetmind.*` (contextIsolation on, nodeIntegration off) — grouped by feature: `window`, `recording`, `sessions`, `notion`, `models`, `gemini`, `api` (connection tests), `processing`, `capture`, `updater`, `ffmpeg`.
- **Audio capture** has two paths: the primary path has the renderer capture system audio via Electron's display-media loopback + mic via Web Audio, streaming chunks to main over `capture:chunk` IPC which appends them to an in-progress `.webm` on disk; on stop, `convertWebmToWav()` (`electron/audio/recorder.js`, ffmpeg-backed) produces the final `.wav`. If renderer capture fails to start, `handleStartRecording()` falls back to direct ffmpeg dshow capture (mic + Stereo Mix).
- **Processing pipeline** (`runProcessingPipeline` in `main.js`): Stage 1 transcription (`electron/services/transcription.js`) is pluggable — Google STT v1/v2, AssemblyAI, or Sarvam AI (`saaras:v3`, needed for English/Malayalam code-switching) selected via `config.sttService`. Stage 2 (`electron/services/gemini.js`) turns the transcript into structured JSON notes or executive Markdown, depending on `noteOutputMode`. Stage 3 (`electron/services/notion.js`) is optional and only runs if a Notion token + page ID are configured. Progress is pushed to the renderer (`processing:progress`) and to the extension (WS broadcast) at each stage.
- **Persistence**: `electron/db/sessions.js` uses `sql.js` (SQLite compiled to WASM) held in memory and rewritten to a single file on every mutation — there's no migration system, schema is `CREATE TABLE IF NOT EXISTS`. `electron/utils/config.js` wraps `electron-store` for settings/API keys.
- **Desktop ↔ extension bridge**: `electron/websocket-server.js` runs a local WS server, scanning ports 39842–39852 until one is free, and only accepts connections with a `chrome-extension://` origin. The extension's service worker (`extension/background.js`) probes the same port range, sends `START_RECORDING`/`STOP_RECORDING`/`APP_STATUS`, and relays `RECORDING_STARTED`/`PROCESSING_PROGRESS`/`PROCESSING_COMPLETE` broadcasts to the floating overlay injected into Meet/Zoom tabs by `extension/content.js` + `extension/overlay/`.
- **Renderer** (`renderer/app.jsx`): no router, just view-state switching between `Dashboard.jsx` (session list), `NoteViewer.jsx`/`TranscriptViewer.jsx` (a completed session), `Settings.jsx` (API keys, service selection, FFmpeg install flow, onboarding), and `LogsViewer.jsx` (tails `electron/utils/logger.js` output via the `log:entry` IPC event).
- **Build/package**: Vite builds the renderer into `dist/renderer/`; `scripts/build-extension.js` zips `extension/` into `dist/meetmind-extension.zip`; `electron-builder.yml` packages the Windows NSIS installer, pulling ffmpeg in as `extraResources` (never bundled in the asar) — it's either committed locally to `assets/ffmpeg/` or downloaded at runtime via the `ffmpeg:install` IPC handler, which fetches a build from gyan.dev.

## Commands

No lint or test script exists in this repo — verify changes by running the app (`npm run dev`) and exercising the affected flow directly.

- `npm install` — install dependencies (Node 20+, Windows only)
- `npm run dev` — full dev loop: regenerates icons + rebuilds the Chrome extension (`predev`), then runs Vite and Electron concurrently. Renderer serves at http://localhost:5173; Electron opens DevTools automatically in dev
- `npm run dev:renderer` — Vite dev server only
- `npm run dev:electron` — Electron only (expects `dev:renderer` already running on :5173)
- `npm run build:ext` — rebuild just `dist/meetmind-extension.zip` from `extension/` via `scripts/build-extension.js`
- `npm run build:dir` — production renderer build + unpacked Electron app under `dist/desktop/` (fast iteration, skips installer packaging)
- `npm run build` — full production build: Vite build + electron-builder NSIS installer (`dist/desktop/MeetMind-Setup-X.Y.Z.exe`). Requires `assets/ffmpeg/ffmpeg.exe`, `assets/ffmpeg/ffprobe.exe`, and `assets/icons/icon.ico` to already exist (not committed — download FFmpeg from the app's Settings screen or gyan.dev/ffmpeg/builds)
- `npm run generate-icons` — regenerate `assets/icons/*` from the source icon

## Learned Workspace Facts

- MeetMind renderer uses React + Tailwind; theming is driven by CSS variables in `renderer/styles/globals.css` and Tailwind `darkMode: 'class'` with `<html class="dark">` in `renderer/index.html`.
- Prefer using CSS variables (`--color-*`) with Tailwind arbitrary values like `bg-[rgb(var(--color-background))]` instead of hardcoded hex colors for consistent theming.
- Electron packaging must include `dist/renderer/**` in `package.json` `build.files`; otherwise the installed app can open a blank window because `dist` is gitignored.
- Prevent duplicate running instances/tray icons by using `app.requestSingleInstanceLock()` in `electron/main.js` and focusing the existing window on `second-instance`.
- Don’t commit bundled FFmpeg `.exe` binaries over GitHub’s 100MB limit; keep them ignored or manage them via Git LFS / external download.
- Meetings commonly include both English and Malayalam, so transcription and language models should support code-switching between these languages.
