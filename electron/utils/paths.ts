// Where the app's own files live, independent of where this code runs from.
//
// The main process runs from compiled output (`dist/electron/`, built by `pnpm run compile:electron`),
// but its tests and a few scripts load the sources in `electron/`, and a packaged app keeps everything
// inside app.asar. `dist/renderer/` and `assets/` sit next to `package.json` in every one of those, so
// the app root is the nearest folder above this file that has a package.json; no `../` counting that
// breaks when the output folder moves.
//
// No `electron` import: provider and audio modules use this and must stay loadable in plain Node.

import fs from 'fs';
import path from 'path';

function findAppRoot(startDir: any) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const appRoot = findAppRoot(__dirname);

export { appRoot, findAppRoot };
