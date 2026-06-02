import { DiceScene } from './DiceScene';
import { ResultPanel } from './ResultPanel';
import type { ThrowRequest } from '../hooks/useDiceRoller';
import type { DiceType, RollResult } from '../types/dice';

interface DiceTrayProps {
  result: RollResult | null;
  isRolling: boolean;
  throwRequest: ThrowRequest | null;
  onResult: (diceType: DiceType, quantity: number, values: number[]) => void;
}

export function DiceTray({
  result,
  isRolling,
  throwRequest,
  onResult,
}: DiceTrayProps) {
  return (
    <div
      className="relative flex-1 min-h-0 rounded-3xl overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at center, #3a2a1f 0%, #2a1d16 55%, #1b120d 100%)',
        boxShadow:
          'inset 0 2px 28px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.04), 0 6px 24px rgba(0,0,0,0.5)',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.06] mix-blend-overlay z-0"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0.7  0 0 0 0 0.55  0 0 0 0 0.3  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      <div className="absolute inset-0 z-10">
        <DiceScene
          result={result}
          isRolling={isRolling}
          throwRequest={throwRequest}
          onResult={onResult}
        />
      </div>
      <ResultPanel result={result} isRolling={isRolling} />
    </div>
  );
}
