import type { RollResult } from '../types/dice';

interface ResultPanelProps {
  result: RollResult | null;
  isRolling: boolean;
}

/**
 * Tavern result frame — dark translucent panel with thin gold border and
 * a serif RESULT / TOTAL split. Sits in the lower-middle of the overlay
 * stack so it doesn't compete with the dice in the tray.
 */
export function ResultPanel({ result, isRolling }: ResultPanelProps) {
  if (!result || isRolling) {
    return null;
  }

  const { individualResults, modifier, total } = result;
  const subtotal = individualResults.reduce((a, b) => a + b, 0);
  const hasModifier = modifier !== 0;
  const expression = hasModifier
    ? `${subtotal} ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}`
    : `${subtotal}`;

  return (
    <div
      className="relative w-full px-5 py-3 select-none"
      style={{
        // Skin-aware: derives the surface tones from --color-tray-deep and
        // the border from --color-gold so equipping a new skin shifts the
        // panel automatically instead of leaving a hard-coded brown frame.
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-tray-deep) 78%, transparent) 0%, color-mix(in srgb, var(--color-tray-deep) 88%, #000 12%) 100%)',
        border: '1px solid color-mix(in srgb, var(--color-gold) 55%, transparent)',
        borderRadius: '10px',
        boxShadow:
          '0 8px 24px rgba(0,0,0,0.6), inset 0 0 12px rgba(0,0,0,0.45)',
        animation: 'totalReveal 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      }}
    >
      <FantasyCorners />
      <div className="grid grid-cols-2 gap-3 items-center text-center">
        <div className="flex flex-col items-center">
          <p className="text-[9px] uppercase tracking-[0.3em] text-gold/70">
            Result
          </p>
          <p className="font-display text-2xl text-ivory tabular-nums">
            {expression}
          </p>
        </div>
        <div className="flex flex-col items-center border-l border-gold/30">
          <p className="text-[9px] uppercase tracking-[0.3em] text-gold/70">
            Total
          </p>
          <p
            className="font-display text-4xl text-gold tabular-nums leading-none"
            style={{
              textShadow:
                '0 0 14px color-mix(in srgb, var(--color-gold) 45%, transparent)',
            }}
          >
            {total}
          </p>
        </div>
      </div>
    </div>
  );
}

function FantasyCorners() {
  // Four small gold corner ornaments — purely decorative.
  const cornerStyle =
    'absolute w-3 h-3 border-gold pointer-events-none';
  return (
    <>
      <span
        className={cornerStyle}
        style={{ top: -1, left: -1, borderTop: '1px solid', borderLeft: '1px solid' }}
      />
      <span
        className={cornerStyle}
        style={{ top: -1, right: -1, borderTop: '1px solid', borderRight: '1px solid' }}
      />
      <span
        className={cornerStyle}
        style={{ bottom: -1, left: -1, borderBottom: '1px solid', borderLeft: '1px solid' }}
      />
      <span
        className={cornerStyle}
        style={{ bottom: -1, right: -1, borderBottom: '1px solid', borderRight: '1px solid' }}
      />
    </>
  );
}
