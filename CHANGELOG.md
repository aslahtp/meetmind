---
tags: [meta, changelog]
updated: 2026-08-18
---
# Changelog

Chronological log of notable changes to the project. Newest first. This is a human-curated log — not a mirror of `git log`.

## [2.3.0] - 2026-08-18

### Added
- Post-update integrity check: after an update installs, MeetMind verifies bundled FFmpeg/FFprobe are actually present and shows a "Repair Now" banner in Settings if they're missing, instead of failing silently mid-recording.
- Updates now require an explicit "Download Update" and "Restart & Install" click each — nothing downloads or installs itself in the background anymore.
- Background update checks pause automatically after 3 consecutive failures (shown in Settings) and resume as soon as a manual "Check for Updates" succeeds, instead of retrying silently forever.
- Update download progress (percent, transferred/total, speed) now shows live in Settings, matching the FFmpeg install progress UI.

### Fixed
- Settings' "You're up to date" and update-error messages never rendered because they checked status/field names (`up-to-date`, `.error`) that didn't match what the updater actually reports (`not-available`, `.errorMessage`).
- Live updater status (checking/available/downloading/downloaded/error) now pushes to Settings in real time instead of only refreshing on the screen's own button clicks, so a background check or download is reflected immediately.

## [2.2.1] - 2026-08-18

### Fixed
- Release workflow now downloads real FFmpeg/FFprobe binaries into `assets/ffmpeg/` before packaging; previously the CI-built installer shipped without them (the folder is gitignored and never populated on a fresh checkout), so every GitHub-released build — including auto-updates — reported FFmpeg as missing despite `npm run dev` working locally.

## [2.2.0] - 2026-08-18

### Added
- **Hide Logs toggle in Settings** — Added a preference to remove the Logs viewer button from the sidebar menu to reduce clutter.

## [2.1.1] - 2026-08-18

### Fixed
- FFmpeg/ffprobe resolution now falls back to the system PATH when bundled binaries are absent; recorder, device list, file conversion, and duration probing all use the same bundled-first → system PATH order as the Settings status check, so "found" in Settings always means recording will actually work.

## [2.1.0] - 2026-08-18

### Added
- **System Dependencies section in Settings** — "Check Status" button detects bundled FFmpeg/ffprobe or system PATH and shows version + source per binary.
- **In-app FFmpeg installer** — "Download & Install FFmpeg" button downloads `ffmpeg.exe` + `ffprobe.exe` from Gyan.dev (~80 MB), extracts via PowerShell, and copies them to the correct app directory; shows a live progress bar with stage labels and a Retry button on failure.

## [2.0.18] - 2026-08-15

### Added
- Animated card deletion in Dashboard — multi-phase exit animation with crimson glow, slide-and-swish dissolve, height collapse, and active spinner feedback when deleting a meeting card.

## [2.0.17] - 2026-08-14

### Added
- Floating glassmorphic tooltips for output-mode toggle buttons — replaced the static text box with sleek floating hover popovers directly on the JSON and Markdown toggle buttons.

## [2.0.16] - 2026-08-14

### Added
- Tooltips and helper explanations for note output formats — descriptive tooltips and a context helper banner in Settings clarifying the distinction between JSON and Markdown output modes.

## [2.0.15] - 2026-08-13

### Changed
- Updated default Markdown system prompt to the comprehensive Executive Assistant & Meeting Documentation Specialist prompt with structured headers, action items table, and strict H1 heading guidelines.

## [2.0.14] - 2026-08-12

### Added
- Restored AI system prompt & transcription guidance in Settings — re-added the Gemini System Prompt editor with JSON vs Markdown output switcher and Reset to Default control, plus the optional AssemblyAI domain terms guidance prompt.

## [2.0.13] - 2026-08-11

### Added
- 3-second auto-refresh in Live Mode — automatic background polling synchronization in the Logs Viewer when Live Mode is active, complementing instant IPC event streaming.

## [2.0.12] - 2026-08-10

### Changed
- Icon-only header action bar in Logs Viewer — redesigned top action bar with icon-only buttons and informative tooltips for a clean, compact toolbar.

## [2.0.11] - 2026-08-10

### Fixed
- Single-row Logs Viewer toolbar — applied `whitespace-nowrap` and `shrink-0` so filter chips, search bar, and controls stay aligned on a single row without wrapping.

## [2.0.10] - 2026-08-09

### Added
- "Hide Extension Logs" filter toggle in the Logs Viewer toolbar to suppress Chrome extension heartbeat and WebSocket status logs.

## [2.0.9] - 2026-08-09

### Added
- Real-time log streaming & structured viewer — wired `log:entry` live IPC event streaming from the main process to the renderer; added structured log parsing and `getHistory` fallback in `logger.js` and `preload.js`.

## [2.0.8] - 2026-08-08

### Added
- Multi-version release notes generator script (`scripts/generate-release-notes.js`) to parse and bundle changelog entries between the new release and the last published GitHub tag.

## [2.0.7] - 2026-08-07

### Fixed
- Symmetrical sidebar bottom spacing — removed compounding `pb-6` on `<aside>` and set uniform `py-3` padding on the recording CTA section.

## [2.0.6] - 2026-08-07

### Changed
- Theme-aware Sarvam AI logo — `SarvamIcon` now loads `sarvam-dark.svg` with `dark:invert` for correct contrast in both themes.

## [2.0.5] - 2026-08-06

### Changed
- Conditional Save button in Settings — the "Save Changes" button now only appears when there are actual unsaved changes (`isDirty`).

## [2.0.4] - 2026-08-06

### Changed
- Refined sidebar theme control — cleaned up the theme toggle button label and badge to eliminate duplicate words.

## [2.0.3] - 2026-08-05

### Fixed
- Notion page upload & ID normalization — fixed child page creation payload structure for Notion Pages; added `normalizeNotionId` to handle full URLs or raw UUIDs; improved connection testing to support both Notion Pages and Databases.

## [2.0.2] - 2026-08-04

### Fixed
- Notion token and config persistence — `notionApiKey` was not being persisted due to schema mismatch with `notionToken`; updated `config.js` to register both aliases and keep them synchronized.
- Atomic config updates — Settings save now uses `config.setMultiple` and properly awaits completion.

### Added
- Dynamic app version display — `window.meetmind.app.getVersion()` wired through IPC to reflect the package version automatically in Settings.

## [2.0.1] - 2026-08-03

### Fixed
- STT service card grid overflow — changed to a responsive breakpoint grid so badges and radio buttons no longer clip in narrower windows.
- Radio button dot invisible on light theme — selected-state inner dot corrected to `bg-white dark:bg-zinc-950`.
- Titlebar clearance for sidebar & main content areas.
- Theme toggle active states in Settings — System/Light/Dark buttons now show distinctly colored active rings in both themes.
- Preferences section divider — replaced mixed border classes with a clean horizontal rule.

### Changed
- Centered Settings content area — added `mx-auto` and `w-full` to center the `max-w-3xl` block.
- Removed dead bottom padding on main content area.

## [2.0.0] - 2026-08-01

### Added
- Full light & system theme support — clean light theme palette alongside the obsidian dark theme, with a System (Auto) option that follows OS preference.
- Dynamic OS theme sync — responds to Windows dark/light mode switches in real time via `prefers-color-scheme`.
- Sidebar & Settings theme controls — 3-way controls (System / Light / Dark) with instant visual feedback.
- Persistent theme configuration — user's theme choice is stored in `electron-store` and restored on startup.

### Changed
- Complete component adaptation sweep — overhauled all UI components for crisp contrast in both themes while preserving exact dark theme styling.
- Theme-aware service brand icons — Notion and other icons adapt between dark and light modes.

## [1.7.1] - 2026-07-28

### Fixed
- Release asset filename mismatch for auto-updates — set explicit hyphenated `artifactName` in `electron-builder.yml` to prevent GitHub Releases from replacing spaces with dots, resolving 404 download errors in `electron-updater`.
- Restricted workflow artifact uploads to `dist/desktop/latest.yml` only.

## [1.7.0] - 2026-07-25

### Added
- Gemini 3.7 Flash support — enabled `gemini-3.7-flash` as the primary default AI model for meeting notes summarization.

## [1.6.2] - 2026-07-22

### Fixed
- Unhandled rejection on update download failure — attached `.catch()` to the internal `downloadPromise` in `electron-updater` so rejections no longer escape to the global handler.
- Friendly auto-update error messages — raw 404 URLs replaced with readable messages.
- Service brand icons from asset files — replaced inline SVG components with image imports from `assets/icons/services/` for correct bundling in the packaged app.

## [1.6.1] - 2026-07-20

### Added
- Provider brand icons across Settings — vector SVG icons for Google Cloud STT, Sarvam AI, AssemblyAI, Gemini, and Notion in API keys and service cards.

## [1.6.0] - 2026-07-18

### Added
- Seamless GitHub Releases auto-updates via `electron-updater` — detects, downloads, and applies new releases in the background.
- Background update scheduler & tray notifications — checks run 6 s after launch and every 4 h; tray menu surfaces a "Restart to Update" action when ready.
- Application Updates section in Settings with version badge, Check for Updates button, download progress bar, and automatic updates toggle.
- Update notification toast banner — floating non-intrusive banner with 1-click "Restart & Update" and "Later" actions.
- CI/CD release metadata publishing — `latest.yml` published alongside `.exe` and `.blockmap` for update discovery.

## [1.5.2] - 2026-07-15

### Fixed
- "Object has been destroyed" crash in background mode — resolved when the Chrome extension connected while MeetMind was minimized to tray.
- Protected window lifecycle & IPC dispatching — centralized `sendToRenderer` helper with `isDestroyed()` checks and try-catch safety.
- Window close & single-instance tray management — closing the window cleanly hides to tray without premature `app.isQuitting`.
- Added global `uncaughtException` and `unhandledRejection` guards in the main process.

## [1.5.1] - 2026-07-12

### Changed
- Updated README.md.

## [1.5.0] - 2026-07-10

### Added
- Automated GitHub Actions CI/CD release pipeline — triggers on `package.json` version bump, compiles Windows installer, blockmap, and Chrome extension zip, and publishes to GitHub Releases.
- Templated release description — workflow populates `.github/release_template.md` with version placeholders and extracted changelog entries.
- Cross-platform extension packaging — `scripts/build-extension.js` with PowerShell on Windows, `zip` on Linux/macOS.
- Automated versioning & changelog rule added to `AGENTS.md`.

## [1.4.0] - 2026-07-05

### Added
- Executive Assistant Markdown prompt — default system prompt for Markdown output mode with structured headers, action items table, and next-steps section.
- Dual output mode (JSON / Markdown) — toggle pill in Settings, persisted in `electron-store`.
- Rich prose Markdown viewer — auto-detects `_rawMarkdown` in `NoteViewer.jsx` and renders full markdown with tables, nested bullets, checklists, and inline formatting.
- Native Notion API Markdown upload — converts raw markdown notes directly into native Notion page blocks.
- Smart transcript reuse — `runProcessingPipeline` reuses existing transcript from SQLite to avoid redundant STT API calls on retry.

## [1.3.0] - 2026-06-28

### Added
- Multi-service STT & Gemini integration — AssemblyAI and Sarvam AI (Malayalam-English code-switching) providers, dynamic Gemini model selector, WASAPI audio device probing, and API connection testing in Settings.
- Onboarding guide accordion in Settings for Google Cloud, Sarvam AI, AssemblyAI, Gemini, and Notion setup.
