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

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
fs.cpSync(EXTENSION_SRC, STAGING_DIR, { recursive: true });

execSync(
  `powershell Compress-Archive -Path "${STAGING_DIR}" -DestinationPath "${ZIP_PATH}" -Force`,
  { stdio: 'inherit' }
);

fs.rmSync(STAGING_ROOT, { recursive: true, force: true });

console.log(`✓ ${path.relative(ROOT, ZIP_PATH)} (Extension/...)`);
