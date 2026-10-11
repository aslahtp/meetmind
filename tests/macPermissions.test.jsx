import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../renderer/lib/app-context.js';
import MacPermissions from '../renderer/components/settings/MacPermissions.jsx';

// The Permissions card only renders on macOS, so it can't be seen in the Windows dev app; this
// at least renders it to markup to catch crashes and check the copy.
function render(ctx) {
  return renderToStaticMarkup(
    React.createElement(AppContext.Provider, { value: ctx }, React.createElement(MacPermissions)),
  );
}

describe('MacPermissions', () => {
  it('lists both permissions and every capture method, marking the one in use', () => {
    const html = render({ config: { macCaptureStrategy: 'frame' }, updateConfig: () => {}, isRecording: false });
    expect(html).toContain('Microphone');
    expect(html).toContain('Screen &amp; System Audio Recording');
    expect(html).toContain('Screen source');
    expect(html).toContain('App window source · in use');
    expect(html).toContain('System picker');
  });

  it('asks to stop a running recording before testing', () => {
    const html = render({ config: {}, updateConfig: () => {}, isRecording: true });
    expect(html).toContain('Stop the current recording to run a test.');
  });
});
