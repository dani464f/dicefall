import type { RollResult } from '../types/dice';

interface ResultPanelProps {
  result: RollResult | null;
  isRolling: boolean;
}

/**
 * Overlay on top of the 3D dice scene.
 *  - Empty: centered "Awaiting roll" placeholder.
 *  - Rolling: nothing — the 3D dice carry the moment.
 *  - Settled: total at the top, individual chips at the bottom; 3D dice
 *    remain visible between them.
 */
export function ResultPanel({ result, isRolling }: ResultPanelProps) {
  if (!result) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
        <EmptyState />
      </div>
    );
  }

  if (isRolling) {
    return null;
  }

  const { diceType, quantity, modifier, individualResults, total } = result;
  const formula = formatFormula(diceType, quantity, modifier);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-between pointer-events-none px-4 py-5 select-none"
      style={{ animation: 'totalReveal 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both' }}
    >
      <div className="flex flex-col items-center gap-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-secondary/80">
          Total
        </p>
        <p className="font-display text-[72px] text-ivory leading-none tabular-nums drop-shadow-[0_2px_12px_rgba(201,164,92,0.25)]">
          {total}
        </p>
        <p className="font-display text-sm text-secondary tracking-wide">
          {formula}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <DieChips values={individualResults} />
        {modifier !== 0 && (
          <p className="text-[10px] uppercase tracking-[0.2em] text-secondary/80">
            {modifier > 0 ? `+${modifier}` : `${modifier}`} modifier
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2">
      <p className="text-xs uppercase tracking-[0.25em] text-secondary/70">
        Awaiting roll
      </p>
      <p className="font-display text-7xl text-ivory/30 leading-none">—</p>
    </div>
  );
}

interface DieChipsProps {
  values: number[];
}

function DieChips({ values }: DieChipsProps) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5 max-w-full">
      {values.map((n, i) => (
        <span
          key={i}
          className="min-w-[32px] h-7 px-1.5 rounded bg-tray-deep/85 border border-gold/30 text-ivory font-display text-sm tabular-nums flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function formatFormula(
  diceType: string,
  quantity: number,
  modifier: number,
): string {
  const base = `${quantity}${diceType}`;
  if (modifier === 0) return base;
  if (modifier > 0) return `${base} + ${modifier}`;
  return `${base} − ${Math.abs(modifier)}`;
}
