import { useRef, type KeyboardEvent } from 'react';
import { ALL_DICE, type DiceType } from '../types/dice';

interface DiceSelectorProps {
  selected: DiceType;
  onSelect: (d: DiceType) => void;
}

/**
 * Tavern dice rack — horizontal row of D4..D100 with thin gold dividers
 * between them. Active die glows gold; rest are subtle parchment-on-leather.
 *
 * A11y: rendered as role=radiogroup with arrow-key navigation. Single Tab
 * stop — Tab focuses the active die, then ←/→ (and Home/End) move the
 * selection. Mirrors how mutually-exclusive selectors are expected to
 * behave by screen-reader users (WAI-ARIA APG: Radio Group).
 */
export function DiceSelector({ selected, onSelect }: DiceSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = ALL_DICE.indexOf(selected);
    if (i < 0) return;
    let next: DiceType | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = ALL_DICE[(i + 1) % ALL_DICE.length] ?? null;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = ALL_DICE[(i - 1 + ALL_DICE.length) % ALL_DICE.length] ?? null;
    } else if (e.key === 'Home') {
      next = ALL_DICE[0] ?? null;
    } else if (e.key === 'End') {
      next = ALL_DICE[ALL_DICE.length - 1] ?? null;
    }
    if (next) {
      e.preventDefault();
      onSelect(next);
      // Re-focus the newly active radio so screen readers announce it.
      window.setTimeout(() => {
        const root = containerRef.current;
        if (!root) return;
        const btn = root.querySelector<HTMLButtonElement>(
          `[data-die="${next}"]`,
        );
        btn?.focus({ preventScroll: true });
      }, 0);
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Die type"
      className="relative flex items-stretch w-full overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-tray-deep) 72%, transparent) 0%, color-mix(in srgb, var(--color-tray-deep) 82%, transparent) 100%)',
        border:
          '1px solid color-mix(in srgb, var(--color-gold) 35%, transparent)',
        borderRadius: '10px',
        boxShadow: 'inset 0 0 18px rgba(0,0,0,0.6)',
      }}
    >
      {ALL_DICE.map((d, idx) => {
        const isActive = d === selected;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={d.toUpperCase()}
            data-die={d}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(d)}
            onKeyDown={onKeyDown}
            className={
              'relative flex-1 flex flex-col items-center justify-center py-2 transition-all duration-150 active:scale-95 ' +
              (isActive ? 'text-gold' : 'text-secondary hover:text-ivory')
            }
            style={
              isActive
                ? {
                    background:
                      'radial-gradient(ellipse at center, color-mix(in srgb, var(--color-gold) 18%, transparent) 0%, transparent 70%)',
                    textShadow:
                      '0 0 10px color-mix(in srgb, var(--color-gold) 55%, transparent)',
                  }
                : undefined
            }
          >
            {idx > 0 && (
              <span
                aria-hidden
                className="absolute left-0 top-2 bottom-2 w-px bg-gold/25"
              />
            )}
            <DieGlyph type={d} active={isActive} />
            <span className="text-[10px] uppercase tracking-wider font-semibold mt-0.5">
              {d.toUpperCase()}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, var(--color-gold) 50%, transparent 100%)',
                  boxShadow: '0 0 8px var(--color-gold)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function DieGlyph({ type, active }: { type: DiceType; active: boolean }) {
  // Minimal "dice silhouette" per type. Just gives the row a visual cue
  // beyond text — full custom SVGs per die are polish for later.
  const stroke = active ? '#d4af6b' : '#8a7e69';
  const fill = active ? 'rgba(201,164,92,0.12)' : 'transparent';
  switch (type) {
    case 'd4':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 17,17 3,17" />
        </svg>
      );
    case 'd6':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <rect x="4" y="4" width="12" height="12" rx="1.5" />
        </svg>
      );
    case 'd8':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 17,10 10,17 3,10" />
        </svg>
      );
    case 'd10':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 16,7 16,13 10,17 4,13 4,7" />
        </svg>
      );
    case 'd12':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,2 17,7 15,16 5,16 3,7" />
        </svg>
      );
    case 'd20':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,2 18,8 15,18 5,18 2,8" />
        </svg>
      );
    case 'd100':
      return (
        <svg width="18" height="16" viewBox="0 0 22 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="7,3 11,7 11,13 7,17 3,13 3,7" />
          <polygon points="15,3 19,7 19,13 15,17 11,13 11,7" />
        </svg>
      );
  }
}
