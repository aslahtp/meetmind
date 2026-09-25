import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/**', 'site/**', '.claude/**'],
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Electron main process, preload and build scripts: CommonJS on Node.
  {
    files: ['electron/**/*.js', 'scripts/**/*.js', '*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  // Preload runs in the renderer's isolated world, so it also sees the DOM.
  {
    files: ['electron/preload.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['vite.config.js', 'vitest.config.mjs', 'eslint.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Chrome MV3 extension: classic scripts in the page, overlay and popup; the service worker apart.
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      // Top-level helpers may share a name with newer DOM globals (e.g. `requestResize`).
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    files: ['extension/background.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
  },

  // React renderer (ES modules, JSX).
  {
    files: ['renderer/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      // Automatic JSX runtime, but files still `import React` by convention (keeps it "used").
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Apostrophes and quotes in UI copy are fine; only flag characters that are usually typos.
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Tests run under Vitest on Node.
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
