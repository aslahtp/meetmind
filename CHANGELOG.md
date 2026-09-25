---
tags: [meta, changelog]
updated: 2026-09-25
---
# Changelog

Chronological log of notable changes to the project. Newest first. This is a human-curated log — not a mirror of `git log`.

## [3.6.2] - 2026-09-25

### Added

- `pnpm run lint` (ESLint) and `pnpm run test` (Vitest) for contributors, with tests for note Markdown export/parsing, formatting helpers and PDF file naming.
- CI on every pull request and push to `main`: lint, tests, build, secret scanning, dependency audit, CodeQL, dependency review and a version/changelog check. Releases are only built when these pass.

### Changed

- Updated Electron to 33.4.11 and runtime dependencies to patched versions, resolving 22 high-severity security advisories.
- Development now requires Node.js 22.12 or newer.

## [3.6.1] - 2026-09-25

### Fixed

- Inline `code` in notes now uses the muted body-text color and a faint border instead of high-contrast ink, so it no longer stands out from the surrounding text.

## [3.6.0] - 2026-09-25

### Added

- Edit a meeting’s notes as Markdown from the Summary tab’s new Preview / Markdown toggle, which stays pinned as icons in the top-right corner while you scroll (can be turned off in Settings → General); structured notes keep their card layout, and saved edits carry through to Copy, PDF export and Notion.
- Meetings with edited notes show an “Edited” chip, and leaving with unsaved edits asks before discarding them.

### Changed

- Ticked action items (`- [x]`) are kept in copied Markdown and shown as done.

## [3.5.1] - 2026-09-25

### Changed

- Settings tabs now show an icon on the active tab, which slides in and out smoothly as you switch, matching the top navigation.
- Every Settings section card now has an icon beside its title (brand logos for Gemini and the selected speech-to-text service).
- The Summary / Transcript / Audio tabs on a meeting page are now centred in the toolbar, regardless of the title and action buttons beside them.

## [3.5.0] - 2026-09-25

### Added

- Export PDF on a meeting page: saves the notes as `date-time-title.pdf` (e.g. `2026-09-25-1430-Weekly-standup.pdf`) with the same Markdown rendering as the app, including tables, task lists, code and links; an existing file is never overwritten.
- Settings → Notes → PDF export: choose the save folder (Downloads by default) and whether to include the timestamped transcript.

### Fixed

- Copied Markdown now includes each action item's priority and plain-text status updates, which were previously dropped.
- The Google Calendar icon shows its tile, folded corner and "31" again instead of a solid square, in both themes.
- Re-syncing or regenerating notes no longer leaves duplicate pages in Notion: the meeting's previous page is moved to Notion's trash once the new one is created.

### Changed

- Back from a meeting returns the Dashboard or Meetings list to where you were scrolled, and Meetings keeps its search and filter; the top-bar tabs still open pages at the top.
- The meeting toolbar's Notion control is one pill marked by the Notion logo, with "Open" and a labelled "Update" that confirms before replacing the page, instead of an unlabelled Notion logo button.

## [3.4.0] - 2026-09-25

### Added

- Top-bar processing status animates in and out: it slides out from behind the Record button, fills with progress, eases between stage labels, briefly shows "Notes ready" or "Failed", then tucks away.
- The status pill fits the space available: full label on wide windows, spinner and percentage on narrower ones, and the spinner alone at the smallest size (details in its tooltip).

### Fixed

- Retrying a failed meeting reuses its saved transcript instead of running speech-to-text again; transcription only re-runs when there is no usable transcript.
- Retry and Generate notes now work for meetings that have a transcript but no audio, such as pasted transcripts.
- An expired or revoked Google Calendar connection no longer logs an error every minute: after one warning, the app retries Google once a day (showing "reconnect in Settings" in between) and resumes sync on its own if the connection works again.
- The extension's 10-second status heartbeat is no longer written to the logs.

### Changed

- Top bar: the theme switch now sits to the left of the processing status and Record button.
- Top bar fits at the minimum window width: tighter spacing below 1024px so the window controls are no longer pushed off the edge.
- Dashboard bar: the meeting count is centred in the space between the greeting and the actions.

## [3.3.0] - 2026-09-25

### Added

- Opening Settings → System now checks for app updates automatically (at most once a minute, and not while an update is already available, downloading or ready to install).
- The selected page in the top bar now shows an icon next to its name, which slides in smoothly as you switch pages.

## [3.2.0] - 2026-09-24

### Changed

- New app icon everywhere (window, taskbar, tray, installer, notifications and the Chrome extension): the outlined mic tile from the app's top bar, replacing the old green microphone.
- Icons at 16–24px use a bolder variant so the mic stays legible in the tray, and large icon sizes are rendered sharper.

## [3.1.0] - 2026-09-24

### Changed

- Meeting page header is now a single slim toolbar (back, Summary/Transcript/Audio tabs, Copy, Regenerate, Notion), so notes get most of the window.
- The meeting title, date and tags scroll away with the notes, and the title reappears in the toolbar once scrolled past.
- Markdown notes no longer repeat the meeting title as their first heading.
- Switching between Summary, Transcript and Audio starts at the top of the page.
- Logs page header is now a single toolbar (level filter, search, and icon buttons for the extension-log filter, auto-scroll, live updates, reload, folder, copy, export and clear), and the log panel uses the full window width.
- Dashboard: the greeting and Paste transcript / Import audio actions moved into a slim toolbar, the four stat cards became one compact strip, and section spacing is tighter so recent recordings start higher.
- Meeting cards on the Dashboard and Meetings list are more compact.

## [3.0.0] - 2026-09-24

### Changed

- Redesigned the whole app and Chrome extension in a "paper notebook" style: cream canvas, ink hairline borders, DM Sans, one yellow primary action per view, and no shadows or gradients.
- Navigation moved from the sidebar to a top bar with the wordmark, page tabs and a Record button.
- Settings is split into tabs (General, Transcription, Notes, Integrations, System), with a "How to get a key" guide next to each API key field.
- Light is now the default theme. The dark theme is derived from the same design tokens, and an explicitly saved Dark or System choice is kept.
- Brand and platform logos are monochrome, and status is shown with dots and text instead of colored badges.
- Development and release builds now use pnpm instead of npm (`pnpm install`, `pnpm run dev`, `pnpm run build`).

### Added

- Meetings: search, plus filters for All / Needs attention / Processing / In Notion.
- Top-bar processing indicator that shows the pipeline stage and percentage; click it to open the meeting.
- Settings: an unsaved-changes bar with Save and Discard, and a prompt before leaving with unsaved edits.
- In-app confirmation dialogs for deleting a meeting, regenerating notes, disconnecting Google Calendar and clearing logs.
- Dashboard: an inline setup checklist when API keys are missing, replacing the floating onboarding banner.

### Fixed

- Keyboard focus is now visible everywhere. Dialogs, tabs, switches and radio groups can be used with the keyboard and have proper ARIA roles.
- A meeting that is already processing no longer offers "Generate notes", which prevented starting a second run.
- The logs Live view no longer overwrites streamed entries with its periodic refresh, and it only auto-scrolls when you are at the bottom.
- "Copy as Markdown" now includes section-based notes and action items that have no `task` field.
- The recording timer no longer resets to zero when the recording bar re-renders.
- The session card delete button is no longer nested inside another button, and failed meetings show "Processing failed" with a Retry action.

## [2.12.0] - 2026-09-22

### Added

- Dashboard: "Paste Transcript" button opens a modal to create a meeting session from pasted text, skipping STT and generating AI notes directly via Gemini.

## [2.11.0] - 2026-09-17

### Added

- Gemini: added `gemini-3.8-flash`, now the default note-generation model.

### Removed

- Gemini: dropped `gemini-3.6-flash`, `gemini-3.5-flash`, and `gemini-3.1-flash-lite` from the selectable model list. Existing configs pointing at these are automatically migrated to a supported model.

## [2.10.0] - 2026-09-18

### Added

- Settings: configurable secondary (fallback) Gemini model, automatically retried when the primary model call fails.
- Toast notification shown when a session's notes were generated by the fallback model instead of the primary one.
- Per-meeting notes page: small badges showing which Gemini model and which transcription (STT) service generated that session's notes.

## [2.9.0] - 2026-08-26

### Added

- Settings: option to skip transcript upload to Notion when syncing meeting notes.

## [2.8.0] - 2026-08-25

### Added

- Dashboard: configurable number of recent meetings shown (5 / 10 / 15) via Settings → Preferences & Appearance.
- Dashboard: "View All Meetings" button below the recent session cards, shown when sessions exceed the configured limit.
- `dashboardRecentLimit` persisted config key (default: 5).

## [2.7.0] - 2026-08-24

### Added

- `react-markdown` + `remark-gfm` dependency for full CommonMark + GFM rendering in the per-meeting Markdown notes view.

### Changed

- Per-meeting page: replaced the hand-rolled markdown parser with `react-markdown`, giving proper spacing for headings, paragraphs, lists, blockquotes, tables, code blocks, task lists, and inline formatting.

## [2.6.2] - 2026-08-24

### Changed

- Dashboard: replaced the "Action Items" stat card with "This Week" — total recording time from the current Mon–Sun week.

## [2.6.1] - 2026-08-24

### Changed

- Dashboard: upcoming meetings and past session cards now share a single scrollable list; the upcoming meetings section is no longer a fixed block above the scroll area.

## [2.6.0] - 2026-08-23

### Added

- New "Meetings" sidebar page listing every recorded session, with the same toolbar as before (refresh, import file, new recording, per-card delete).

### Changed

- Dashboard now shows only the 5 most recent meetings, with a "View all" link to the new Meetings page; the stats bar and Google Calendar "Upcoming Meetings" widget continue to reflect the full session history.

## [2.5.0] - 2026-08-23

### Added

- Google Calendar integration: connect via OAuth 2.0 in Settings, view upcoming meetings on the Dashboard in a collapsible "Upcoming Meetings" section, and receive system notifications with a "Start Recording" prompt when a scheduled meeting begins.
- New `UpcomingMeetings` dashboard component showing today's and tomorrow's events grouped by day, with Join and Record buttons for live/upcoming meetings.
- Google Calendar setup guide in Settings onboarding (step 5) with OAuth Client ID/Secret fields and Connect/Disconnect flow.

## [2.4.1] - 2026-08-19

### Fixed

- "Hide logs from sidebar" setting now actually hides the sidebar Logs item — `getConfig()` was missing `hideLogsInSidebar` from its returned object (and the electron-store schema), so the saved value never reached the renderer.

## [2.4.0] - 2026-08-18

### Added

- Dashboard shows skeleton placeholders (sized to match the real header, stat tiles, and session cards) when the initial session list is slow to load. Loads that finish quickly (the normal case) go straight to content, so the skeleton never appears as a flash of its own.

### Fixed

- Eliminated the light/dark theme flash on startup: main passes the saved theme to the renderer via `additionalArguments` and preload applies it to `<html>` before first paint. The window's own `backgroundColor` now also follows the saved theme instead of always being dark.
- Startup no longer leaves the dashboard stuck on placeholders if a config/session IPC call fails or never settles — the loading state now clears on every path, with a failsafe timeout.
- Preload now exposes the `window.meetmind` bridge before doing any cosmetic startup work, and the theme code can no longer throw. Previously a failure there aborted the whole preload script, leaving the app with no session list, no saved settings, and dead window controls while in-app navigation still worked.

## [2.3.1] - 2026-08-18

### Fixed

- Sidebar nav items no longer shift by a couple pixels when switching pages — the active item's border was only reserved on `.active`, changing its box height relative to inactive items.

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
