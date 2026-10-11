// Pinned FFmpeg downloads: the single source of truth for every FFmpeg MeetMind ships or installs.
// Used by the in-app installer (`ffmpeg:install`, electron/services/ffmpeg-installer.js) and by
// scripts/fetch-ffmpeg.js, which stages the binaries for CI and release builds. Pure: no
// electron import.
//
// Every zip is verified against the SHA-256 below before it is unpacked. To bump a build: take
// the new release's versioned URLs, download each zip, compute its SHA-256 yourself (don't just
// copy a hash published next to the file), then update this table and FFMPEG_VERSION.
//
// - Windows: the "essentials" build from GyanD/codexffmpeg on GitHub (the same builds gyan.dev
//   serves); one zip holding both executables under bin/.
// - macOS: ffmpeg.martin-riedl.de release builds (static, Developer ID signed), one zip per
//   tool. Intel (amd64) release builds there end in January 2027; mirror the pinned x64 zips
//   before then (see docs/KNOWN_ISSUES.md).

const FFMPEG_VERSION = '9.0.2';

const GYAN = 'https://github.com/GyanD/codexffmpeg/releases/download';
const RIEDL = 'https://ffmpeg.martin-riedl.de/download/macos';

// `${platform}-${arch}` → the zips that together provide ffmpeg and ffprobe. `tools` names the
// executables (without .exe) found anywhere inside each zip.
const SOURCES = {
  'win32-x64': [
    {
      url: `${GYAN}/9.0.2/ffmpeg-9.0.2-essentials_build.zip`,
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
      tools: ['ffmpeg', 'ffprobe'],
    },
  ],
  'darwin-arm64': [
    {
      url: `${RIEDL}/arm64/1789931890_9.0.2/ffmpeg.zip`,
      sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
      tools: ['ffmpeg'],
    },
    {
      url: `${RIEDL}/arm64/1789931890_9.0.2/ffprobe.zip`,
      sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
      tools: ['ffprobe'],
    },
  ],
  'darwin-x64': [
    {
      url: `${RIEDL}/amd64/1789931006_9.0.2/ffmpeg.zip`,
      sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
      tools: ['ffmpeg'],
    },
    {
      url: `${RIEDL}/amd64/1789931006_9.0.2/ffprobe.zip`,
      sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd',
      tools: ['ffprobe'],
    },
  ],
};

/**
 * The pinned downloads ({ url, sha256, tools }[]) for a platform/arch, or null when there is
 * no pinned build for it.
 */
function ffmpegDownloads(platform, arch) {
  return SOURCES[`${platform}-${arch}`] || null;
}

/** Every platform/arch with a pinned build, as `${platform}-${arch}` keys. */
function pinnedTargets() {
  return Object.keys(SOURCES);
}

module.exports = { FFMPEG_VERSION, ffmpegDownloads, pinnedTargets };
