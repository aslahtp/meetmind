# App Icons

Source: `icon.svg`

Generate all sizes + Windows `.ico` with:

```bash
npm run generate-icons
```

Produces:

- `icon.ico` — Windows exe / installer / taskbar
- `icon16.png` … `icon512.png` — PNG sizes (tray uses 16/32)
- `icon.png` — 512×512 base
- Matching PNGs under `extension/icons/`
