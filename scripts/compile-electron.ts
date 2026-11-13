/**
 * Builds the main process into dist/electron/ (`pnpm run compile:electron`), which package.json's
 * `main` and electron-builder use instead of the sources in electron/.
 *
 *  1. Empties dist/electron.
 *  2. Compiles every .ts file with tsc (electron/tsconfig.build.json).
 *
 * Run it with the app closed: it replaces the files the running app loads.
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'electron');

fs.rmSync(OUT, { recursive: true, force: true });

const tsc = require.resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'electron', 'tsconfig.build.json')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log('dist/electron: TypeScript compiled');
