# FFmpeg Binaries

Place the Windows FFmpeg binaries here before building or running the app.

## Required Files

- `ffmpeg.exe` — FFmpeg encoder/decoder (required for audio capture)
- `ffprobe.exe` — FFmpeg probe tool (optional, used for media analysis)

## Download Instructions

1. Go to https://www.gyan.dev/ffmpeg/builds/ (recommended Windows builds)
2. Download `ffmpeg-release-essentials.zip` (the "essentials" build)
3. Extract and copy `bin/ffmpeg.exe` and `bin/ffprobe.exe` into this folder

### Alternatively via winget / chocolatey:
```
winget install ffmpeg
# Then locate ffmpeg.exe (usually C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\...) and copy here
```

## Notes

- FFmpeg must support `dshow` (DirectShow) — which all Windows builds do
- Minimum recommended version: FFmpeg 6.0+
- These binaries are NOT included in the repository (too large for git)
- In the packaged app (installer), these files are bundled as `extraResources`
  and placed at `%INSTALLDIR%\resources\ffmpeg\`

## License

FFmpeg is licensed under the LGPL 2.1+ or GPL 2+ depending on build configuration.
See https://ffmpeg.org/legal.html for details.
