/**
 * Builds the Chrome extension and packages it into dist/meetmind-extension.zip with all files under
 * an "Extension" folder.
 *
 *  1. Compiles the TypeScript scripts (extension/tsconfig.build.json) into dist/extension/.
 *  2. Copies the static files (manifest, HTML, CSS, fonts, icons) next to them.
 *  3. Stamps package.json's version into dist/extension/manifest.json (the source manifest is not touched).
 *  4. Zips it.
 *
 * Run: pnpm run build:ext
 */

import path from 'path';
import fs from 'fs';
import { execFileSync, execSync, spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..');
const EXTENSION_SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const BUILD_DIR = path.join(DIST, 'extension');
const STAGING_ROOT = path.join(DIST, '_ext-staging');
const STAGING_DIR = path.join(STAGING_ROOT, 'meetmind-chrome-extension');
const ZIP_PATH = path.join(DIST, 'meetmind-extension.zip');

fs.mkdirSync(DIST, { recursive: true });
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

const tsc = require.resolve('typescript/bin/tsc');
const compiled = spawnSync(process.execPath, [tsc, '-p', path.join(EXTENSION_SRC, 'tsconfig.build.json')], { stdio: 'inherit' });
if (compiled.status !== 0) process.exit(compiled.status || 1);

// Everything that is not a TypeScript source or tooling file ships as it is.
fs.cpSync(EXTENSION_SRC, BUILD_DIR, {
  recursive: true,
  filter: (src) => !src.endsWith('.ts') && !path.basename(src).startsWith('tsconfig'),
});

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifestPath = path.join(BUILD_DIR, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
fs.cpSync(BUILD_DIR, STAGING_DIR, { recursive: true });

try {
  if (process.platform === 'win32') {
    // Windows' own bsdtar writes zips. Called by full path because Git Bash puts GNU tar first on PATH
    // (it reads `C:` as a host name), and it is far faster than PowerShell's Compress-Archive, which
    // has been seen to hang for many minutes.
    const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    fs.rmSync(ZIP_PATH, { force: true });
    execFileSync(winTar, ['-a', '-c', '-f', ZIP_PATH, 'meetmind-chrome-extension'], { cwd: STAGING_ROOT, stdio: 'inherit' });
  } else {
    execSync(
      `cd "${STAGING_ROOT}" && zip -r "${ZIP_PATH}" meetmind-chrome-extension`,
      { stdio: 'inherit' }
    );
  }
} catch (err: any) {
  console.error('Failed to create extension zip:', err.message);
  process.exit(1);
} finally {
  fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
}

console.log(`✓ ${path.relative(ROOT, ZIP_PATH)} (Extension/...)`);
