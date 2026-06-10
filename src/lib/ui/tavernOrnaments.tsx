/**
 * Decorative ornaments for the Tavern Classic skin: the centered diamond
 * divider used to break sections inside a sheet/panel, and the two-corner
 * bracket pair used to frame the ResultPanel. Both are intentionally thin
 * and dimmed by `--ornament-opacity` so they read as restraint, not
 * decoration. One ornament per surface, max.
 *
 * Pulled out of `tavernSurface.ts` so that module can stay JSX-free and
 * importable from non-React code paths.
 */

interface TavernDividerProps {
  /** Add a centered rotated-square diamond between the two hairlines. */
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
          <span
            className="mx-2 inline-block w-1.5 h-1.5 rotate-45"
            style={{
              background:
                'color-mix(in srgb, var(--color-gold) 55%, transparent)',
            }}
          />
          {line}
        </>
      )}
    </div>
  );
}

/**
 * Two thin gold corner-bracket ornaments anchored to the top-left and
 * bottom-right of the parent (which must be `position: relative`). This
 * replaces the previous four-bracket set on the ResultPanel — one
 * ornament pair per surface reads as identity, not chrome.
 */
export function TavernCornerOrnaments() {
  const armLen = 10; // px — corner arm length
  const stroke = '1px solid color-mix(in srgb, var(--color-gold) 70%, transparent)';
  const dim = { opacity: 'var(--ornament-opacity)' };
  return (
    <>
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: -1,
          left: -1,
          width: armLen,
          height: armLen,
          borderTop: stroke,
          borderLeft: stroke,
          borderTopLeftRadius: 6,
          ...dim,
        }}
      />
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          bottom: -1,
          right: -1,
          width: armLen,
          height: armLen,
          borderBottom: stroke,
          borderRight: stroke,
          borderBottomRightRadius: 6,
          ...dim,
        }}
      />
    </>
  );
}
