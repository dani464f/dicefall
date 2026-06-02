import { DiceScene } from './DiceScene';
import type { ThrowRequest } from '../hooks/useDiceRoller';
import type { DiceType, RollResult } from '../types/dice';
import type { SceneTheme } from '../types/skins';

interface DiceTrayProps {
  result: RollResult | null;
  isRolling: boolean;
  throwRequest: ThrowRequest | null;
  onResult: (diceType: DiceType, quantity: number, values: number[]) => void;
  /**
   * Active skin's scene theme. Plumbed through to DiceScene so a future
   * change can swap table / tray / dice materials and lighting without
   * touching this component's signature. Not yet honored inside the scene.
   */
  sceneTheme?: SceneTheme;
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
  sceneTheme,
}: DiceTrayProps) {
  return (
    <div className="absolute inset-0">
      <DiceScene
        result={result}
        isRolling={isRolling}
        throwRequest={throwRequest}
        onResult={onResult}
        sceneTheme={sceneTheme}
      />
    </div>
  );
}
