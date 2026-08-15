---
tags: [meta, changelog]
updated: 2026-08-15
---
# Changelog

Chronological log of notable changes to the project. Newest first. This is a human-curated log — not a mirror of `git log`.

## v2.0.8

- **Multi-Version Release Notes Generator** — created `scripts/generate-release-notes.js` to reliably parse and bundle all changelog entries between the new release and the last published release tag on GitHub, eliminating shell string escaping issues in CI/CD.

## v2.0.7

- **Symmetrical Sidebar Bottom Spacing** — removed the compounding `pb-6` on `<aside>` and set uniform `py-3` padding on the recording CTA section so top and bottom margins around the button are equal.

## v2.0.6

- **Theme-Aware Sarvam AI Logo** — updated `SarvamIcon` to load `sarvam-dark.svg` with `dark:invert`, providing a dark logo in light mode and automatically inverting to white in dark mode.

## v2.0.5

- **Conditional Save Button in Settings** — the "Save Changes" button now only appears when there are actual unsaved changes in the Settings form (`isDirty`), or during the active saving/saved feedback cycle.

## v2.0.4

- **Refined Sidebar Theme Control** — cleaned up the theme toggle button in the sidebar to clearly label the control as `"Theme"` with dynamic icon (`Monitor` / `Sun` / `Moon`) and distinct `"System"`, `"Light"`, or `"Dark"` badge, eliminating duplicate words.

## v2.0.3

- **Fixed Notion Page Upload & ID Normalization** — fixed child page creation payload structure when the parent is a Notion Page (`properties.title.title` instead of direct array assignment); added `normalizeNotionId` to extract IDs from full URLs or raw UUIDs; enhanced connection testing and UI to explicitly support both Notion Pages and Databases.

## v2.0.2

- **Fixed Notion Token and Config Persistence** — resolved an issue where `notionApiKey` was not being persisted to `electron-store` due to schema mismatch with `notionToken`; updated `config.js` to register both aliases and keep them synchronized alongside `geminiModel`/`selectedModel`, `systemPrompt`/`geminiSystemPrompt`, and `promptOutputMode`/`noteOutputMode`.
- **Atomic Config Updates** — updated Settings save flow in `app.jsx` to use `window.meetmind.config.setMultiple` and properly await completion.
- **Dynamic App Version Display** — wired `window.meetmind.app.getVersion()` through IPC to automatically reflect the package version in Settings.

## v2.0.1

- **Fixed STT Service Card Grid Overflow** — changed the 3-column grid (`grid-cols-3`) on the STT engine selection to a responsive `sm:grid-cols-2 lg:grid-cols-3` breakpoint grid so the "Key Set" / "No Key" badges and radio buttons no longer clip in narrower windows.
- **Fixed Radio Button Dot Invisible on Light Theme** — the selected-state radio indicator inner dot was hardcoded `bg-zinc-950` (dark only); corrected to `bg-white dark:bg-zinc-950` for proper contrast in both themes.
- **Centered Settings Content Area** — added `mx-auto` and `w-full` to the Settings scroll container so the `max-w-3xl` content block is centered rather than left-aligned.
- **Fixed Titlebar Clearance for Sidebar & Main** — bumped sidebar top padding from `pt-3` to `pt-8` and main content from `pt-0` to `pt-8` so no content is hidden behind the fixed `h-8` custom titlebar overlay.
- **Improved Theme Toggle Active States** — System/Light/Dark buttons in Settings now show distinctly colored active rings (`ring-1`) in both light and dark mode; Moon icon uses correct `dark:text-emerald-400` for dark-mode contrast.
- **Fixed Preferences Section Divider** — replaced mixed `dark:border-b` / `dark:border-[#2a2a2a]` divider with clean `bg-slate-200 dark:bg-zinc-800/80` horizontal rule.
- **Removed Dead Bottom Padding on Main Content Area** — `pb-6` was applying invisible space below all views; removed since each view manages its own scroll/padding.

## v2.0.0

- **Added Full Light & System Theme Support** — added a clean light theme palette alongside the obsidian dark theme, with a new **System (Auto)** option that follows the OS / Windows theme preference.
- **Dynamic OS Theme Sync** — automatically responds to Windows dark/light mode switches in real time when set to System theme via `prefers-color-scheme`.
- **Sidebar & Settings Theme Controls** — added 3-way theme controls (System / Light / Dark) in Settings and quick cycling via the Sidebar footer button with instant visual feedback.
- **Persistent Theme Configuration** — user's theme choice (`system`, `light`, or `dark`) is stored in `electron-store` and restored automatically on startup.
- **Complete Component Adaptation Sweep** — overhauled all UI components (Dashboard, NoteViewer, Settings, LogsViewer, TranscriptViewer, RecordingBar, ProcessingOverlay, TitleBar, and Sidebar) for crisp contrast in both light and dark themes while preserving the exact dark theme styling.
- **Theme-Aware Service Brand Icons** — updated brand icons like Notion to adapt seamlessly between dark and light modes.

## v1.7.1

- **Fixed Release Asset Filename Mismatch for Auto-Updates** — set explicit hyphenated `artifactName: "${productName}-Setup-${version}.${ext}"` in `electron-builder.yml` to prevent GitHub Releases from replacing spaces with dots in download URLs (`MeetMind.Setup.1.7.0.exe`), resolving 404 download errors in `electron-updater`.
- **Cleaned Up Release Asset Uploads** — restricted workflow artifact uploads to `dist/desktop/latest.yml` to avoid uploading unnecessary `builder-debug.yml`.

## v1.7.0

- **Added Gemini 3.7 Flash Support & Made It Default** — enabled `gemini-3.7-flash` across MeetMind as the primary default AI model for meeting notes summarization and structured generation, providing top quality with fast response times.

## v1.6.2

- **Fixed Unhandled Rejection on Update Download Failure** — `electron-updater` with `autoDownload=true` internally returns a `downloadPromise` that rejects on failure (e.g. 404); attached a `.catch()` to it so the rejection no longer escapes to the global unhandled rejection handler while the `error` event continues to own user-visible state.
- **Friendly Auto-Update Error Messages** — sanitized raw error messages in the updater service; `Cannot download ...` 404 URLs are now replaced with readable messages like "Unable to download update. The release may not be ready yet — please try again later."
- **Service Brand Icons from Asset Files** — replaced all hand-crafted inline SVG icon components with image imports from `assets/icons/services/` using Vite's `@assets` alias, ensuring correct bundling and loading in the packaged app.

## v1.6.1

- **Provider Brand Icons Across Settings** — added vector SVG brand icons for Google Cloud STT, Sarvam AI, AssemblyAI, Google Gemini, and Notion across the API Keys onboarding table/accordion, service configuration cards, and field labels for a consistent and branded UI experience.

## v1.6.0

- **Integrated Seamless GitHub Releases Auto-Updates** — added `electron-updater` integration that automatically detects, downloads, and applies new releases in the background from GitHub Releases (`aslahtp/meetmind`).
- **Background Update Scheduler & Tray Notifications** — automated update checks run 6s after launch and periodically every 4 hours; tray menu dynamically surfaces a prominent "Restart to Update" action when an update is downloaded.
- **Application Updates Settings Card** — added a dedicated "Application Updates" section in Settings with current version badge, "Check for Updates" button, real-time download progress bar, update ready status, and an automatic update checks toggle.
- **Update Notification Toast Banner** — non-intrusive floating toast banner notifies the user when an update is ready with 1-click "Restart & Update" and "Later" actions.
- **CI/CD Release Metadata Publishing** — updated `.github/workflows/release.yml` and `electron-builder.yml` to publish `latest.yml` metadata alongside `.exe` and `.blockmap` artifacts for update discovery.

## v1.5.2

- **Fixed "Object has been destroyed" Crash in Background Mode** — resolved uncaught main process exception when the Chrome extension connected or sent messages while MeetMind was minimized/hidden to tray.
- **Protected Window Lifecycle & IPC Dispatching** — added centralized `sendToRenderer` helper with `isDestroyed()` checks and try-catch safety across all IPC and WebSocket events.
- **Fixed Window Close & Single-Instance Tray Management** — corrected custom titlebar close handling so closing the window cleanly hides to tray without prematurely setting `app.isQuitting` and leaving stale destroyed window handles.
- **Added Main Process Exception Handlers** — attached global `uncaughtException` and `unhandledRejection` guards to log unexpected runtime errors instead of surfacing fatal error dialogs.

## v1.5.1

- Updated the README.md file.

## v1.5.0

- **Automated GitHub Actions CI/CD Release Pipeline** — added `.github/workflows/release.yml` workflow that automatically triggers on `package.json` version bump, compiles Windows installer (`.exe`), NSIS blockmap (`.blockmap`), and Chrome extension zip (`meetmind-extension.zip`), and publishes them to GitHub Releases.
- **Templated Release Description Integration** — workflow dynamically populates `.github/release_template.md` with version placeholders (`{VERSION}`, `x.y.z`) and extracted changelog entries (`{CHANGELOG_BODY}`) for rich release notes on GitHub.
- **Cross-Platform Extension Packaging** — updated `scripts/build-extension.js` with cross-platform fallback support (`powershell` on Windows, `zip` on Linux/macOS).
- **Automated Version & Changelog Rule** — added learned workflow rule in `AGENTS.md` requiring package version bumps and `CHANGELOG.md` updates for all moderate to major changes.

## v1.4.0

- **Executive Assistant Markdown Prompt** — default system prompt for Markdown output mode configured with a 10+ year Executive Assistant & Documentation Specialist prompt structure (Header, Executive Summary, Key Discussion Points, Key Decisions, Action Items table, Next Steps).
- **Dual Output Mode (JSON / Markdown)** — toggle pill in Settings (`JSON` / `Markdown`) allowing choice between structured JSON and prose Markdown notes. Persisted in `electron-store` schema and `config.js` (`noteOutputMode`).
- **Rich Prose Markdown Viewer** — auto-detects `_rawMarkdown` in `NoteViewer.jsx` and renders full markdown with custom HTML tables, multi-level nested sub-bullets, checklist task items, blockquote cards, inline bold/italic/links/code, and top header metadata badges (`JSON` / `Markdown`).
- **Native Notion API Markdown Upload** — converts raw markdown notes directly into native Notion page blocks, native Notion `table` / `table_row` blocks, nested `bulleted_list_item` children trees, and rich_text annotations for inline formatting (`parseMarkdownRichText`).
- **Smart Transcript Reuse** — `runProcessingPipeline` checks for an existing session transcript in SQLite to prevent re-triggering Speech-to-Text API calls when notes generation fails or is retried.

## v1.3.0

- **Multi-Service STT & Gemini Integration** — added AssemblyAI and Sarvam AI (native Malayalam-English code-switching) Speech-to-Text providers, dynamic Gemini model selector (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, etc.), WASAPI audio device probing, and API connection testing in Settings.
- **Onboarding Guide & UI Integration** — step-by-step API setup guide accordion in Settings for Google Cloud, Sarvam AI, AssemblyAI, Gemini, and Notion.
