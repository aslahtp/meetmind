/**
 * Packages the Chrome extension into dist/meetmind-extension.zip
 * with all files under an "Extension" folder.
 * Run: npm run build:ext
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXTENSION_SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const STAGING_ROOT = path.join(DIST, '_ext-staging');
const STAGING_DIR = path.join(STAGING_ROOT, 'meetmind-chrome-extension');
const ZIP_PATH = path.join(DIST, 'meetmind-extension.zip');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifestPath = path.join(EXTENSION_SRC, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
fs.cpSync(EXTENSION_SRC, STAGING_DIR, { recursive: true });

try {
  if (process.platform === 'win32') {
    execSync(
      `powershell Compress-Archive -Path "${STAGING_DIR}" -DestinationPath "${ZIP_PATH}" -Force`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(
      `cd "${STAGING_ROOT}" && zip -r "${ZIP_PATH}" meetmind-chrome-extension`,
      { stdio: 'inherit' }
    );
  }
} catch (err) {
  console.error('Failed to create extension zip:', err.message);
  process.exit(1);
} finally {
  fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
}

console.log(`✓ ${path.relative(ROOT, ZIP_PATH)} (Extension/...)`);
