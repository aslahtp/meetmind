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

## Learned Workspace Facts

- MeetMind renderer uses React + Tailwind; theming is driven by CSS variables in `renderer/styles/globals.css` and Tailwind `darkMode: 'class'` with `<html class="dark">` in `renderer/index.html`.
- Prefer using CSS variables (`--color-*`) with Tailwind arbitrary values like `bg-[rgb(var(--color-background))]` instead of hardcoded hex colors for consistent theming.
- Electron packaging must include `dist/renderer/**` in `package.json` `build.files`; otherwise the installed app can open a blank window because `dist` is gitignored.
- Prevent duplicate running instances/tray icons by using `app.requestSingleInstanceLock()` in `electron/main.js` and focusing the existing window on `second-instance`.
- Don’t commit bundled FFmpeg `.exe` binaries over GitHub’s 100MB limit; keep them ignored or manage them via Git LFS / external download.
- Meetings commonly include both English and Malayalam, so transcription and language models should support code-switching between these languages.
