/**
 * Builds the main process into dist/electron/ (`pnpm run compile:electron`), which package.json's
 * `main` and electron-builder use instead of the sources in electron/.
 *
 *  1. Empties dist/electron.
 *  2. Copies every .js file as it is. The port to TypeScript happens file by file, and tsc would add
 *     "use strict" to a plain JS file (it always does since TypeScript 6), which changes how the code
 *     runs. A file only gets compiled, and so becomes strict, when it is renamed to .ts.
 *  3. Compiles the .ts files with tsc (electron/tsconfig.build.json), if there are any yet.
 *
 * Run it with the app closed: it replaces the files the running app loads.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'electron');
const OUT = path.join(ROOT, 'dist', 'electron');

// Types only (electron/shared) and tooling files never run, so they are not copied.
const SKIP_DIRS = new Set([path.join(SRC, 'shared')]);

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(full)) walk(full, visit);
    } else {
      visit(full);
    }
  }
}

function isSource(file, ext) {
  return file.endsWith(ext) && !file.endsWith('.d.ts');
}

function copyJavaScript() {
  let count = 0;
  walk(SRC, (file) => {
    if (!isSource(file, '.js')) return;
    const dest = path.join(OUT, path.relative(SRC, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    count += 1;
  });
  return count;
}

function hasTypeScript() {
  let found = false;
  walk(SRC, (file) => {
    if (isSource(file, '.ts')) found = true;
  });
  return found;
}

function compileTypeScript() {
  const tsc = require.resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', path.join(SRC, 'tsconfig.build.json')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

fs.rmSync(OUT, { recursive: true, force: true });
const copied = copyJavaScript();
if (hasTypeScript()) compileTypeScript();
console.log(`dist/electron: ${copied} JavaScript file(s) copied${hasTypeScript() ? ', TypeScript compiled' : ''}`);
