# Plan: Port MeetMind from JavaScript to TypeScript


## Context

MeetMind is ~25k lines of untyped JS: `electron/` (59 files, 12.4k lines, **all CommonJS**, no `"type"` in package.json), `renderer/` (~100 `.js/.jsx`, 12.4k lines, React + Vite + Tailwind), `extension/` (MV3, unbundled classic scripts), `scripts/` (CJS), `tests/` (27 Vitest files, ESM, load Electron modules via `createRequire`). There is no `tsconfig`, no `typescript` dep, no `@types/*`. The goal is a full port with **zero behavior change**. Typing the IPC surface (73 `ipcMain` handlers, `window.meetmind.*`) and provider registry is where the value is.

Decisions (confirmed with user):
- **Electron build**: `tsc` → CommonJS into `dist/electron/` (no bundler).
- **Strictness**: gradual. Start `strict: false`, ratchet to full `strict` at the end.
- **Scope**: everything — electron, renderer, tests, scripts, **and extension**.
- **Tests**: convert to `.ts`, importing the real TS sources through Vitest.

## Ground rules (apply to every phase)

1. **Pipeline first, rename later.** Prove the compile→package→smoke path on unchanged JS before touching logic.
2. **Rename-only commits.** `git mv` (history preserved) in its own commit; type fixes in a separate commit. No refactors, no logic edits, no "while I'm here" cleanups.
3. **Keep runtime semantics identical**:
   - Lazy `require()` (koffi, sql.js, googleapis, `@google-cloud/storage`, assemblyai, `uuid` inline requires) stays synchronous and lazy: `const x = require('koffi') as typeof import('koffi')`, not `await import()`.
   - Keep `vi.spyOn`-able object exports (provider registries) as plain shared objects.
   - Prefer named exports; replace `module.exports = x` with `export =`/named exports and update all importers in the same commit.
   - No `enum`/`namespace` emit, no `useDefineForClassFields` surprises (target `ES2022`, `module: commonjs`, `esModuleInterop: true`).
4. **Each phase exit gate**: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` green; plus for runtime-affecting phases `pnpm run dev` exercised with the `run-meetmind` skill (Dashboard, a session, Settings tabs, Logs), and `pnpm run build:dir` + `<app> --smoke` (`node scripts/check-smoke.js`). Mac/Linux are verified by `mac-build`/`linux-build` CI jobs.
5. **Project rules (AGENTS.md)**: each PR bumps `package.json` (patch — internal, no user-facing change; the tooling/layout PRs may warrant minor) and adds a `CHANGELOG.md` heading; update docs that name `.js` paths. Read `DESIGN.md` only if a UI change is unavoidable (none planned). Never use npm/npx; new packages must pass `minimumReleaseAge: 1440`.
6. Do **not** commit the unrelated dirty files (`pnpm-lock.yaml` `@pnpm/exe` churn, `extension/manifest.json` line-ending refresh) except lockfile changes caused by new deps.

## Phases

### Phase 0 — Baseline and safety net — DONE
> Baseline on Windows: lint clean, 26 test files / 374 tests pass, dev-mode `--smoke` all 9 checks ok (saved in git-ignored `.port-baseline/smoke-before.txt`). Needs `pnpm run build:renderer` first and `env -u ELECTRON_RUN_AS_NODE` (this shell sets it).
- Record green baseline: lint, 27 tests, `build:dir` + `--smoke` output on Windows. Save smoke JSON for later comparison.
- Create branch `chore/typescript-port`; copy this plan to root `plan.md`.
- Resolve the open bug candidate: `renderer/components/settings/LinuxAudio.jsx:29` calls `window.meetmind.audio.linuxStatus()` but preload exposes `recording.linuxStatus` (no `audio` namespace). Do **not** fix silently; typing in Phase 8 will flag it; fix in its own commit with a changelog line.

### Phase 1 — Tooling foundation (no file renames) — DONE
> Implemented as: `typescript ~6.0.3` (typescript-eslint 8 does not support TS 7 yet; do not bump past 6.0.x), `@types/react`/`react-dom` **18** (app is on React 18), `@types/node` 24. Config is one `tsconfig.base.json` plus a `tsconfig.json` per folder (`electron/`, `renderer/`, `tests/`, `scripts/`, root for config files) instead of `tsconfig.*.json` at the root; the extension project is added in Phase 10. `pnpm run typecheck` runs them all. TS 6 defaults `types` to `[]` and deprecates `baseUrl`, so each project lists its `types` and uses `paths` without `baseUrl`.
- Add devDeps: `typescript`, `typescript-eslint`, `@types/node` (match Electron's Node major), `@types/react`, `@types/react-dom`, `@types/ws`, `@types/sql.js`, `@types/chrome`, `tsx`, `wait-on` (dev loop). Note `electron-store` 8, `koffi`, `ical.js`, `partial-json`, `uuid`, SDKs ship their own types.
- Add `tsconfig.base.json` (`target ES2022`, `strict:false`, `allowJs:true`, `checkJs:false`, `skipLibCheck`, `esModuleInterop`, `resolveJsonModule`, `isolatedModules`) plus project configs:
  - `tsconfig.electron.json` (`module commonjs`, `rootDir electron`, `outDir dist/electron`, sourceMap, node types)
  - `tsconfig.renderer.json` (`jsx react-jsx`, DOM libs, `moduleResolution bundler`, `@`/`@assets` paths, `noEmit`)
  - `tsconfig.node.json` (scripts, vite/vitest configs), `tsconfig.extension.json` (see Phase 10), `tsconfig.json` with references.
- Scripts: `typecheck` (`tsc -b --noEmit`-style over all projects), `compile:electron` (`tsc -p electron/tsconfig.json`; `build:electron` is already the electron-builder script).
- `eslint.config.mjs`: add `typescript-eslint` blocks for `**/*.{ts,tsx}`, move `no-unused-vars` to the TS rule, widen all `.js/.jsx` globs to include `.ts/.tsx`, keep existing react/react-hooks rules and the extension/preload env overrides (add `electron/overlay-preload` explicitly).
- `vitest.config.mjs`: include `tests/**/*.test.{js,jsx,ts,tsx}`.
- CI (`ci.yml`): add a `pnpm run typecheck` step next to lint/test.
- Exit: everything still passes with 0 files renamed.

### Phase 2 — Compile pipeline on unchanged JS (de-risk packaging) — DONE (local; CI mac/linux still to confirm)
> Implemented differently from the outline below, for a reason found while building it: since TypeScript 6, `tsc` always adds `"use strict"` to emitted files (`alwaysStrict: false` is accepted but ignored), which would switch every untouched JS file from sloppy to strict mode. So `pnpm run compile:electron` (`scripts/compile-electron.js`) **copies the `.js` files byte-for-byte** into `dist/electron/` and only runs `tsc` (`electron/tsconfig.build.json`, `allowJs: false`, no source maps) for `.ts` files. A file becomes strict when it is renamed to `.ts`: review each for strict-mode hazards (implicit globals, `this` in plain functions, block-level function declarations, writes to read-only properties) as it is ported. The script goes away with the last `.js` file.
> Also done: `electron/entry.js` (`main` in package.json = `dist/electron/entry.js`) runs `--smoke` or `main.js`, so `main.js` lost its top-level `return`; `electron/utils/paths.js` (`appRoot` = nearest folder with a package.json) replaced the `../assets`, `../dist/renderer` and `../..` strings in `main.js`, `overlay-window.js` and `ffmpeg-path.js`; `electron-builder.yml` lists `dist/electron/**`; all dev/build scripts run `compile:electron` first; CI compiles in the lint job. Preload paths are unchanged (they stay next to `main.js`). `wait-on` ended up unused: remove it in Phase 12 (not now: `pnpm remove` relinks and deletes the Electron binary).
> Verified (Windows): lint, typecheck, 374 tests; dev `--smoke` through `dist/electron` 9/9; `pnpm run build:dir` then packaged `MeetMind.exe --smoke` 9/9 (bundled FFmpeg, overlay inside the asar); UI tour in light and dark with no console errors.
> Pre-existing, not changed: the packaged asar contains the whole repo (docs, tests, `renderer/`, `.claude/`, …) because each platform's `files:` list in `electron-builder.yml` holds only `!` exclusions, so electron-builder adds `**/*`; the top-level `files` list is therefore not what limits the package. Slimming it is a separate decision.

(original outline follows)
Goal: the app runs from `dist/electron/` while sources are still `.js` (via `allowJs`, emit only).
- New `electron/entry` (see below) and `"main": "dist/electron/entry.js"`.
- **Smoke top-level `return`** (`main.js:1-6`, TS1108): don't restructure `main`; add a tiny `electron/entry.ts` that does `if (process.argv.includes('--smoke')) require('./smoke'); else require('./main')`. Preserves "smoke before config require" ordering.
- **Path depth**: replace the `__dirname`-relative strings (`main.js:274,286,429-451,1140,2080,2204`; `overlay-window.js:117,154`; `ffmpeg-path.js:57` `appRoot`) with one helper `electron/utils/paths.ts` exporting `appRoot` found by walking up from `__dirname` to `package.json` (works in dev, tests on TS sources, `dist/electron`, and inside asar), plus `rendererDir`, `assetsDir`, `preloadPath`, `overlayPreloadPath`. Providers still must not import `electron` at load.
- `electron-builder.yml`: `files` → `dist/electron/**` instead of `electron/**` (keep `dist/renderer/**`, `assets/icons/**`, `package.json`, koffi excludes, `asarUnpack` koffi unchanged). `scripts/after-pack.js` unaffected.
- Scripts: `predev`/`prebuild*`/`build:dir` run `build:electron` first; `dev:electron` = one `tsc` build then `tsc -w` + `wait-on` + `electron .` via `concurrently`. `.gitignore` already ignores `dist/`.
- `scripts/fetch-ffmpeg.js` requires `electron/audio/ffmpeg-{fetch,sources,path}` → run via `tsx` (or require compiled output) so CI's pre-build `fetch-ffmpeg` still works.
- Sandboxed overlay preload stays a standalone CJS file importing only `electron` (verify compiled output has no local `require`).
- Exit: `pnpm run dev` and packaged `--smoke` pass on Windows; push branch to get mac-build/linux-build green **before** any rename.

### Phase 3 — Shared types — DONE (types only; Phase 2 not started yet)
> Implemented in `electron/shared/{config,session,calendar,providers,updater,overlay,ipc,index}.ts` plus `renderer/global.d.ts` (`window.meetmind?` / `window.meetmindOverlay?` / `__APP_VERSION__`), a `@shared` path in `renderer/tsconfig.json`, and an ESLint rule (renderer may only `import type` from `electron/`). Contract = `IpcInvokeMap` (73 channels), `IpcSendMap`, `IpcEventMap` (19 events), `Meetmind`, `MeetmindOverlay`. Verified with a throwaway file: valid calls compile; `window.meetmind.audio.linuxStatus()` (the `LinuxAudio.jsx:29` bug), an unknown event, a wrong arg type and an unknown payload field are all errors; a value import from `electron/` in the renderer is a lint error.
> Facts found while reading handlers: `sessions:changed` carries `{ revision }` (not a bare number); calendar events use `meetingLink`; `transcription:progress` is whitelisted in preload but never sent; `updater:*` and some storage/pdf/ffmpeg results are typed loosely (checklist at the top of `ipc.ts`, tighten in Phases 5-7).
> Loose-mode caveat: until `strictNullChecks` (Phase 11), `if (!r.success)` does not narrow `Outcome` results; `r.success === false` does. Port renderer code with the existing checks as they are (casts where needed) and don't rewrite conditions.
> Environment note: `pnpm install` replaces `node_modules/electron`, so the binary has to be restored with `pnpm exec install-electron` before `--smoke` or `pnpm run dev` (done).

(original outline follows)
- New `shared/` (or `electron/types/`, imported by both sides via path alias) with: `Config` (+ index signature for provider-derived keys), `Session`, `ProviderDescriptor`/`STTProvider`/`LLMProvider`, `RecordingStatus`/overlay phase unions (currently prose comments, e.g. `main.js:1021`), `UpdaterStatus`, calendar types, and an **IPC channel map** (`channel → {args, return}`) plus the `Meetmind` and `MeetmindOverlay` interfaces for `window.meetmind` / `window.meetmindOverlay` (full surface inventoried: `window, shell, logs, config, recording, sessions, storage, dialog, pdf, notion, providers, gemini, processing, capture, permissions, calendar, updater, app, ffmpeg, on/off`, + `startupTheme`, `platform`).
- `renderer/global.d.ts`: `window.meetmind?: Meetmind` (optional, because the renderer guards heavily with `?.`), `declare const __APP_VERSION__: string`, `*.svg`/`*.png` module declarations.
- Types only; no runtime change.

### Phase 4 — Port electron pure/leaf modules (+ their tests)
Order = dependency order, DAG has no cycles. For each: `git mv .js .ts` → convert `require`/`module.exports` → fix errors with explicit annotations (loose mode).
- `utils/` (`configMigration`, `download`, `logger` — `module.exports = logger` instance, `config` with `electron-store`), `providers/shared/*`, `audio/{pulse-parse,audio-hints,mac-capture,ffmpeg-sources,waveform,mixer}`, `services/{storage-rules,update-policy,meeting-title,notes-normalize,prompts}`, `detection/meeting-rules`, `calendar/{calendar-sources,calendar-events,ics-parse}`, `overlay/overlay-lifecycle`.
- Convert the matching tests to `.ts` in the same step (`ffmpeg-path`, `pulseParse`, `storageRules`, `updatePolicy`, `meetingDetection`, `meetingTitle`, `calendar*`, `overlayLifecycle`, `waveform`, …), replacing `createRequire(...)('../electron/x')` with `import`.

### Phase 5 — Providers
- Type `registry.js` as generic `Registry<P>` with `STTProvider`/`LLMProvider` interfaces (metadata, credentials, models, `transcribe`/`generate`, `test`, injectable `deps.fetchImpl`/`deps.sdk`); `describe()` return type = `ProviderDescriptor`.
- Port `providers/index`, `stt/{google,sarvam,groq,assemblyai}`, `llm/{claude,groq,gemini}`, `services/{transcription,notes}`. Tests: `providers.test` (507 lines), `notesPreview.test` — confirm `vi.spyOn(llmRegistry...)` still works.

### Phase 6 — Services, DB, audio, calendar, detection, overlay
- `db/sessions` (`sql.js`, keep wasm load behavior; no `locateFile` change), `audio/{recorder,ffmpeg-path,ffmpeg-fetch}`, `audio/pulse`, `services/{notion,updater,auto-launch,pdf-export,recordings-storage,ffmpeg-installer,permissions}`, `calendar/{index,google,ics}`, `detection/{win32,linux,meeting-detector}` (koffi FFI signatures stay string-based; shared `DetectionBackend` interface), `overlay/overlay-window`, `websocket-server`.
- `any` is acceptable at FFI/untyped edges in this phase; track with `// TODO(strict)` only where genuinely needed.

### Phase 7 — Main process, preloads, smoke
- `main.ts` ported **as-is** (2218 lines; no splitting — out of scope), `registerIpcHandlers` typed against the IPC channel map; `preload.ts` implements `Meetmind` (so the contract is compiler-checked against the renderer); `overlay-preload.ts` implements `MeetmindOverlay`; `smoke.ts`, `entry.ts`.
- Exit: full manual pass with `run-meetmind` (start/stop recording flow, processing progress, Settings save, Notion/Calendar screens where testable), packaged `--smoke`, CI mac/linux green.

### Phase 8 — Renderer
- `lib/*.js → .ts`, `*.jsx → .tsx`, bottom-up: `lib` → `ui/*` → leaf components (icons need asset decls) → `settings/*` → `note/*` → `Dashboard/Meetings/NoteViewer/...` → `app.tsx`, `main.tsx`, `overlay.tsx`; update `index.html`/`overlay.html` script `src`.
- Codemod (mechanical, own commit): strip explicit `.js/.jsx` import extensions (37 files import `.jsx`); Vite resolves extensionless.
- `app-context` typed `createContext<AppContextValue | null>`; fix flagged bugs (`audio.linuxStatus`) in a separate commit + changelog `Fixed`.
- Config files: `vite.config.js → vite.config.ts`; `vitest.config.mjs → vitest.config.ts`; `tailwind.config.js` and `postcss.config.js` stay CJS `.js` (loaded by tooling, no value in porting) — Tailwind `content` glob already includes ts/tsx.
- Tests: `copyMarkdown`, `dashboard`, `format`, `markdown`, `meetingFilters`, `meetingSearch`, `modelSelect`, `platform`, `settingsForm`, `macPermissions.test.tsx` (SSR) → `.ts/.tsx`.
- Exit: lint/typecheck/test; `build:renderer`; visual pass in light + dark (screenshots via `run-meetmind`) comparing to Phase 0.

### Phase 9 — Remaining tests
- Convert any left over (`macSupport`, `autoLaunch`, `pdf-export`, `waveform`, …). Update `vitest.config` include to `*.test.{ts,tsx}` only.

### Phase 10 — Scripts and extension
- **scripts/**: `*.js → *.ts` run with `tsx` (`build-extension`, `check-smoke`, `fetch-ffmpeg`, `generate-icons`, `generate-release-notes`, `generate-social-preview`, `after-pack`). CI and `electron-builder.yml` (`afterPack`) references updated; electron-builder loads a TS afterPack only if tsx registers — otherwise keep `after-pack.js` as the one JS file (decide when implementing; default: keep JS). `build-site.sh` unchanged.
- **extension/**: scripts run unbundled and share globals, so TS source must keep script (non-module) semantics. Use per-entry-point isolation (separate tsconfig entries so `background`, `content`, `popup`, `open-app`, `overlay` don't redeclare each other's top-level names). Emit to `dist/extension/` with static files (manifest, html, css, fonts, icons) copied; `scripts/build-extension.ts` zips that dir and stamps the manifest version into the **staged copy** (this also stops it rewriting `extension/manifest.json` in place — the source of the dirty-manifest noise). Manifest and HTML keep pointing at `.js`. Extension is slated for removal, so keep this phase minimal: types for `chrome.*` and WS messages only.

### Phase 11 — Ratchet strictness
Turn on, one flag per PR, fixing per folder (`utils` → `providers` → `services` → rest of `electron` → `renderer`): `noImplicitAny` → `strictNullChecks` → `strictFunctionTypes`/`strictBindCallApply` → `strict: true`; drop `allowJs`; ban leftover `any` where cheap. Only type-level fixes; any fix that changes control flow gets reviewed separately (null guards that alter behavior are called out in the PR).

### Phase 12 — Docs, CI, release hygiene
- Update every `.js/.jsx` path reference: `AGENTS.md` (+`CLAUDE.md` mirror: architecture, commands, lint scope, CI), `docs/ARCHITECTURE.md`, `docs/ADDING_PROVIDERS.md` (`providers/stt/<name>.ts`, `providerIcons.ts`, `tests/providers.test.ts`), `.github/CODEOWNERS` (updater, ffmpeg-sources, ffmpeg-fetch, ffmpeg-installer, download), PR template (add `typecheck`), `CONTRIBUTING.md`, `llms.txt`, `site/index.html` if it names files.
- `ci.yml`: typecheck step, `changes` path filter covers `dist/electron` inputs (`electron/**`, `tsconfig*`), `release.yml` build steps run `build:electron` (via `prebuild`).
- Version bump + `CHANGELOG.md` entry; final full verification: CI on Windows/macOS/Linux, packaged-app `--smoke`, manual run-through.

## Critical files
`package.json`, `electron-builder.yml`, `electron/main.js` (+ `preload.js`, `overlay-preload.js`, `smoke.js`), `electron/audio/ffmpeg-path.js`, `electron/overlay/overlay-window.js`, `electron/providers/registry.js`, `electron/utils/config.js`, `renderer/app.jsx`, `renderer/lib/app-context.js`, `vite.config.js`, `eslint.config.mjs`, `vitest.config.mjs`, `scripts/{build-extension,fetch-ffmpeg}.js`, `.github/workflows/ci.yml`.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Path breakage after moving to `dist/electron` | `paths.ts` helper (Phase 2), smoke test in packaged app, CI on 3 OSes before renames |
| Sandboxed overlay preload gets a local `require` | Verify compiled `overlay-preload.js`; keep `electron` the only import |
| Lazy native modules loaded eagerly/asynchronously | Keep sync lazy `require` casts; smoke covers koffi/sql.js/ffmpeg |
| Tests relying on CJS-shared objects (`vi.spyOn`) | Keep registries as shared plain objects; run `providers`/`notesPreview` tests each phase |
| `pnpm` `minimumReleaseAge` blocks fresh `typescript`/`@types` | Pick versions >1 day old; don't remove the setting |
| Dev loop: reinstall replaces `node_modules/electron` while app runs | Install deps with the app closed (per AGENTS.md) |
| Extension scripts sharing globals | Per-entry tsconfig/isolation; keep unbundled |
| Silent behavior change from fixing type errors | Rename-only commits, no logic edits; flagged bugs fixed separately |

## Verification (end-to-end)
1. `pnpm run lint && pnpm run typecheck && pnpm run test` — all green at every phase.
2. `pnpm run dev` driven through the `run-meetmind` skill: Dashboard, Meetings, a session (notes/transcript/audio), every Settings tab, Logs, overlay; light/dark screenshots vs. Phase 0 baseline.
3. `pnpm run build:dir`, then `dist/desktop/win-unpacked/MeetMind.exe --smoke` from bash → `node scripts/check-smoke.js` (compare with baseline JSON).
4. Push branch: `mac-build` and `linux-build` smoke jobs green; `pnpm run build` installer produced.
5. Extension: `pnpm run build:ext` zip loads in Chrome and still connects to the desktop WS bridge.

## Open items to confirm during implementation
- `scripts/after-pack` stays JS vs. TS (electron-builder loading constraint).
- Whether `renderer/global.d.ts` types `window.meetmind` optional (default) or required after the guards are audited.
