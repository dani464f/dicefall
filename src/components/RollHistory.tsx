import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { formatDiceFormula } from '../lib/dice';
import { tavernCaption, tavernSurface } from '../lib/ui/tavernSurface';
import type { RollResult } from '../types/dice';

interface RollHistoryProps {
  open: boolean;
  onClose: () => void;
  history: RollResult[];
  onClear: () => void;
}

export function RollHistory({ open, onClose, history, onClear }: RollHistoryProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Recent rolls">
      {history.length === 0 ? (
        <p className="text-center text-secondary/70 text-sm py-8">
          Your roll history will appear here.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 mb-4">
            {history.map((r) => (
              <li
                key={r.id}
                className={`${tavernSurface()} px-4 py-3`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-sm text-secondary tabular-nums">
                    {formatDiceFormula(r)}
                  </span>
                  <span className="font-display text-2xl text-ivory tabular-nums leading-none">
                    {r.total}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(() => {
                    const mode = r.rollMode ?? 'normal';
                    const keptIdx =
                      mode === 'advantage'
                        ? r.individualResults.indexOf(
                            Math.max(...r.individualResults),
                          )
                        : mode === 'disadvantage'
                          ? r.individualResults.indexOf(
                              Math.min(...r.individualResults),
                            )
                          : -1;
                    return r.individualResults.map((n, i) => {
                      const kept = i === keptIdx;
                      const dropped = mode !== 'normal' && !kept;
                      return (
                        <span
                          key={i}
                          className={
                            'px-1.5 py-0.5 rounded text-xs tabular-nums min-w-[24px] text-center ' +
                            (kept
                              ? 'bg-tray-deep border border-gold/55 text-gold font-semibold'
                              : dropped
                                ? 'bg-tray-deep/40 border border-subtle text-secondary/60 line-through'
                                : 'bg-tray-deep/70 border border-subtle text-ivory')
                          }
                        >
                          {n}
                        </span>
                      );
                    });
                  })()}
                  {r.modifier !== 0 && (
                    <span className="px-1.5 py-0.5 text-xs text-secondary tabular-nums">
                      {r.modifier > 0 ? `+${r.modifier}` : r.modifier}
                    </span>
                  )}
                </div>
                <p className={`mt-2 ${tavernCaption}`}>
                  <RelativeTime ts={r.timestamp} />
                </p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onClear}
            className="w-full text-xs uppercase tracking-[0.22em] text-secondary/70 hover:text-danger py-2 transition-colors"
          >
            Clear history
          </button>
        </>
      )}
    </Sheet>
  );
}

function RelativeTime({ ts }: { ts: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 30) return <>Just now</>;
  if (min < 1) return <>{sec}s ago</>;
  if (hr < 1) return <>{min} min ago</>;
  if (day < 1) return <>{hr} hr ago</>;
  return <>{day}d ago</>;
}
