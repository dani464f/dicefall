import { DICE_FACES, type DiceType, type RollResult } from '../types/dice';

/**
 * Returns an integer uniformly distributed in [1, faces].
 * Math.random() returns a 53-bit float in [0, 1); multiplying by `faces` and
 * flooring is unbiased — there is no modulo step to introduce skew.
 */
export function rollOne(faces: number): number {
  return Math.floor(Math.random() * faces) + 1;
}

export function rollDice(
  diceType: DiceType,
  quantity: number,
  modifier: number,
): RollResult {
  const faces = DICE_FACES[diceType];
  const individualResults: number[] = [];
  for (let i = 0; i < quantity; i++) {
    individualResults.push(rollOne(faces));
  }
  const subtotal = individualResults.reduce((sum, n) => sum + n, 0);
  return {
    id: makeId(),
    diceType,
    quantity,
    modifier,
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
