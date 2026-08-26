'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function resolveWineBin() {
  if (process.env.WINE) return process.env.WINE;
  for (const cmd of ['wine64', 'wine']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

function runRcedit(rceditBin, args) {
  if (process.platform === 'win32') {
    execFileSync(rceditBin, args, { stdio: 'inherit' });
    return;
  }

  const wineBin = resolveWineBin();
  if (!wineBin) {
    console.warn('[afterPack] Skipping rcedit: wine is required to edit Windows executables on this host.');
    return;
  }

  execFileSync(wineBin, [rceditBin, ...args], {
    stdio: 'inherit',
    env: { ...process.env, WINEDEBUG: process.env.WINEDEBUG || '-all' },
  });
}

/**
 * Embed MeetMind icon + version metadata into the Windows exe.
 * Needed because signAndEditExecutable is false (avoids winCodeSign symlink errors).
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productName = context.packager.appInfo.productFilename || 'MeetMind';
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'assets', 'icons', 'icon.ico');
  const rceditBin = path.join(
    context.packager.projectDir,
    'node_modules',
    'rcedit',
    'bin',
    process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit-x64.exe',
  );

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] exe not found: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] icon not found: ${iconPath}`);
    return;
  }
  if (!fs.existsSync(rceditBin)) {
    console.warn(`[afterPack] rcedit not found: ${rceditBin}`);
    return;
  }

  const version = context.packager.appInfo.version || '1.0.0';
  console.log(`[afterPack] Embedding icon into ${exePath}`);

  runRcedit(rceditBin, [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'FileDescription', 'MeetMind',
    '--set-version-string', 'ProductName', 'MeetMind',
    '--set-version-string', 'CompanyName', 'MeetMind',
    '--set-version-string', 'OriginalFilename', `${productName}.exe`,
    '--set-file-version', version,
    '--set-product-version', version,
  ]);
};
