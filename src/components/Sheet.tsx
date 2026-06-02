import { useEffect, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  // Lock body scroll while open so the sheet is the only scroll surface
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={
        'fixed inset-0 z-50 flex items-end justify-center ' +
        (open ? 'pointer-events-auto' : 'pointer-events-none')
      }
      aria-hidden={!open}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        tabIndex={open ? 0 : -1}
        className={
          'absolute inset-0 bg-black/65 transition-opacity duration-300 ease-out ' +
          (open ? 'opacity-100' : 'opacity-0')
        }
      />
      <div
        className={
          'relative w-full max-w-md max-h-[85vh] flex flex-col rounded-t-3xl bg-bg border-t border-subtle shadow-[0_-12px_36px_rgba(0,0,0,0.55)] transition-transform duration-300 ease-out ' +
          (open ? 'translate-y-0' : 'translate-y-full')
        }
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="font-display text-xl text-ivory">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="w-9 h-9 rounded-full border border-subtle text-secondary hover:text-ivory hover:border-gold/60 flex items-center justify-center transition-colors duration-150"
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
