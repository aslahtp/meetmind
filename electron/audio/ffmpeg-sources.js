// Pinned FFmpeg downloads for macOS, shared by the in-app installer (`ffmpeg:install`) and the
// release/CI fetch script (scripts/fetch-ffmpeg.js). Pure: no electron import.
//
// Source: ffmpeg.martin-riedl.de release builds (static, Developer ID signed, one binary per
// zip). Every file is verified against the SHA-256 below before it is used. To bump: take the
// new release's versioned URLs and their .sha256 files, download each zip, check the hash
// yourself, then update this table. Intel (amd64) release builds there end in January 2027;
// mirror the pinned x64 zips before then.
//
// Windows is not listed here: release.yml pins its own gyan.dev build, and the in-app installer
// on Windows keeps downloading gyan.dev's current essentials build.

const FFMPEG_VERSION = '9.0.2';

const BASE = 'https://ffmpeg.martin-riedl.de/download/macos';

const MAC = {
  arm64: {
    ffmpeg: {
      url: `${BASE}/arm64/1789931890_9.0.2/ffmpeg.zip`,
      sha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
    },
    ffprobe: {
      url: `${BASE}/arm64/1789931890_9.0.2/ffprobe.zip`,
      sha256: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
    },
  },
  x64: {
    ffmpeg: {
      url: `${BASE}/amd64/1789931006_9.0.2/ffmpeg.zip`,
      sha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
    },
    ffprobe: {
      url: `${BASE}/amd64/1789931006_9.0.2/ffprobe.zip`,
      sha256: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd',
    },
  },
};

/**
 * The pinned { url, sha256 } downloads for a mac architecture, keyed by tool, or null when the
 * platform/arch has no pinned build.
 */
function macFfmpegSources(platform, arch) {
  if (platform !== 'darwin') return null;
  return MAC[arch] || null;
}

module.exports = { FFMPEG_VERSION, macFfmpegSources };
