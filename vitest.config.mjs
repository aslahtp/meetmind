import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.js, whose `root: 'renderer'` would hide tests/ from Vitest.
// Tests live in tests/ (not next to the code) so electron-builder never packages them.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
  },
});
