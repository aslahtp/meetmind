/**
 * Generates MeetMind PNG + ICO icons from assets/icons/icon.svg
 * Run: npm run generate-icons
 */

'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets/icons/icon.svg');
const APP_ICONS = path.join(ROOT, 'assets/icons');
const EXT_ICONS = path.join(ROOT, 'extension/icons');

const APP_SIZES = [16, 24, 32, 48, 128, 256, 512];
const EXT_SIZES = [16, 48, 128];
const ICO_SIZES = [16, 24, 32, 48, 256];

async function renderPng(size, outPath) {
  await sharp(SVG)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
}

async function main() {
  if (!fs.existsSync(SVG)) {
    throw new Error(`Missing source SVG: ${SVG}`);
  }

  fs.mkdirSync(APP_ICONS, { recursive: true });
  fs.mkdirSync(EXT_ICONS, { recursive: true });

  for (const size of APP_SIZES) {
    const out = path.join(APP_ICONS, `icon${size}.png`);
    await renderPng(size, out);
    console.log(`✓ assets/icons/icon${size}.png`);
  }

  // Base icon used by electron-builder / docs
  await fs.promises.copyFile(
    path.join(APP_ICONS, 'icon512.png'),
    path.join(APP_ICONS, 'icon.png'),
  );
  console.log('✓ assets/icons/icon.png');

  for (const size of EXT_SIZES) {
    const out = path.join(EXT_ICONS, `icon${size}.png`);
    await renderPng(size, out);
    console.log(`✓ extension/icons/icon${size}.png`);
  }

  const icoBuffers = await Promise.all(
    ICO_SIZES.map((size) => fs.promises.readFile(path.join(APP_ICONS, `icon${size}.png`))),
  );
  const ico = await pngToIco(icoBuffers);
  const icoPath = path.join(APP_ICONS, 'icon.ico');
  await fs.promises.writeFile(icoPath, ico);
  console.log(`✓ assets/icons/icon.ico (${ico.length} bytes)`);

  // Clean stale temp artifacts if present
  for (const name of ['icon128-temp.png']) {
    const p = path.join(APP_ICONS, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
