---
name: run-meetmind
description: Build, run, launch, drive and screenshot the MeetMind Electron desktop app (renderer UI) with demo meetings in an isolated profile. Use to verify UI changes, click through Dashboard / Meetings / a session / Settings tabs / Logs, test dialogs and flows, or capture light/dark screenshots.
---

# Run MeetMind

MeetMind is an Electron app (React + Tailwind renderer in `renderer/`, main process in `electron/`). Agents drive it with **`.claude/skills/run-meetmind/driver.cjs`**, a Playwright `_electron` driver that:

- launches the **built** renderer (`dist/renderer/`) with an isolated `--user-data-dir` (`.claude/skills/run-meetmind/.profile/`), so the user's real config, API keys and `meetmind.db` are never touched, and a MeetMind instance the user already has open doesn't block the launch;
- seeds four demo meetings (complete JSON notes, failed, processing, and Markdown notes);
- runs either a scripted screenshot **tour** or a **repl** that reads one command per line from stdin.

All paths below are relative to the repo root. Verified on Windows 11 (Git Bash), Node 24, Electron 33. Linux/xvfb was not tried.

## Setup (once)

The driver's own dependency (`playwright-core`) is installed inside the skill directory, so the app's `package.json` stays untouched:

```bash
pnpm install
pnpm install --ignore-workspace --dir .claude/skills/run-meetmind
```

## Build

The driver loads `dist/renderer/index.html`, so rebuild after every renderer change:

```bash
pnpm exec vite build
```

## Run (agent path)

**Tour:** screenshots every view in light and dark, plus Dashboard and Meetings at the 800×600 minimum window size. `--fresh` wipes and reseeds the isolated profile.

```bash
node .claude/skills/run-meetmind/driver.cjs tour --fresh
```

**Repl:** pipe commands in. Each prints `ok <cmd>`, `ERR <cmd> - reason`, `shot <path>` or `=> <json>`:

```bash
printf 'nav Settings\ntab Notes\nfocus textarea\ntype x\nnav Dashboard\nss repl-nav-guard\ndclick Discard\nwait 300\nss repl-after-discard\neval document.querySelector("[aria-current=page]").textContent\nnav Meetings\nfclick Delete\ndclick Cancel\neval document.querySelectorAll("article").length\nquit\n' | node .claude/skills/run-meetmind/driver.cjs repl
```

Screenshots are written to `.claude/skills/run-meetmind/shots/<name>.png` (gitignored). **Open them and look**: the window renders at the display's DPI scale, e.g. 1375×900 px for 1100×720 at 125%.

| Command | Does |
|---|---|
| `nav <Dashboard\|Meetings\|Settings\|Logs>` | Click a top-bar nav pill (scoped to `nav[aria-label=Main]`) |
| `tab <name>` | Click a `role=tab` (session Summary/Transcript/Audio, Settings tabs) |
| `click <name>` | Click the first button whose accessible name contains `<name>` (case-insensitive substring, **not** a regex) |
| `fclick <name>` | Forced click, for hover-only or overlaid buttons such as a session card's delete button |
| `dclick <name>` | Click a button inside the open `role=dialog` |
| `focus <css>` / `type <text>` / `key <Key>` | Focus a field, type (text taken verbatim), press a key such as `Escape` |
| `ss <name>` | Screenshot |
| `theme <light\|dark\|system>` | Set the theme through `window.meetmind.config.set`, then reload |
| `size <w> <h>` | Resize the window (the minimum is 800×600) |
| `scroll <dy>` | Wheel-scroll the main content |
| `wait <ms>` / `eval <js>` / `errors` / `quit` | Wait / evaluate in the renderer / print console errors / exit |

## Run (human path)

`pnpm run dev` rebuilds the extension, starts Vite on :5173 and opens Electron against the real profile. It needs a desktop session and is not what the driver uses. It wasn't exercised while writing this skill because the user had it running.

## Gotchas

- **Single-instance lock.** `app.requestSingleInstanceLock()` makes a second launch against the default profile exit silently and just focus the user's window. `--user-data-dir` gives the driver its own lock, config (electron-store) and DB; the driver refuses to continue if `app.getPath('userData')` isn't the isolated profile.
- **Don't set `NODE_ENV=development`.** `electron/main.js` then loads `http://localhost:5173` instead of `dist/renderer`. The driver deletes `NODE_ENV` from the child env.
- **You can't reach main-process modules from `electronApp.evaluate`.** `process.mainModule` is `undefined` there (`Cannot read properties of undefined (reading 'require')`). That's why the driver seeds data by writing `<profile>/meetmind.db` with `sql.js` **before** launch. A seeded profile is reused on later runs; pass `--fresh` to reset it.
- **Expected console error:** `Failed to load resource: ... 404`. The demo sessions have no audio file, so `meetmind-audio://` 404s and the logs show `meetmind-audio file not found`.
- **Wheel scrolling needs the pointer over the scroll container.** Over the 64px top bar it does nothing; `scroll` moves the mouse to (550,500) first.
- **Modal backdrops block clicks underneath.** Plain `click Discard` hits Settings' own save-bar "Discard" behind the dialog and times out; use `dclick`.
- **Session-card delete** is hidden until hover and sits under the title's stretched-link overlay. `click Delete` times out; use `fclick Delete`.
- **Settings only becomes dirty on a real change.** "Reset to default" is a no-op while the prompt already equals the default. Use `focus textarea` + `type x` to trigger the unsaved-changes bar and navigation guard.
- The main-process log says `AutoUpdater: dev mode detected` even for this production-mode launch, because the app isn't packaged. This is harmless.

## Troubleshooting

- `playwright-core missing` → `pnpm install --ignore-workspace --dir .claude/skills/run-meetmind`.
- `dist/renderer missing` → `pnpm exec vite build`.
- `Not isolated: userData=...` → the `--user-data-dir` switch wasn't honoured. Don't launch through `pnpm run dev`; use the driver.
- `ERR click <x> - locator.click: Timeout 10000ms exceeded` → the button is hidden, overlaid or behind a dialog. Try `fclick` / `dclick`, or `ss` to see the current state.
