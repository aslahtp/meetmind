# App Icons

Place the following icon files here before building:

- `icon.ico` — Windows taskbar/exe icon (multi-resolution .ico file)
- `icon.png` — 512x512 PNG base icon
- `icon16.png` — 16x16 PNG (tray icon)
- `icon48.png` — 48x48 PNG
- `icon128.png` — 128x128 PNG

## Generating Icons

The source SVG is at `icon.svg`. To generate all sizes, install `sharp-cli`:

```bash
npx sharp-cli --input icon.svg --output icon16.png  --resize 16
npx sharp-cli --input icon.svg --output icon48.png  --resize 48
npx sharp-cli --input icon.svg --output icon128.png --resize 128
npx sharp-cli --input icon.svg --output icon512.png --resize 512
```

Then convert to .ico using https://convertio.co/png-ico/ or ImageMagick:
```bash
magick icon16.png icon48.png icon128.png icon512.png icon.ico
```
