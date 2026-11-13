import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { ViewErrorFallback, AppErrorFallback } from '../renderer/components/ErrorBoundary';

// React's server renderer doesn't run error boundaries, so the catching itself is exercised in the
// running app; this covers the state transition and that both recovery screens render.
describe('ErrorBoundary', () => {
  it('switches to its fallback state when a child throws', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it('renders its children while nothing has failed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorBoundary, { name: 'test' }, React.createElement('p', null, 'All good')),
    );
    expect(html).toBe('<p>All good</p>');
  });

  it('offers to try the page again', () => {
    const html = renderToStaticMarkup(React.createElement(ViewErrorFallback, { reset: () => {} }));
    expect(html).toContain('This page couldn’t be shown');
    expect(html).toContain('Try again');
    expect(html).toContain('role="alert"');
  });

  it('keeps the window buttons on the full-window crash screen', () => {
    const html = renderToStaticMarkup(React.createElement(AppErrorFallback));
    expect(html).toContain('MeetMind ran into a problem');
    expect(html).toContain('Reload MeetMind');
    expect(html).toContain('Close window');
    expect(html).toContain('Minimize window');
  });
});
