import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Persist a piece of state to localStorage. Tolerant of:
 * - missing window (SSR / pre-mount safety)
 * - malformed stored JSON (falls back to `initial`)
 * - write failures (quota exceeded → silently ignored; in-memory state still updates)
 *
 * Also subscribes to the `storage` event so two browser tabs sharing the
 * same key stay in sync. (The `storage` event fires only in the *other*
 * tab — never the one that wrote — so this is a one-way mirror, not a loop.)
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

  // Cross-tab sync — pick up writes performed in another tab.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== window.localStorage) return;
      if (e.newValue === null) {
        // key was removed in another tab — reset to initial
        setValue(initial);
        return;
      }
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // malformed write from another tab — ignore
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // `initial` is intentionally excluded from deps — it's a stable seed,
    // not something we want to re-bind the listener for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // stable setter reference so consumers can pass it to props without re-render churn
  const stableSetter = useCallback<Dispatch<SetStateAction<T>>>(
    (updater) => setValue(updater),
    [],
  );

  return [value, stableSetter];
}
