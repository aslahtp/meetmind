'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * Embed MeetMind icon + version metadata into the Windows exe.
 * Needed because signAndEditExecutable is false (avoids winCodeSign symlink errors).
 * rcedit is a Windows binary, so skip it on non-Windows hosts.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (process.platform !== 'win32') {
    console.warn('[afterPack] Skipping rcedit on non-Windows host.');
    return;
  }

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

  execFileSync(rceditBin, [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'FileDescription', 'MeetMind',
    '--set-version-string', 'ProductName', 'MeetMind',
    '--set-version-string', 'CompanyName', 'MeetMind',
    '--set-version-string', 'OriginalFilename', `${productName}.exe`,
    '--set-file-version', version,
    '--set-product-version', version,
  ], { stdio: 'inherit' });
};
