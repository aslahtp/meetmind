import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

const MenuContext = createContext(null);

const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)';

export const MENU_ITEM = 'flex w-full items-center gap-8 rounded-input px-16 py-8 text-left text-caption font-medium text-ink transition-colors duration-150 hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Small dropdown menu: a "floating" panel (2px ink border, never a shadow) anchored to its trigger.
 * Opening focuses the selected (or first) item; arrows/Home/End move, Escape closes and returns
 * focus to the trigger, Tab or a click outside closes.
 *
 * `trigger(props)` renders the button and must spread `props` onto it.
 */
export default function Menu({ label, trigger, align = 'right', minWidth = 200, className = '', children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const items = () => [...(menuRef.current?.querySelectorAll(ITEM_SELECTOR) || [])];
    const list = items();
    (list.find((el) => el.getAttribute('aria-checked') === 'true') || list[0])?.focus();

    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const all = items();
        if (!all.length) return;
        const at = all.indexOf(document.activeElement);
        let next = 0;
        if (e.key === 'ArrowDown') next = (at + 1) % all.length;
        if (e.key === 'ArrowUp') next = (at - 1 + all.length) % all.length;
        if (e.key === 'End') next = all.length - 1;
        all[next].focus();
      } else if (e.key === 'Tab') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  return (
    <MenuContext.Provider value={close}>
      <div ref={rootRef} className={`relative ${className}`}>
        {trigger({
          ref: triggerRef,
          onClick: () => setOpen((o) => !o),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          open,
        })}
        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className={`floating rounded-image absolute top-full mt-8 z-30 p-4 fade-in ${align === 'left' ? 'left-0' : 'right-0'}`}
            style={{ minWidth }}
          >
            {children}
          </div>
        )}
      </div>
    </MenuContext.Provider>
  );
}

/** An action in a Menu. Closes the menu, then runs `onSelect`. */
export function MenuItem({ onSelect, icon, children, refocus = false, ...rest }) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        close(refocus);
        onSelect?.();
      }}
      className={MENU_ITEM}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** One choice in a single-select Menu group; the selected one carries a check. */
export function MenuRadioItem({ checked, onSelect, children }) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={() => {
        close(true);
        onSelect?.();
      }}
      className={`${MENU_ITEM} justify-between gap-16`}
    >
      {children}
      <Check
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className={`flex-shrink-0 ${checked ? 'opacity-100' : 'opacity-0'}`}
      />
    </button>
  );
}

/** Small uppercase heading over a group of menu items. */
export function MenuLabel({ children }) {
  return <p className="eyebrow px-16 pt-8 pb-4" aria-hidden="true">{children}</p>;
}
