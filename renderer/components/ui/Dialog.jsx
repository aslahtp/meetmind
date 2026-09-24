import React, { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal dialog: role="dialog", Escape + backdrop to close, focus trapped inside,
// focus restored to the opener on close. Raised with a 2px border, never a shadow.
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocusRef,
}) {
  const panelRef = useRef(null);
  const openerRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  // Parents often pass an inline onClose; keep it in a ref so the focus effect
  // below doesn't re-run (and steal focus) on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;

    const panel = panelRef.current;
    const focusFirst = () => {
      const target = initialFocusRef?.current || panel?.querySelector(FOCUSABLE) || panel;
      target?.focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      openerRef.current?.focus?.();
    };
  }, [open, dismissible, initialFocusRef]);

  if (!open) return null;

  const width = size === 'lg' ? 'max-w-[720px]' : size === 'sm' ? 'max-w-[440px]' : 'max-w-[560px]';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-24 bg-paper/70 fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`floating rounded-card w-full ${width} max-h-[calc(100vh-48px)] flex flex-col outline-none`}
      >
        {(title || dismissible) && (
          <div className="flex items-start justify-between gap-16 px-32 pt-32 pb-16">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-heading-sm font-medium text-ink">{title}</h2>}
              {description && <p id={descId} className="text-body-sm text-graphite mt-4">{description}</p>}
            </div>
            {dismissible && (
              <button type="button" className="icon-btn flex-shrink-0" onClick={onClose} aria-label="Close dialog">
                <X size={18} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
        <div className="px-32 pb-24 overflow-y-auto min-h-0 flex-1">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-8 px-32 py-24 border-t border-ink">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
