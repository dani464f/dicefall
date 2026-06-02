import { DiceScene } from './DiceScene';
import type { ThrowRequest } from '../hooks/useDiceRoller';
import type { DiceType, RollResult } from '../types/dice';

interface DiceTrayProps {
  result: RollResult | null;
  isRolling: boolean;
  throwRequest: ThrowRequest | null;
  onResult: (diceType: DiceType, quantity: number, values: number[]) => void;
}

/**
 * Full-bleed 3D scene container. The tavern table + tray live inside the
 * scene itself, so this is just a transparent canvas host. UI overlays
 * (top bar, controls, result frame) are siblings drawn above the canvas.
 */
export function DiceTray({
  result,
  isRolling,
  throwRequest,
  onResult,
}: DiceTrayProps) {
  return (
    <div className="absolute inset-0">
      <DiceScene
        result={result}
        isRolling={isRolling}
        throwRequest={throwRequest}
        onResult={onResult}
      />
    </div>
  );
}
