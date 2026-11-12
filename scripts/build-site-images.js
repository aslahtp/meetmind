/**
 * Website images, run by scripts/build-site.sh on the assembled site folder:
 * - every screenshots/*.png gets AVIF copies 750, 1100 and 1500 px wide (`name-750.avif`, …),
 *   which site/index.html lists in each <picture>'s srcset; the PNGs stay as the fallback.
 * - the header wordmarks are resized to twice their 115x36 display size.
 * Run: node scripts/build-site-images.js <site folder>
 */

'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SCREENSHOT_WIDTHS = [750, 1100, 1500];
// Screenshots are mostly UI text, which blurs at AVIF's default quality of 50.
const AVIF_OPTIONS = { quality: 62, effort: 6 };
const WORDMARK_WIDTH = 230;

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: node scripts/build-site-images.js <site folder>');

  const shotsDir = path.join(out, 'screenshots');
  const shots = fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png'));
  let before = 0;
  let after = 0;
  for (const file of shots) {
    const src = path.join(shotsDir, file);
    before += fs.statSync(src).size;
    for (const width of SCREENSHOT_WIDTHS) {
      const dest = path.join(shotsDir, `${path.basename(file, '.png')}-${width}.avif`);
      await sharp(src).resize({ width, withoutEnlargement: true }).avif(AVIF_OPTIONS).toFile(dest);
      if (width === Math.max(...SCREENSHOT_WIDTHS)) after += fs.statSync(dest).size;
    }
  }

  const brandDir = path.join(out, 'brand');
  for (const file of fs.readdirSync(brandDir).filter((f) => /^meetmind-wordmark-.*\.png$/.test(f))) {
    const src = path.join(brandDir, file);
    const resized = await sharp(src)
      .resize({ width: WORDMARK_WIDTH, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    fs.writeFileSync(src, resized);
  }

  const kb = (n) => Math.round(n / 1024);
  console.log(`Site images: ${shots.length} screenshots, ${kb(before)} KB of PNG -> ${kb(after)} KB of full-size AVIF`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
