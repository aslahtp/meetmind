## What changed and why

<!-- A short description of the change and the problem it solves. Link related issues, e.g. "Closes #12". -->

## How I tested it

<!-- Flows you exercised with `pnpm run dev`, and on which OS (Windows / macOS, Apple silicon or Intel / Linux, X11 or Wayland). Add screenshots for UI changes. -->

## Checklist

- [ ] `pnpm run lint` and `pnpm run test` pass
- [ ] `package.json` version bumped and `CHANGELOG.md` updated (skip for typo/formatting-only changes)
- [ ] Read `DESIGN.md` before changing any UI
- [ ] Packaging or main-process changes: the **Windows build & smoke test**, **macOS build & smoke test** and **Linux build & smoke test** checks pass (testers can try the macOS app from the `MeetMind-mac-arm64` artifact and the Linux AppImage from `MeetMind-linux-x64`)
- [ ] No API keys, FFmpeg binaries or `package-lock.json` committed
