import React, { useState, useCallback, useRef } from 'react';
import Dialog from './Dialog.jsx';

// Promise-based confirmation: `const ok = await confirm({ title, message })`.
// Replaces window.confirm / window.alert across the renderer.
export function useConfirmDialog() {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);
  const confirmBtnRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        title: 'Are you sure?',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        destructive: false,
        ...opts,
      });
    });
  }, []);

  const settle = useCallback((value) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
  }, []);

  const element = (
    <Dialog
      open={!!state}
      onClose={() => settle(false)}
      title={state?.title}
      size="sm"
      initialFocusRef={confirmBtnRef}
      footer={
        <>
          {state?.cancelLabel !== null && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => settle(false)}>
              {state?.cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`${state?.destructive ? 'btn-danger' : 'btn-ink'} btn-sm`}
            onClick={() => settle(true)}
          >
            {state?.confirmLabel}
          </button>
        </>
      }
    >
      {state?.message && <p className="text-body-sm text-graphite">{state.message}</p>}
    </Dialog>
  );

  return { confirm, element };
}
