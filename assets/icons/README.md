# App Icons

Source: `icon.svg` (32px and up) and `icon-small.svg`, a bolder variant used for 16px and 24px so the tray icon stays legible. Keep `extension/icons/icon.svg` a copy of `icon.svg`.

Generate all sizes + Windows `.ico` with:

```bash
pnpm run generate-icons
```

Produces:

- `icon.ico` — Windows exe / installer / taskbar
- `icon16.png` … `icon512.png` — PNG sizes (tray uses 16/32)
- `icon.png` — 512×512 base
- Matching PNGs under `extension/icons/`
