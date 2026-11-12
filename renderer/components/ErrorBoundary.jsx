import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { EmptyState } from './ui/index.jsx';
import WindowControls from './WindowControls.jsx';
import { reportError } from '../lib/errorReport.js';
import { isMac } from '../lib/os.js';

// Catches an error thrown while rendering its children and shows `fallback` in their place.
// Without a boundary React unmounts the whole tree, which left the window empty: no content, and
// (the window being frameless) no buttons to close it with.
//
// `fallback` is a component given { error, reset }; `reset` renders the children again. `name`
// labels the boundary in the log.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = () => this.setState({ error: null });
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError('render', error, {
      boundary: this.props.name,
      componentStack: typeof info?.componentStack === 'string' ? info.componentStack.slice(0, 4000) : undefined,
    });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const Fallback = this.props.fallback || ViewErrorFallback;
    return <Fallback error={error} reset={this.reset} />;
  }
}

function OpenLogsButton() {
  if (typeof window === 'undefined' || !window.meetmind?.logs?.openFolder) return null;
  return (
    <button type="button" className="btn-ghost" onClick={() => window.meetmind.logs.openFolder()}>
      Open logs folder
    </button>
  );
}

// One page failed; the top bar and navigation around it still work.
export function ViewErrorFallback({ reset }) {
  return (
    <div className="h-full overflow-y-auto px-24" role="alert">
      <EmptyState
        compact
        icon={<TriangleAlert size={24} strokeWidth={1.75} />}
        title="This page couldn’t be shown"
        message="Something went wrong while displaying it. Your meetings and recordings are safe. Try again, or open another page from the bar above."
        action={(
          <>
            <button type="button" className="btn-ink" onClick={reset}>Try again</button>
            <OpenLogsButton />
          </>
        )}
      />
    </div>
  );
}

// The whole app failed, top bar included, so this draws its own drag strip and window buttons.
export function AppErrorFallback() {
  // The page did load: main must not take the missing "app is up" signal for a failed load.
  React.useEffect(() => { window.meetmind?.window?.ready?.(); }, []);
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-paper text-ink" role="alert">
      <header className="titlebar-drag flex-shrink-0 h-64 flex items-center justify-end border-b border-ink select-none">
        {!isMac && <WindowControls />}
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto px-24 flex items-center justify-center">
        <EmptyState
          compact
          icon={<TriangleAlert size={24} strokeWidth={1.75} />}
          title="MeetMind ran into a problem"
          message="Your meetings and recordings are safe, and a recording in progress keeps running. Reload to get back to the app."
          action={(
            <>
              <button type="button" className="btn-sunshine" onClick={() => window.location.reload()}>Reload MeetMind</button>
              <OpenLogsButton />
            </>
          )}
        />
      </main>
    </div>
  );
}
