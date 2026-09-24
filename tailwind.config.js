/** @type {import('tailwindcss').Config} */

// The theme is overridden (not extended) so only DESIGN.md tokens compile:
// the palette, DM Sans type scale, 8px spacing grid, named radii, and no shadows.
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './renderer/**/*.{html,js,jsx,ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      paper: token('paper'),
      ink: token('ink'),
      graphite: token('graphite'),
      sunshine: token('sunshine'),
      'sunshine-deep': token('sunshine-deep'),
      'on-sunshine': token('on-sunshine'),
      mint: token('mint'),
      signal: token('signal'),
    },
    fontFamily: {
      sans: ['DM Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      // Functional exception: log lines and code only — never body copy.
      mono: ['Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
    },
    fontSize: {
      caption:      ['14px', { lineHeight: '1.5' }],
      'body-sm':    ['16px', { lineHeight: '1.5' }],
      body:         ['18px', { lineHeight: '1.5' }],
      subheading:   ['20px', { lineHeight: '1.5' }],
      'heading-sm': ['24px', { lineHeight: '1.5' }],
      heading:      ['28px', { lineHeight: '1.25' }],
      display:      ['64px', { lineHeight: '1.25', letterSpacing: '-0.016em' }],
    },
    fontWeight: {
      normal: '400',
      medium: '500',
    },
    // 8px base grid, named after the DESIGN.md tokens (p-16 = 16px).
    // `4` is a half-step reserved for pill/badge internals.
    spacing: {
      0: '0px',
      px: '1px',
      4: '4px',
      8: '8px',
      16: '16px',
      24: '24px',
      32: '32px',
      48: '48px',
      64: '64px',
      128: '128px',
      192: '192px',
    },
    borderRadius: {
      none: '0px',
      input: '6px',
      image: '12px',
      card: '24px',
      button: '24px',
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
    },
    extend: {
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'rgb(var(--color-graphite))',
            '--tw-prose-headings': 'rgb(var(--color-ink))',
            '--tw-prose-lead': 'rgb(var(--color-graphite))',
            '--tw-prose-links': 'rgb(var(--color-ink))',
            '--tw-prose-bold': 'rgb(var(--color-ink))',
            '--tw-prose-counters': 'rgb(var(--color-ink))',
            '--tw-prose-bullets': 'rgb(var(--color-ink))',
            '--tw-prose-hr': 'rgb(var(--color-graphite) / 0.4)',
            '--tw-prose-quotes': 'rgb(var(--color-ink))',
            '--tw-prose-quote-borders': 'rgb(var(--color-ink))',
            '--tw-prose-captions': 'rgb(var(--color-graphite))',
            '--tw-prose-code': 'rgb(var(--color-ink))',
            '--tw-prose-pre-code': 'rgb(var(--color-ink))',
            '--tw-prose-pre-bg': 'rgb(var(--color-paper))',
            '--tw-prose-th-borders': 'rgb(var(--color-ink))',
            '--tw-prose-td-borders': 'rgb(var(--color-graphite) / 0.4)',
            fontSize: '18px',
            lineHeight: '1.5',
            maxWidth: 'none',
            'h1, h2, h3, h4': { fontWeight: '500' },
            h1: { fontSize: '28px' },
            h2: { fontSize: '24px' },
            h3: { fontSize: '20px' },
            h4: { fontSize: '18px' },
            a: { textUnderlineOffset: '3px' },
            code: {
              fontWeight: '400',
              border: '1px solid rgb(var(--color-ink))',
              borderRadius: '6px',
              padding: '0 4px',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: { border: '1px solid rgb(var(--color-ink))', borderRadius: '12px' },
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
