/**
 * Generates MeetMind PNG + ICO icons from assets/icons/icon.svg
 * (sizes up to SMALL_MAX use the bolder assets/icons/icon-small.svg), plus the macOS menu-bar
 * template images from assets/icons/tray-template.svg
 * Run: pnpm run generate-icons
 */

'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets/icons/icon.svg');
const SVG_SMALL = path.join(ROOT, 'assets/icons/icon-small.svg');
const SVG_TRAY_TEMPLATE = path.join(ROOT, 'assets/icons/tray-template.svg');
const SMALL_MAX = 24;
const APP_ICONS = path.join(ROOT, 'assets/icons');
const EXT_ICONS = path.join(ROOT, 'extension/icons');

const APP_SIZES = [16, 24, 32, 48, 128, 256, 512, 1024];
// macOS menu-bar icon: 18pt, plus @2x for Retina. The "Template" suffix tells macOS to tint it.
const TRAY_TEMPLATE_SIZES = [[18, 'trayTemplate.png'], [36, 'trayTemplate@2x.png']];
const EXT_SIZES = [16, 48, 128];
const ICO_SIZES = [16, 24, 32, 48, 256];

async function renderPng(size, outPath, source = size <= SMALL_MAX && fs.existsSync(SVG_SMALL) ? SVG_SMALL : SVG) {
  await sharp(source, { density: 72 * Math.max(1, size / 128) * 4 })
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

  // Base icon used by electron-builder (the macOS .icns is derived from it, which needs 1024px)
  await fs.promises.copyFile(
    path.join(APP_ICONS, 'icon1024.png'),
    path.join(APP_ICONS, 'icon.png'),
  );
  console.log('✓ assets/icons/icon.png');

  for (const [size, name] of TRAY_TEMPLATE_SIZES) {
    await renderPng(size, path.join(APP_ICONS, name), SVG_TRAY_TEMPLATE);
    console.log(`✓ assets/icons/${name}`);
  }

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
