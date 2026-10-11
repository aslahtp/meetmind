# FFmpeg Binaries

Place the FFmpeg binaries here before building or running the app from source. electron-builder
bundles them into the app as `resources/ffmpeg/`. They are never committed (too large for git, and
CI's repo-hygiene check rejects them).

The quickest way is `pnpm run fetch-ffmpeg`: it downloads the pinned build for your OS (the one
the releases ship; pins in `electron/audio/ffmpeg-sources.js`), checks its SHA-256 and puts the
files where they belong.

## Windows

Required files, at the root of this folder:

- `ffmpeg.exe` — FFmpeg encoder/decoder (required for audio capture)
- `ffprobe.exe` — FFmpeg probe tool (used for media durations)

`pnpm run fetch-ffmpeg` puts the pinned essentials build here (from GyanD/codexffmpeg, the same
builds gyan.dev serves). To do it by hand:

1. Go to https://www.gyan.dev/ffmpeg/builds/ (recommended Windows builds)
2. Download `ffmpeg-release-essentials.zip` (the "essentials" build)
3. Extract and copy `bin/ffmpeg.exe` and `bin/ffprobe.exe` into this folder

### Alternatively via winget / chocolatey:
```
winget install ffmpeg
# Then locate ffmpeg.exe (usually C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\...) and copy here
```

FFmpeg must support `dshow` (DirectShow) and `wasapi`, as the gyan.dev builds do. In the installed
app they live at `%INSTALLDIR%\resources\ffmpeg\`.

## macOS

One folder per architecture: `mac-arm64/` (Apple silicon) and `mac-x64/` (Intel), each holding
`ffmpeg` and `ffprobe`. Fetch the pinned, checksum-verified builds (from
ffmpeg.martin-riedl.de; pins in `electron/audio/ffmpeg-sources.js`) with:

```
pnpm run fetch-ffmpeg                    # both architectures
pnpm run fetch-ffmpeg -- --arch arm64    # just one
```

For development you can also skip this and `brew install ffmpeg`: the app finds Homebrew's
`/opt/homebrew/bin` and `/usr/local/bin`. The in-app download installs into the app's data folder
(`~/Library/Application Support/MeetMind/ffmpeg/`), never inside the app bundle.

## Notes

- Minimum recommended version: FFmpeg 6.0+
- The Opus decoder is required (the app records Opus WebM and converts it to WAV).

## License

FFmpeg is licensed under the LGPL 2.1+ or GPL 2+ depending on build configuration.
See https://ffmpeg.org/legal.html for details.
