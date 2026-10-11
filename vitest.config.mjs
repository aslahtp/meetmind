import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.js, whose `root: 'renderer'` would hide tests/ from Vitest.
// Tests live in tests/ (not next to the code) so electron-builder never packages them.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
    env: {
      // Main-process modules `require('electron')`, which in plain Node returns the binary's path.
      // Since Electron 42 that call first downloads the ~100 MB binary if it isn't installed (a
      // fresh CI checkout), stalling whichever test gets there first past its timeout. With an
      // override path, Electron's loader just returns a path and never downloads.
      ELECTRON_OVERRIDE_DIST_PATH: path.resolve('node_modules/electron/dist'),
    },
  },
});
