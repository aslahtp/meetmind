import React, { useState, useCallback, useRef } from 'react';
import Dialog from './Dialog';

/** What `confirm()` shows. Anything left out takes the default of a plain "Are you sure?". */
export interface ConfirmOptions {
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  /** `null` hides the Cancel button. */
  cancelLabel?: string | null;
  destructive?: boolean;
}

/** Resolves true when the user confirms, false when they cancel or dismiss. */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

// Promise-based confirmation: `const ok = await confirm({ title, message })`.
// Replaces window.confirm / window.alert across the renderer.
export function useConfirmDialog(): { confirm: ConfirmFn; element: React.ReactElement } {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
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

  const settle = useCallback((value: boolean) => {
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
