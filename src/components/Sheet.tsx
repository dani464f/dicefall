import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Bottom-drawer modal — used by Presets, History, Settings, and Skins.
 *
 * Accessibility:
 *  - role=dialog + aria-modal=true. The backdrop is a non-tabbable <div>
 *    (the previous <button> overlay broke aria-modal's promise by letting
 *    Tab escape behind the sheet).
 *  - Body scroll is locked while open.
 *  - Esc closes.
 *  - On open: focus is moved into the dialog (close button) and the
 *    previous activeElement is remembered. Tab/Shift-Tab cycle within
 *    the dialog. On close: focus is restored to the trigger.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey as (e: globalThis.KeyboardEvent) => void);
    return () =>
      window.removeEventListener('keydown', onKey as (e: globalThis.KeyboardEvent) => void);
  }, [open, onClose]);

  // Focus capture: remember opener, move focus into the dialog on open,
  // restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    // Defer until paint so the slide-in transition doesn't race the focus.
    const id = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = collectFocusable(dialog);
      const target = focusables[0] ?? dialog;
      target.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(id);
      previouslyFocusedRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = collectFocusable(dialog);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (active === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  return (
    <div
      className={
        'fixed inset-0 z-50 flex items-end justify-center ' +
        (open ? 'pointer-events-auto' : 'pointer-events-none')
      }
      aria-hidden={!open}
    >
      {/* Backdrop: presentational div, NOT a tabbable button. Clicking
          dismisses the sheet but Tab does not land here, so aria-modal
          keeps focus contained inside the dialog. B1: dimmed from /65
          to /55 so the underlying tavern scene still reads through. */}
      <div
        onClick={onClose}
        aria-hidden
        className={
          'absolute inset-0 bg-black/55 transition-opacity duration-300 ease-out ' +
          (open ? 'opacity-100' : 'opacity-0')
        }
      />
      <div
        ref={dialogRef}
        onKeyDown={onDialogKeyDown}
        className={
          'relative w-full max-w-md max-h-[85vh] flex flex-col rounded-t-2xl bg-bg transition-transform duration-300 ease-out ' +
          (open ? 'translate-y-0' : 'translate-y-full')
        }
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          // B1: lighter drop shadow + a hairline gold top edge ornament
          // so the sheet feels "stamped" rather than walled-off.
          boxShadow: '0 -6px 22px rgba(0,0,0,0.42)',
          borderTop:
            '1px solid color-mix(in srgb, var(--color-gold) 22%, transparent)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {/* Grab-handle hint — a small centered bar above the header to read
            as a dismissable drawer on mobile. Drawn with the gold ramp so
            it tints with the skin. */}
        <span
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 top-1.5 w-9 h-1 rounded-full"
          style={{
            background:
              'color-mix(in srgb, var(--color-gold) 28%, transparent)',
          }}
        />
        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-display text-lg text-ivory tracking-wide">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="relative w-11 h-11 rounded-full border border-subtle text-secondary hover:text-ivory hover:border-gold/55 flex items-center justify-center transition-colors duration-150"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function collectFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}
