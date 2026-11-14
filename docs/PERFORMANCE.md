# Performance

Memory and CPU of the MeetMind desktop app on Windows, idle and while recording, measured on
2026-11-15. It compares **4.19.3** (Google Calendar, Notion and Gemini clients load on first use)
with **4.19.2** (the `googleapis` package loaded at every startup). Rerun the measurements after
changes that could affect them; see [How to reproduce](#how-to-reproduce).

## Summary (4.19.3)

| State | CPU (one core = 100%) | CPU (whole machine) | Memory (private) |
| --- | --- | --- | --- |
| Idle, window open | 0.6% | < 0.1% | 229 MB |
| Idle, window hidden to the tray | 0.4% | < 0.1% | 226 MB |
| Idle, tray only (window closed after 10 min hidden) | 0.3% | < 0.1% | 268 MB¹ |
| **Recording** (mic + system audio, windows hidden, meeting overlay shown) | **23–44%** | **1.4–2.8%** | **399 MB** |

¹ Measured after a recording; see [memory kept after a recording](#3-memory-is-not-returned-after-a-recording).
Before any recording it should be about 180 MB (estimated, not measured: the hidden-window figure
minus the ~45 MB renderer that closing the window frees).

- Idle costs almost nothing: the main process (meeting detection polls every 1.5 s, calendar sync
  every minute) is nearly all of it.
- **Recording is the expensive state**, and most of that is the GPU process, not MeetMind's own
  code. See [Findings](#findings).
- Recording CPU is the least repeatable number: the same build measured 23% to 44% of one core in
  different runs. Compare recording CPU only within one run (see the experiments below).

## 4.19.2 → 4.19.3

Same machine, same demo data (4 finished meetings), two runs each, averaged:

| State | 4.19.2 | 4.19.3 | Change |
| --- | --- | --- | --- |
| Memory, window open | 289 MB | 229 MB | **−60 MB (−21%)** |
| Memory, window hidden | 288 MB | 226 MB | −62 MB (−22%) |
| Memory, recording | 459 MB | 399 MB | −60 MB (−13%) |
| Memory, tray only (after a recording) | 335 MB | 268 MB | −67 MB (−20%) |
| Main process memory (window open) | 135 MB | 75 MB | −60 MB (−44%) |
| Main process JS heap | 62 MB | 12 MB | −50 MB (−81%) |
| CPU, window open | 0.9% | 0.6% | −0.3 points |
| CPU, recording | 23% | 28% | same code; within run-to-run spread (23–44%) |
| Start to usable window (warm) | ~3.1 s | ~0.8–1.2 s | about 3× faster |

The whole saving is in the main process: 4.19.2 loaded `googleapis` (995 files, ~125 MB) on every
start even with no Google calendar connected. The GPU and renderer processes are unchanged.

## Where the memory and CPU go (4.19.3)

| Process | Window open | Window hidden | Recording | Tray only |
| --- | --- | --- | --- | --- |
| Main (Node.js + app code) | 75 MB · 0.4% | 74 MB · 0.3% | 119 MB · 0.7% | 119 MB · 0.3% |
| GPU | 86 MB · 0% | 86 MB · 0% | 144 MB · **15.5%** | 127 MB · 0% |
| Renderers (main window, capture window, overlay) | 45 MB · 0.2% | 44 MB · 0% | 112 MB · **8.6%** (3 windows) | — |
| Audio service | 11 MB · 0% | 10 MB · 0% | 12 MB · 2.8% | 11 MB · 0% |
| Network service | 12 MB · 0% | 12 MB · 0% | 12 MB · 0% | 12 MB · 0% |

CPU is the share of one core; memory is private bytes. Recording figures are the two-run average
of the comparison above.

## Findings

Ranked by impact; none of these is fixed yet.

### 1. The "Writing notes" spinner costs ~18% of a core, even when hidden

With a meeting showing the animated spinner (`.spinner` in `renderer/styles/globals.css`, a CSS
`rotate` on a Lucide SVG icon), the idle app used **18.6%** of a core, 15% of it in the renderer.
Turning that one animation off brought it to **0.8%**. With the window hidden it still used
**7.4%**. This matters because a meeting can sit in a processing state for minutes, and a session
stuck in that state keeps the cost forever.

Likely cause: Chromium runs a CSS animation applied directly to an `<svg>` on the main thread (layout
and paint every frame) instead of on the compositor. Options: animate an HTML wrapper with
`will-change: transform`, pause the animation when `document.hidden`, or show a static icon when
the window isn't focused.

### 2. Recording: the GPU process does most of the work

During a recording with every window hidden, the GPU process used ~15% of a core and the three
renderers ~9%. An experiment within one run:

| | CPU (one core) |
| --- | --- |
| Recording, meeting overlay shown | 43.9% (GPU 24.2%, renderers 14.3%) |
| Same recording, overlay hidden | 33.2% (GPU 18.3%, renderers 10.7%) |

- **The meeting overlay** (a transparent, always-on-top window with an animated waveform and a 1 s
  timer, `backgroundThrottling: false`) accounts for about a quarter of recording CPU.
- **The rest stays with the overlay gone**, so it comes from the hidden capture window. A likely
  cause, not yet confirmed: system-audio loopback requires `getDisplayMedia({ video: true })`;
  `renderer/capture.ts` stops the video track at once, but the screen-capture session may keep
  running in the GPU process. Worth testing: request the smallest possible video
  (`{ width: 1, height: 1, frameRate: 1 }`).

### 3. Memory is not returned after a recording

After a recording ends, the main process stays ~45 MB higher (75 → 119 MB) and the GPU process
~40 MB higher (86 → 127 MB), while the main JS heap is unchanged (12–13 MB). The extra memory is
native (Chromium/Node buffers, not JavaScript objects), so tray-only memory after a meeting (268 MB)
is higher than with the window open before it (229 MB). Worth checking: whether the capture window,
its `MediaStream`s and the in-progress `.webm` write stream are fully released on stop.

### 4. Startup

Warm startup to a usable window is ~1 s in 4.19.3. A first start after install or a reboot is
slower (one cold 4.19.2 start took 22 s), dominated by disk reads.

### Real-world reference

The installed app with a real profile (more meetings, a connected calendar) measured 480 MB and 0.3%
CPU idle with the window open in 4.19.1 (before this change). Real profiles use more memory than the
demo profile; the relative savings above still apply to the main process.

## How to reproduce

The measurements use `.claude/skills/run-meetmind/profile.cjs`, which drives the **built** app
through Playwright in a throwaway profile and reads `app.getAppMetrics()`:

```bash
pnpm install --dir .claude/skills/run-meetmind      # once: the driver's playwright-core
pnpm run compile:electron && pnpm exec vite build   # profile.cjs runs dist/, not the sources
printf 'quit\n' | node .claude/skills/run-meetmind/driver.cjs repl --fresh   # seed demo meetings
cp -r .claude/skills/run-meetmind/.profile /tmp/meetmind-perf                # throwaway copy
node .claude/skills/run-meetmind/profile.cjs --profile /tmp/meetmind-perf --sample 30 --record 60
```

It measures four states in order: window open, window hidden, a real 60 s recording (microphone and
system audio, windows hidden), then tray only (main window destroyed). The recording is stored in
the throwaway profile; delete it afterwards. To compare another version, build it in a separate
worktree (`git worktree add --detach dist/perf-base <commit>`, then `pnpm install`,
`pnpm exec install-electron` and copy `assets/ffmpeg/`) and pass `--app dist/perf-base`. Electron
can't start sandboxed processes from some temp folders on Windows, so keep the app inside the repo.

Notes on method:

- **Machine:** Intel Core i7-11800H (8 cores, 16 threads), 16 GB RAM, Windows 11 (build 26300), on
  AC power, Ultimate Performance plan.
- **Demo data:** the run-meetmind seed with the in-progress meeting removed, so no spinner is on
  screen (the spinner's cost is measured separately above). No API keys, so processing after the
  recording fails fast.
- **CPU** is each process's cumulative CPU time over a 30 s window (45 s while recording), as a share
  of one core. It is sensitive to clock speed: one run had to be discarded (negative readings, and
  every process doubled at once, a sign the machine changed speed mid-run). Memory is stable across
  runs and is the more reliable comparison.
