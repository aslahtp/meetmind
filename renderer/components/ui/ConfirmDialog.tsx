import React, { useState, useCallback, useRef } from 'react';
import Dialog from './Dialog';

// Promise-based confirmation: `const ok = await confirm({ title, message })`.
// Replaces window.confirm / window.alert across the renderer.
export function useConfirmDialog() {
  const [state, setState] = useState<any>(null);
  const resolverRef = useRef<any>(null);
  const confirmBtnRef = useRef<any>(null);

  const confirm = useCallback((opts: any) => {
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

  const settle = useCallback((value: any) => {
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
