import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

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

  // TypeScript (gradual port, see plan.md): typescript-eslint's recommended rules for .ts/.tsx only,
  // loosened where the port needs it. Tightened again when strict mode is switched on.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: TS_FILES })),
  {
    files: TS_FILES,
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // Lazy `require()` of native/heavy modules (koffi, sql.js, googleapis...) must stay synchronous.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // The renderer is bundled by Vite and runs in a browser: from electron/ (the shared types) it may only
  // `import type`, so no main-process code can end up in the bundle.
  {
    files: ['renderer/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/electron/**', '@shared', '@shared/**'],
              allowTypeImports: true,
              message: 'The renderer may only `import type` from electron/shared (never runtime code from electron/).',
            },
          ],
        },
      ],
    },
  },

  // Electron main process, preload and build scripts: Node. JS files are CommonJS; TS files are
  // written as modules and emitted as CommonJS by tsc.
  {
    files: ['electron/**/*.js', 'scripts/**/*.js', '*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['electron/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Preload runs in the renderer's isolated world, so it also sees the DOM.
  {
    files: ['electron/preload.{js,ts}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['vite.config.{js,ts}', 'vitest.config.{mjs,ts}', 'eslint.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Chrome MV3 extension: classic scripts in the page, overlay and popup; the service worker apart.
  {
    files: ['extension/**/*.{js,ts}'],
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
    files: ['extension/background.{js,ts}'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
  },

  // React renderer (ES modules, JSX/TSX).
  {
    files: ['renderer/**/*.{js,jsx,ts,tsx}'],
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
    files: ['**/*.test.{js,jsx,ts,tsx}'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
