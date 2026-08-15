## Learned User Preferences

- For every changes (apart from minor changes), bump the version number (1.0.0 for major, 0.1.0 for moderate and 0.0.1 for minor changes)in `package.json` and document the changes under a new version heading in `CHANGELOG.md`. Keep the changelog concise and avoid duplicate or near-duplicate points.

## Learned Workspace Facts

- MeetMind renderer uses React + Tailwind; theming is driven by CSS variables in `renderer/styles/globals.css` and Tailwind `darkMode: 'class'` with `<html class="dark">` in `renderer/index.html`.
- Prefer using CSS variables (`--color-*`) with Tailwind arbitrary values like `bg-[rgb(var(--color-background))]` instead of hardcoded hex colors for consistent theming.
- Electron packaging must include `dist/renderer/**` in `package.json` `build.files`; otherwise the installed app can open a blank window because `dist` is gitignored.
- Prevent duplicate running instances/tray icons by using `app.requestSingleInstanceLock()` in `electron/main.js` and focusing the existing window on `second-instance`.
- Don’t commit bundled FFmpeg `.exe` binaries over GitHub’s 100MB limit; keep them ignored or manage them via Git LFS / external download.
- Meetings commonly include both English and Malayalam, so transcription and language models should support code-switching between these languages.
