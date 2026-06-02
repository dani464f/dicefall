import RAPIER from '@dimforge/rapier3d-compat';

let initPromise: Promise<typeof RAPIER> | null = null;

/**
 * Load Rapier's WASM module on first call; subsequent callers wait on the
 * same promise. Returns the typed RAPIER namespace so callers can create
 * worlds, bodies, and colliders.
 */
export function loadRapier(): Promise<typeof RAPIER> {
  if (!initPromise) {
    initPromise = RAPIER.init().then(() => RAPIER);
  }
  return initPromise;
}

export type Rapier = typeof RAPIER;
