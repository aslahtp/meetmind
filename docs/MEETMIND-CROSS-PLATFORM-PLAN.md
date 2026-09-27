# MeetMind Cross-Platform Porting Plan

Target: macOS and Linux support alongside Windows, with CI/CD producing installers for all three and auto-update working on each.

Baseline: MeetMind 3.6.2 as described in `docs/ARCHITECTURE.md`.

> **How to read this plan.** Items marked **[verify]** are things I am not fully certain about, or that may have changed since my knowledge cutoff (framework versions, OS APIs, runner availability, pricing). Check each one against current official docs before committing to it. A consolidated list is in section 10.

## 1. Decision: stay on Electron

| Option | Backend language | Rewrite cost for MeetMind | System audio capture | Auto-update | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Electron (current) | Node.js | Low: only platform-specific audio code and packaging change | Still needs per-OS native work | electron-updater already in use; supports all 3 OSes | **Recommended** |
| Tauri | Rust | High: `main.js` (~1700 lines) and every service in `electron/services/` rewritten, Node SDKs replaced by REST calls or crates | Still needs per-OS native work; system webviews have no Chromium loopback | Official updater plugin, all 3 OSes | Revisit only if installer size becomes a real problem |
| tinyjs | JavaScript on txiki.js (not Node) | High: backend is not Node, so Node-dependent SDKs (`googleapis`, `@google-cloud/storage`, `@notionhq/client`, `assemblyai`) are unlikely to work as-is **[verify]** | Same problem; also known Web Audio issues under WebKitGTK per its own docs | Built-in updater | Not recommended: Windows and Linux are beta per its site, macOS 15+ only |

Key point: the hardest part of this port is **system audio capture on macOS**. It exists regardless of framework, so a framework switch adds a rewrite without removing the hard part.

## 2. Target matrix

| OS | Architectures | Installer formats | Auto-update format | Min OS version |
| :--- | :--- | :--- | :--- | :--- |
| Windows | x64 (optionally arm64 later) | NSIS `.exe` (unchanged) | NSIS | Unchanged |
| macOS | arm64 + x64 (or universal) | `.dmg` (install), `.zip` (update) | `.zip` via Squirrel.Mac, **requires signing** | macOS 13 if using ScreenCaptureKit audio **[verify]** |
| Linux | x64 (optionally arm64 later) | `.AppImage`, `.deb` | `.AppImage` (primary) | glibc floor set by the Electron version **[verify]** |

## 3. Phase 0: Groundwork (no user-visible change)

Goal: make the codebase platform-aware without changing Windows behavior. Ship this as its own release so any Windows regression is isolated.

### 3.1 Capture abstraction

Move the Windows-specific pieces of `electron/audio/mixer.js` and the capture path selection in `main.js` behind one interface:

```
electron/audio/capture/
  index.js      selects implementation by process.platform
  win.js        existing WASAPI loopback + dshow logic, moved as-is
  mac.js        Phase 2
  linux.js      Phase 1
```

```js
// electron/audio/capture/index.js
const impls = {
  win32: () => require('./win'),
  darwin: () => require('./mac'),
  linux: () => require('./linux'),
};
const load = impls[process.platform];
if (!load) throw new Error(`Unsupported platform: ${process.platform}`);
module.exports = load();
```

Each implementation exposes the same contract:

| Function | Purpose |
| :--- | :--- |
| `listDevices()` | Returns `{ systemSources, microphones }` in a common shape |
| `probeDevice(id)` | Same semantics as today's `audio:probe-device` |
| `start({ systemSource, mic, outputPath, onChunk })` | Starts capture, writes audio to disk incrementally |
| `stop()` | Stops capture, returns final file path |
| `checkPermissions()` / `requestPermissions()` | No-op on Windows and Linux; TCC prompts on macOS |

Keep `WASAPI_LOOPBACK_ID`, `wasapiKnownUnsupported`, `detectDshowLoopback` and the dshow parsing inside `win.js` only.

### 3.2 FFmpeg path resolution

Update `electron/audio/ffmpeg-path.js`:

- Binary names: `ffmpeg.exe` / `ffprobe.exe` on Windows, `ffmpeg` / `ffprobe` elsewhere.
- Resource layout: `assets/ffmpeg/<platform>-<arch>/` locally, `ffmpeg/` in the packaged app via per-platform `extraResources`.
- On macOS and Linux, after download or extraction, `chmod 0o755` the binaries.
- On macOS, the bundled binaries must be code signed as part of the app, or Gatekeeper and hardened runtime will block them **[verify: electron-builder signs binaries in `extraResources` when they are listed in `mac.binaries`]**.
- Optional dev fallback on macOS and Linux: an `ffmpeg` found on `PATH` (Homebrew, apt).
- The `ffmpeg:install` runtime download needs per-OS sources. gyan.dev builds are Windows only.

**Licensing check:** confirm whether each chosen FFmpeg build is LGPL or GPL, and that bundling it is compatible with MeetMind's MIT license and your distribution model **[verify]**.

### 3.3 App lifecycle differences to handle

| Area | Windows today | macOS change | Linux change |
| :--- | :--- | :--- | :--- |
| Deep links (`meetmind://`) | Arrive via `second-instance` argv | Arrive via `app.on('open-url')`; register the handler before `ready` | Arrive via argv like Windows; needs `MimeType=x-scheme-handler/meetmind` in the `.desktop` entry **[verify whether electron-builder adds it from `protocols`]** |
| Window close | Quits or goes to tray | Convention: keep running, re-open on `activate` | Same as Windows |
| Title bar | Frameless + custom controls | Use `titleBarStyle: 'hiddenInset'`, hide custom min/max/close buttons, pad for traffic lights | Keep frameless or use native frame; test on GNOME and KDE |
| Tray icon | `.ico` | Template image (`*Template.png`, monochrome with alpha) | PNG; relies on AppIndicator support in the desktop environment |
| Auto-launch (`autoLaunch`) | `app.setLoginItemSettings` | `app.setLoginItemSettings` works | Not supported by that API; write a `.desktop` file to `~/.config/autostart/` |
| Default PDF folder | Downloads | `app.getPath('downloads')` (already portable) | Same |

Add `renderer/lib/platform.js` helpers (the file already exists) so the UI can hide or adapt Windows-only settings, such as the WASAPI/Stereo Mix device options.

### 3.4 Exit criteria

- Windows build is behaviorally identical (manual QA of recording, both capture paths, pipeline, update).
- `pnpm run lint` and `pnpm run test` pass.
- Version bump and `CHANGELOG.md` entry, as `pr-checks.yml` requires.

## 4. Phase 1: Linux

Linux goes first because it is the cheapest: PulseAudio and PipeWire (through `pipewire-pulse`) expose a "monitor" source for every output device, which ffmpeg can capture directly.

### 4.1 Capture (`linux.js`)

1. Find the default output sink: `pactl get-default-sink`. Its monitor source is `<sink-name>.monitor`.
2. Find the default mic: `pactl get-default-source`, or let the user choose from `pactl list short sources`, filtering out `.monitor` entries.
3. Capture both and mix with the existing `amix` approach:

```
ffmpeg -f pulse -i <sink>.monitor \
       -f pulse -i <mic-source> \
       -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest[a]" \
       -map "[a]" -ac 1 -ar 16000 <output>.wav
```

Make the ffmpeg pulse path the **primary** capture path on Linux. I am not certain Electron's `getDisplayMedia` loopback audio works reliably on Linux **[verify]**, so treat renderer capture as optional there.

Requirements:
- The bundled FFmpeg build must include PulseAudio input support (`ffmpeg -devices` should list `pulse`) **[verify for your chosen build]**.
- `pactl` must be present (it ships with PulseAudio and with most PipeWire setups; `pulseaudio-utils` on Debian/Ubuntu). Detect its absence and show a clear message.

### 4.2 Packaging

- Targets: `AppImage` (auto-updatable) and `deb` (manual install and update).
- Declare `deb` dependencies as needed, for example `libpulse0` **[verify exact package names]**.
- Linux has no code signing requirement for AppImage updates; electron-updater verifies updates against the SHA-512 in `latest-linux.yml`.

### 4.3 Exit criteria

- Recording, pipeline and update tested on at least Ubuntu LTS (GNOME, PipeWire) and one KDE distro.
- Bluetooth headset and USB audio tested (monitor sources follow the default sink).

## 5. Phase 2: macOS

### 5.1 Why macOS is hard

macOS has no built-in loopback device. ffmpeg's `avfoundation` input can capture the mic but not system output on its own.

### 5.2 Capture options (in order of preference)

| Option | How | Pros | Cons |
| :--- | :--- | :--- | :--- |
| A. Native helper binary | Small Swift CLI (`meetmind-audio-helper`) using ScreenCaptureKit with audio capture enabled (macOS 13+) or Core Audio process taps (macOS 14.2+) **[verify both versions]**. Streams PCM to stdout; main writes it to disk like `capture:chunk` | Most reliable, no user setup, independent of Electron version | Swift code to maintain; must be signed and built for both archs |
| B. Electron loopback | Newer Electron versions have added macOS system audio for `getDisplayMedia` via ScreenCaptureKit, possibly behind Chromium feature flags **[verify which version made it stable]** | Reuses today's primary renderer path | Requires upgrading from Electron 33; behavior may depend on flags |
| C. Virtual device | User installs a loopback driver (BlackHole or similar) and MeetMind captures it via `avfoundation` | No native code | Poor UX; manual setup; audio routing confusion |

Recommendation: build **A** as the primary path, evaluate **B** during the Electron upgrade, keep **C** as a documented fallback for older macOS versions.

### 5.3 Native helper sketch

```
native/mac-audio-helper/
  Package.swift
  Sources/main.swift   SCStream with audio output, converts to 16 kHz mono s16le, writes to stdout
```

- Main spawns it with `child_process.spawn`, pipes stdout into the recording file, and mixes in the mic (either captured by the helper itself or by ffmpeg `avfoundation`).
- Build a universal binary in CI on the macOS runner (for example `swift build -c release --arch arm64 --arch x86_64`) **[verify flags]**.
- Ship via `extraResources` and list it in `mac.binaries` so it is signed with the app.
- Stop cleanly on `SIGTERM` so the file is flushed.

### 5.4 Permissions (TCC)

| Permission | Why | How to check / request |
| :--- | :--- | :--- |
| Microphone | Mic capture | `systemPreferences.getMediaAccessStatus('microphone')`, `systemPreferences.askForMediaAccess('microphone')` |
| Screen Recording | ScreenCaptureKit requires it even for audio-only capture, as far as I know **[verify]** | `systemPreferences.getMediaAccessStatus('screen')`; macOS has no programmatic request, so deep link the user to System Settings and explain why |

Add an onboarding step in `Settings > System` that shows both statuses and a "fix" button. Without these, capture fails silently or records silence.

### 5.5 Signing and notarization

Required, because Squirrel.Mac will not apply updates to an unsigned app.

- Apple Developer Program membership (I believe about USD 99/year **[verify current price]**).
- A "Developer ID Application" certificate, exported as `.p12`.
- Notarization credentials: either an App Store Connect API key, or Apple ID + app-specific password + team ID.
- Hardened runtime with an entitlements file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
</dict>
</plist>
```

The JIT entitlements are commonly needed for Electron under hardened runtime; review whether both are still needed for your Electron version **[verify]**.

### 5.6 Exit criteria

- Clean install on a fresh Mac: permissions prompts appear, recording captures both sides of a Meet/Zoom call.
- Tested on Apple Silicon and Intel (or Rosetta, if Intel hardware is unavailable).
- Update from version N to N+1 applies and relaunches.
- Post-update FFmpeg and helper check (section 9 of the architecture doc) extended to cover the helper binary.

## 6. Phase 3: Packaging config

Changes to `electron-builder.yml` (merge with the existing Windows config):

```yaml
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip          # required for electron-updater on macOS
      arch: [arm64, x64]
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true           # reads Apple credentials from env [verify for electron-builder 25]
  binaries:
    - Contents/Resources/ffmpeg/ffmpeg
    - Contents/Resources/ffmpeg/ffprobe
    - Contents/Resources/bin/meetmind-audio-helper
  extraResources:
    - from: assets/ffmpeg/mac
      to: ffmpeg
    - from: native/mac-audio-helper/dist
      to: bin
  extendInfo:
    NSMicrophoneUsageDescription: MeetMind records meeting audio from your microphone.

linux:
  target: [AppImage, deb]
  category: Office
  icon: assets/icons
  extraResources:
    - from: assets/ffmpeg/linux-x64
      to: ffmpeg

win:
  extraResources:
    - from: assets/ffmpeg/win-x64
      to: ffmpeg
```

Notes:
- Move the current top-level FFmpeg `extraResources` entry into the `win` section so each OS only ships its own binaries.
- Keep `!assets/ffmpeg/**` in `files` so FFmpeg never lands inside the `asar`.
- Keep `dist/renderer/**` in `build.files` (the documented blank-window failure mode).
- `icon.icns` for macOS can be generated from the existing source icon; extend `scripts/generate-icons.js` **[verify whether electron-builder can derive it automatically from a 512 px or 1024 px PNG]**.
- `afterPack` (`scripts/after-pack.js`) and `rcedit` are Windows-oriented; guard them with a platform check.

## 7. Phase 4: CI/CD

### 7.1 `ci.yml`: test on all three OSes

Run lint once (Linux), but run tests and the renderer build on a matrix, so path handling and ffmpeg argument building are exercised everywhere:

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: ./.github/actions/setup
      - run: pnpm run test
      - run: pnpm run build:renderer
```

Keep the existing repo-hygiene, gitleaks, audit and zizmor jobs as they are. Update the hygiene job so it also rejects committed macOS and Linux FFmpeg binaries (they have no `.exe` extension, so size and path checks under `assets/ffmpeg/` matter more).

### 7.2 `release.yml`: build matrix plus a single publish job

```yaml
jobs:
  gate:
    uses: ./.github/workflows/ci.yml

  build:
    needs: gate
    strategy:
      fail-fast: true
      matrix:
        include:
          - os: windows-latest
            args: --win --x64
          - os: macos-latest          # Apple Silicon runner [verify current labels]
            args: --mac --arm64 --x64
          - os: ubuntu-latest
            args: --linux --x64
    runs-on: ${{ matrix.os }}
    environment: release-signing      # protected environment, only for this workflow
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: ./.github/actions/setup
      - name: Fetch and verify FFmpeg
        run: node scripts/fetch-ffmpeg.js
        env:
          TARGET_PLATFORM: ${{ runner.os }}
      - name: Build mac audio helper
        if: runner.os == 'macOS'
        run: scripts/build-mac-helper.sh
      - name: Build installers
        run: pnpm run build -- ${{ matrix.args }} --publish never
        env:
          CSC_LINK: ${{ runner.os == 'macOS' && secrets.MAC_CSC_LINK || '' }}
          CSC_KEY_PASSWORD: ${{ runner.os == 'macOS' && secrets.MAC_CSC_KEY_PASSWORD || '' }}
          APPLE_API_KEY: ${{ runner.os == 'macOS' && secrets.APPLE_API_KEY || '' }}
          APPLE_API_KEY_ID: ${{ runner.os == 'macOS' && secrets.APPLE_API_KEY_ID || '' }}
          APPLE_API_ISSUER: ${{ runner.os == 'macOS' && secrets.APPLE_API_ISSUER || '' }}
      - uses: actions/upload-artifact@<pinned-sha>
        with:
          name: dist-${{ runner.os }}
          path: |
            dist/desktop/*.exe
            dist/desktop/*.dmg
            dist/desktop/*.zip
            dist/desktop/*.AppImage
            dist/desktop/*.deb
            dist/desktop/*.yml
            dist/desktop/*.blockmap

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write                 # only job with write access, runs no dependency code
    steps:
      - uses: actions/download-artifact@<pinned-sha>
        with:
          path: release-assets
          merge-multiple: true
      - name: Create release
        run: gh release create "v$VERSION" release-assets/* --notes-file notes.md
        env:
          GH_TOKEN: ${{ github.token }}
          VERSION: ${{ needs.build.outputs.version }}
```

This is a sketch, not a drop-in file. Adjust names to your existing `release.yml`, keep every action pinned to a full commit SHA, and route any event-derived values through `env:` as your current rules require. The exact APPLE_* variable names depend on which notarization method you choose **[verify against electron-builder docs]**.

### 7.3 Things that silently break auto-update if missed

| Item | Why it matters |
| :--- | :--- |
| Upload `latest.yml`, `latest-mac.yml`, `latest-linux.yml` | electron-updater reads these from the release; without them, clients find no update |
| Upload `.blockmap` files | Needed for differential downloads (full download is the fallback) |
| Build both mac archs **in one job** | Two separate mac jobs would each produce a `latest-mac.yml` and one would overwrite the other |
| Upload the mac `.zip`, not only the `.dmg` | Squirrel.Mac updates from the zip |
| Sign the mac app | Unsigned mac apps cannot self-update |
| Same version in all three builds | All legs build from the same commit after the `package.json` bump, so this holds as long as nothing rewrites the version mid-run |

### 7.4 Keeping the current security model

Your current guarantees (fork PRs get no secrets, only `publish` has `contents: write`, SHA-pinned actions, checksum-verified downloads) all survive this change:

- Signing secrets live in a **protected GitHub Environment** (`release-signing`) scoped to the release workflow on `main`. PR runs of `ci.yml` never reference it.
- Only the macOS leg reads them (Windows stays unsigned unless you add signing later).
- `scripts/fetch-ffmpeg.js` replaces the inline FFmpeg download, with one pinned version and SHA-256 per `<platform>-<arch>`, for example `FFMPEG_SHA256_WIN_X64`, `FFMPEG_SHA256_MAC_ARM64`, `FFMPEG_SHA256_MAC_X64`, `FFMPEG_SHA256_LINUX_X64`.
- Add the new signing and helper-build files to `.github/CODEOWNERS`.

### 7.5 Runner notes

- `macos-latest` is Apple Silicon. Cross-building the x64 mac app from it works with electron-builder, but test the x64 build on real Intel hardware or under Rosetta **[verify Intel runner availability if you want native x64 CI]**.
- macOS runners consume GitHub Actions minutes faster than Linux ones on private repos; for a public repo this may not apply **[verify current billing]**.

## 8. Phase 5: Testing, docs, release

### 8.1 Automated tests to add

| Test | Covers |
| :--- | :--- |
| `tests/capture-args.test.js` | ffmpeg argument building for win (dshow), linux (pulse), mac (avfoundation fallback) |
| `tests/ffmpeg-path.test.js` | Binary name and resource path per `process.platform` and `arch` (mock both) |
| `tests/pactl-parse.test.js` | Parsing `pactl list short sources` output, filtering monitors |
| `tests/platform-settings.test.js` | Settings visibility rules for Windows-only options |

### 8.2 Manual QA matrix

| Scenario | Win | macOS arm64 | macOS x64 | Ubuntu (GNOME) | KDE distro |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Fresh install, first launch, onboarding | | | | | |
| Permissions flow | n/a | | | n/a | n/a |
| Record Meet call via extension | | | | | |
| Record Zoom web call via extension | | | | | |
| Bluetooth headphones as output | | | | | |
| Import audio file | | | | | |
| Full pipeline (STT, Gemini, Notion) | | | | | |
| `meetmind://` deep link from extension | | | | | |
| Tray and auto-launch | | | | | |
| Update from N to N+1 | | | | | |
| FFmpeg missing, runtime install | | | | | |

### 8.3 Documentation updates

- `README.md`: supported platforms, per-OS install notes, macOS permissions, Linux `pactl` requirement.
- `docs/ARCHITECTURE.md`: section 1 ("Windows only"), section 4 (capture paths per OS), section 15 (packaging), section 16 (CI matrix), section 18 (remove the Windows-only limitation).
- `AGENTS.md`: new build prerequisites per OS, helper build instructions.
- `docs/KNOWN_ISSUES.md`: platform-specific caveats found during QA.
- `site/`: download buttons per OS.

### 8.4 Suggested release sequence

1. **Phase 0** release: refactor only, Windows unchanged.
2. **Linux beta**: AppImage and deb attached to the release, labeled beta in the README.
3. **macOS beta**: signed and notarized, labeled beta.
4. **General availability** on all three after one or two update cycles have been verified end to end on each OS.

## 9. Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| macOS capture API behavior differs between OS versions | Silent or one-sided recordings | Helper binary with explicit version checks; silence detection after the first few seconds of recording, with a warning in the UI |
| Users deny Screen Recording permission | No system audio on mac | Clear onboarding, status indicator in Settings, mic-only fallback with a warning |
| FFmpeg build lacks pulse or avfoundation support | Linux or mac capture fails | `ffmpeg -devices` check at startup, surfaced in Settings > System |
| Apple signing credentials expire or leak | Mac releases blocked, or compromised | Protected environment, calendar reminder for certificate expiry, API key over Apple ID where possible |
| Electron upgrade from 33 breaks something | Regressions on Windows | Do the upgrade in Phase 0 as a separate release |
| Linux desktop fragmentation (tray, deep links) | Inconsistent UX | Document supported desktops; degrade gracefully when AppIndicator is missing |

## 10. Items to verify before implementation

1. Minimum macOS versions for ScreenCaptureKit audio capture and Core Audio process taps.
2. Whether ScreenCaptureKit requires Screen Recording permission for audio-only capture.
3. Which Electron version supports macOS loopback audio in `getDisplayMedia`, and whether feature flags are still needed.
4. Whether Electron loopback audio works reliably on Linux with PipeWire.
5. electron-builder 25 behavior for `mac.notarize`, `mac.binaries`, `.icns` generation, and Linux `protocols` to `.desktop` `MimeType`.
6. Current GitHub Actions macOS runner labels, Intel availability, and billing for your repo type.
7. Apple Developer Program current price and notarization credential options.
8. electron-updater's current support level for `.deb` updates (treat AppImage as the supported path until confirmed).
9. Licensing of each chosen FFmpeg build (LGPL vs GPL) and compatibility with how you distribute MeetMind.
10. Package names for Linux `deb` dependencies.

## 11. Open decisions

- Universal macOS binary vs separate arm64 and x64 builds (universal is one download but roughly double the size).
- Whether to sign the Windows build too (reduces SmartScreen warnings; adds certificate cost).
- Whether to ship `rpm` for Fedora users, or AppImage only.
- Whether the mic on macOS is captured by the helper or by ffmpeg `avfoundation` (helper is simpler to keep in sync).
- Whether to add Windows arm64 while the matrix is being reworked.
