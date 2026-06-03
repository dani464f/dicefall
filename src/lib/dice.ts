import {
  DICE_FACES,
  type DiceType,
  type RollMode,
  type RollResult,
} from '../types/dice';

/**
 * Returns an integer uniformly distributed in [1, faces].
 * Math.random() returns a 53-bit float in [0, 1); multiplying by `faces` and
 * flooring is unbiased — there is no modulo step to introduce skew.
 */
export function rollOne(faces: number): number {
  return Math.floor(Math.random() * faces) + 1;
}

/**
 * Pick the value that contributes to `total` for a given roll mode.
 *   normal:        sum of every die rolled
 *   advantage:     the highest single die
 *   disadvantage:  the lowest single die
 * Exported so `commitPhysicsResult` can reuse the same selection logic
 * without re-implementing it.
 */
export function applyRollMode(
  values: number[],
  rollMode: RollMode,
): number {
  if (values.length === 0) return 0;
  if (rollMode === 'advantage') return Math.max(...values);
  if (rollMode === 'disadvantage') return Math.min(...values);
  return values.reduce((sum, n) => sum + n, 0);
}

export function rollDice(
  diceType: DiceType,
  quantity: number,
  modifier: number,
  rollMode: RollMode = 'normal',
): RollResult {
  const faces = DICE_FACES[diceType];
  // Advantage/disadvantage roll exactly 2 dice regardless of quantity
  // — the spec is "roll twice, take higher/lower," not "roll N times."
  const effectiveQty = rollMode === 'normal' ? quantity : 2;
  const individualResults: number[] = [];
  for (let i = 0; i < effectiveQty; i++) {
    individualResults.push(rollOne(faces));
  }
  const subtotal = applyRollMode(individualResults, rollMode);
  return {
    id: makeId(),
    diceType,
    quantity: effectiveQty,
    modifier,
    rollMode,
    individualResults,
    total: subtotal + modifier,
    timestamp: Date.now(),
  };
}

function makeId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

/**
 * Canonical dice formula formatter — `2d20 + 3`, `1d6 − 1`, `4d8`.
 * Used by ResultPanel, RollHistory, PresetsPanel so the wording stays in
 * one place. Uses U+2212 minus (not ASCII `-`) to match the tabular-nums
 * minus sign used in the rest of the UI.
 *
 * Advantage/disadvantage render as `d20 adv ↑` / `d20 dis ↓` after the
 * modifier — same convention you'd see on a virtual tabletop chat log.
 */
export function formatDiceFormula(setup: {
  diceType: string;
  quantity: number;
  modifier: number;
  rollMode?: RollMode;
}): string {
  const base = `${setup.quantity}${setup.diceType}`;
  let core: string;
  if (setup.modifier === 0) core = base;
  else if (setup.modifier > 0) core = `${base} + ${setup.modifier}`;
  else core = `${base} − ${Math.abs(setup.modifier)}`;
  if (setup.rollMode === 'advantage') return `${core} · adv ↑`;
  if (setup.rollMode === 'disadvantage') return `${core} · dis ↓`;
  return core;
}
