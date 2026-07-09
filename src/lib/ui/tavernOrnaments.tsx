/**
 * Decorative ornaments for the Tavern Classic skin: the centered divider
 * used to break sections inside a sheet/panel, and the two-corner filigree
 * pair used to frame the ResultPanel. Both are intentionally thin and
 * dimmed by `--ornament-opacity` so they read as restraint, not
 * decoration. One ornament per surface, max (the B1 rule).
 *
 * Phase D: the corner ornaments graduate from plain CSS border-brackets to
 * hand-drawn SVG filigree — an arm pair meeting in a quarter-curve with a
 * single inward tendril curl and dotted arm tips. Everything strokes with
 * `currentColor` and the parent sets `color: var(--color-gold)`, so
 * Obsidian / Arcane re-tint the flourish automatically.
 *
 * Pulled out of `tavernSurface.ts` so that module can stay JSX-free and
 * importable from non-React code paths.
 */

interface TavernDividerProps {
  /** Add the centered motif (diamond flanked by two leaf curls). */
  withDiamond?: boolean;
  className?: string;
}

export function TavernDivider({
  withDiamond = false,
  className = '',
}: TavernDividerProps) {
  const line = (
    <span
      className="h-px flex-1"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-gold) 35%, transparent) 50%, transparent 100%)',
      }}
    />
  );
  return (
    <div
      aria-hidden
      className={`relative flex items-center justify-center ${className}`}
      style={{ opacity: 'var(--ornament-opacity)' }}
    >
      {line}
      {withDiamond && (
        <>
          {/* Center motif: rotated-square diamond with a leaf curl either
              side, replacing the bare diamond. Drawn at 40×10 so it stays
              a whisper at UI scale. */}
          <svg
            width="40"
            height="10"
            viewBox="0 0 40 10"
            fill="none"
            className="mx-1.5 shrink-0"
            style={{ color: 'color-mix(in srgb, var(--color-gold) 60%, transparent)' }}
          >
            <path
              d="M2 5 C 7 1.5, 12 2.5, 15 5"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <path
              d="M38 5 C 33 8.5, 28 7.5, 25 5"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <rect
              x="17.9"
              y="2.9"
              width="4.2"
              height="4.2"
              transform="rotate(45 20 5)"
              fill="currentColor"
            />
          </svg>
          {line}
        </>
      )}
    </div>
  );
}

/**
 * One corner-flourish SVG: two thin arms meeting in a quarter-curve, a
 * single filigree tendril curling inward from the bend, and a dot
 * finishing each arm. Rendered twice — top-left as drawn, bottom-right
 * rotated 180° — by TavernCornerOrnaments below.
 */
function CornerFlourish() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden
      style={{ display: 'block' }}
    >
      {/* Arms + quarter-curve hugging the panel corner */}
      <path
        d="M29 1 H 9 C 4.6 1 1 4.6 1 9 V 29"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Inward tendril: an S-curl growing out of the bend, tightening
          into a spiral — the "filigree" read. */}
      <path
        d="M6.5 6.5 C 10.5 4.2, 14.5 5.6, 15 9 C 15.4 11.8, 13.2 13.8, 11 13.2 C 9.3 12.7, 8.7 10.8, 9.8 9.8"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Dotted arm tips */}
      <circle cx="29" cy="1" r="1.2" fill="currentColor" />
      <circle cx="1" cy="29" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * Filigree pair anchored to the top-left and bottom-right of the parent
 * (which must be `position: relative`). One ornament pair per surface
 * reads as identity, not chrome. Strokes inherit the gold ramp via
 * currentColor so skins re-tint automatically.
 */
export function TavernCornerOrnaments() {
  const common = {
    color: 'color-mix(in srgb, var(--color-gold) 75%, transparent)',
    opacity: 'var(--ornament-opacity)',
  } as const;
  return (
    <>
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{ top: -1, left: -1, ...common }}
      >
        <CornerFlourish />
      </span>
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          bottom: -1,
          right: -1,
          transform: 'rotate(180deg)',
          ...common,
        }}
      >
        <CornerFlourish />
      </span>
    </>
  );
}
