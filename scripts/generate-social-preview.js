'use strict';

/**
 * Renders site/og.html to docs/brand/social-preview.png (1280x640), used as the
 * GitHub social preview and the website's Open Graph image.
 * Run with: pnpm exec electron scripts/generate-social-preview.js
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'brand', 'social-preview.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 640,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true },
  });
  await win.loadFile(path.join(root, 'site', 'og.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 });
  const resized = image.getSize().width === 1280 ? image : image.resize({ width: 1280, height: 640 });
  fs.writeFileSync(out, resized.toPNG());
  console.log(`Wrote ${path.relative(root, out)}`);
  app.quit();
});
