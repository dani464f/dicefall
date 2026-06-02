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
 * back via commitPhysicsResult(), which is rejected if its token doesn't
 * match the most recent in-flight request (so a microtask result arriving
 * after Clear or after a re-roll can't poison state).
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
  /** The token currently being awaited from the scene. Null when no throw
   *  is in flight (e.g. after Clear, or after a successful commit). */
  const pendingTokenRef = useRef<number | null>(null);

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
      pendingTokenRef.current = null;
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

  // ---- Physics-driven path (D4/D6/D8/D10/D12/D20/D100 with hull) ----
  const throwDice = useCallback(
    (diceType: DiceType, quantity: number): void => {
      clearTimer();
      setIsRolling(true);
      setLastRoll(null);
      tokenRef.current += 1;
      pendingTokenRef.current = tokenRef.current;
      setThrowRequest({ token: tokenRef.current, diceType, quantity });
    },
    [clearTimer],
  );

  /**
   * Scene calls this once all dice have settled and faces have been read.
   * The `token` is the request's token at throw time — if it no longer
   * matches `pendingTokenRef`, the result is stale (e.g. user hit Clear, or
   * fired a fresh throw before the previous one resolved) and we drop it
   * silently.
   */
  const commitPhysicsResult = useCallback(
    (
      diceType: DiceType,
      quantity: number,
      individualResults: number[],
      modifier: number,
      token: number,
    ): RollResult | null => {
      if (pendingTokenRef.current !== token) return null;
      pendingTokenRef.current = null;
      const subtotal = individualResults.reduce((a, b) => a + b, 0);
      const result: RollResult = {
        id: makeId(),
        diceType,
        quantity,
        modifier,
        individualResults,
        total: subtotal + modifier,
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
    pendingTokenRef.current = null;
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
