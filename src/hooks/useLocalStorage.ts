import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Persist a piece of state to localStorage. Tolerant of:
 * - missing window (SSR / pre-mount safety)
 * - malformed stored JSON (falls back to `initial`)
 * - write failures (quota exceeded → silently ignored; in-memory state still updates)
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota or serialization failure — keep in-memory state, skip persistence
    }
  }, [key, value]);

  // stable setter reference so consumers can pass it to props without re-render churn
  const stableSetter = useCallback<Dispatch<SetStateAction<T>>>(
    (updater) => setValue(updater),
    [],
  );

  return [value, stableSetter];
}
