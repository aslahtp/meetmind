# App Icons

Source: `icon.svg` (32px and up) and `icon-small.svg`, a bolder variant used for 16px and 24px so the tray icon stays legible. `tray-template.svg` is the macOS menu-bar icon: a black mic on transparent that macOS tints for light and dark menu bars. Keep `extension/icons/icon.svg` a copy of `icon.svg`.

Generate all sizes, the Windows `.ico` and the macOS tray templates with:

```bash
pnpm run generate-icons
```

Produces:

- `icon.ico` — Windows exe / installer / taskbar
- `icon16.png` … `icon1024.png` — PNG sizes (Windows tray uses 16/32)
- `icon.png` — 1024×1024 base; electron-builder derives the macOS `.icns` from it
- `trayTemplate.png`, `trayTemplate@2x.png` — macOS menu-bar icon (18pt and Retina)
- Matching PNGs under `extension/icons/`
