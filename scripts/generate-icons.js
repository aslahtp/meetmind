/**
 * Generates placeholder PNG icons for the extension and app.
 * Run: node scripts/generate-icons.js
 *
 * Requires: npm install canvas
 * Or alternatively, manually place icon files as described in assets/icons/README.md
 */

const path = require('path');
const fs   = require('fs');

// Try to use 'canvas' package if available
let canvas;
try {
  canvas = require('canvas');
} catch {
  console.log('Note: "canvas" package not installed. Generating minimal placeholder icons instead.');
  canvas = null;
}

const SIZES = [16, 48, 128];

function drawIcon(ctx, size) {
  const s = size;
  const r = s * 0.19; // corner radius

  // Background
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, 0, 0, s, s, r);
  ctx.fill();

  // Green circle bg
  ctx.fillStyle = 'rgba(34,197,94,0.15)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.375, 0, Math.PI * 2);
  ctx.fill();

  // Microphone
  ctx.strokeStyle = '#22c55e';
  ctx.fillStyle   = '#22c55e';

  const mw = s * 0.25;
  const mh = s * 0.4;
  const mx = (s - mw) / 2;
  const my = s * 0.15;
  const mr = mw / 2;

  // Mic body
  roundRect(ctx, mx, my, mw, mh, mr);
  ctx.fill();

  // Stand arc
  ctx.lineWidth   = s * 0.05;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.arc(s / 2, my + mh, s * 0.22, Math.PI, 0);
  ctx.stroke();

  // Pole
  ctx.beginPath();
  ctx.moveTo(s / 2, my + mh + s * 0.22);
  ctx.lineTo(s / 2, s * 0.87);
  ctx.stroke();

  // Base
  ctx.beginPath();
  ctx.moveTo(s * 0.34, s * 0.87);
  ctx.lineTo(s * 0.66, s * 0.87);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function generateWithCanvas() {
  const { createCanvas } = canvas;

  const extensionIconsDir = path.join(__dirname, '../extension/icons');
  const appIconsDir       = path.join(__dirname, '../assets/icons');

  fs.mkdirSync(extensionIconsDir, { recursive: true });
  fs.mkdirSync(appIconsDir,       { recursive: true });

  for (const size of SIZES) {
    const c   = createCanvas(size, size);
    const ctx = c.getContext('2d');
    drawIcon(ctx, size);
    const buf = c.toBuffer('image/png');

    fs.writeFileSync(path.join(extensionIconsDir, `icon${size}.png`), buf);
    fs.writeFileSync(path.join(appIconsDir,       `icon${size}.png`), buf);
    console.log(`✓ Generated icon${size}.png`);
  }

  // Also write the 512 version for app
  const c512 = createCanvas(512, 512);
  drawIcon(c512.getContext('2d'), 512);
  fs.writeFileSync(path.join(appIconsDir, 'icon512.png'), c512.toBuffer('image/png'));
  fs.writeFileSync(path.join(appIconsDir, 'icon.png'), c512.toBuffer('image/png'));
  console.log('✓ Generated icon512.png and icon.png');
  console.log('\nDone! Remember to also generate icon.ico for Windows (see assets/icons/README.md)');
}

function generateMinimalPlaceholder() {
  // Create a minimal 1x1 valid PNG as placeholder
  // Actual PNG header + IHDR + IDAT + IEND for a 1x1 green pixel
  const PNG_1x1_GREEN = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e000000134944415478016360f8cfc040000000200001e221bc330000000049454e44ae426082',
    'hex'
  );

  const extensionIconsDir = path.join(__dirname, '../extension/icons');
  const appIconsDir       = path.join(__dirname, '../assets/icons');

  fs.mkdirSync(extensionIconsDir, { recursive: true });
  fs.mkdirSync(appIconsDir,       { recursive: true });

  for (const size of SIZES) {
    fs.writeFileSync(path.join(extensionIconsDir, `icon${size}.png`), PNG_1x1_GREEN);
    fs.writeFileSync(path.join(appIconsDir,       `icon${size}.png`), PNG_1x1_GREEN);
    console.log(`⚠ Placeholder created: icon${size}.png (1x1 — replace with real icon)`);
  }

  console.log('\nTo generate real icons, install "canvas": npm install canvas');
  console.log('Then run: node scripts/generate-icons.js');
}

if (canvas) {
  generateWithCanvas();
} else {
  generateMinimalPlaceholder();
}
