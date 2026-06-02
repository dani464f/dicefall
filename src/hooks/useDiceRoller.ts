import { useCallback, useEffect, useRef, useState } from 'react';
import { rollDice } from '../lib/dice';
import type { DiceType, RollResult } from '../types/dice';

export const ROLL_ANIMATION_MS = 1500;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * A throw request — the scene watches this object's identity, and when the
 * token changes it spawns fresh dice and applies a throw. The result comes
 * back via commitPhysicsResult().
 */
export interface ThrowRequest {
  token: number;
  diceType: DiceType;
  quantity: number;
}

export function useDiceRoller() {
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [throwRequest, setThrowRequest] = useState<ThrowRequest | null>(null);

  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ---- Legacy RNG-driven path (dice types without face detection) ----
  const roll = useCallback(
    (diceType: DiceType, quantity: number, modifier: number): RollResult => {
      clearTimer();
      const result = rollDice(diceType, quantity, modifier);
      setLastRoll(result);
      setThrowRequest(null);
      if (prefersReducedMotion()) {
        setIsRolling(false);
      } else {
        setIsRolling(true);
        timerRef.current = window.setTimeout(() => {
          setIsRolling(false);
          timerRef.current = null;
        }, ROLL_ANIMATION_MS);
      }
      return result;
    },
    [clearTimer],
  );

  // ---- Physics-driven path (D4/D6/D8/D12/D20) ----
  // Caller passes (type, quantity); the scene takes it from there.
  const throwDice = useCallback(
    (diceType: DiceType, quantity: number): void => {
      clearTimer();
      setIsRolling(true);
      setLastRoll(null);
      tokenRef.current += 1;
      setThrowRequest({ token: tokenRef.current, diceType, quantity });
    },
    [clearTimer],
  );

  // Scene calls this once all dice have settled and faces have been detected.
  const commitPhysicsResult = useCallback(
    (
      diceType: DiceType,
      quantity: number,
      individualResults: number[],
    ): RollResult => {
      const total = individualResults.reduce((a, b) => a + b, 0);
      const result: RollResult = {
        id: makeId(),
        diceType,
        quantity,
        modifier: 0, // physics path doesn't apply a modifier — UI is locked at 0
        individualResults,
        total,
        timestamp: Date.now(),
      };
      setLastRoll(result);
      setIsRolling(false);
      return result;
    },
    [],
  );

  const clear = useCallback(() => {
    clearTimer();
    setLastRoll(null);
    setIsRolling(false);
    setThrowRequest(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    lastRoll,
    isRolling,
    throwRequest,
    roll,
    throwDice,
    commitPhysicsResult,
    clear,
  };
}
