import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
import {
  ACTIVE_SKIN_KEY,
  OWNED_PREMIUM_SKINS_KEY,
  UNLOCKED_SKINS_KEY,
} from '../lib/skins/skinStorage';
import { DEFAULT_SKIN_ID } from '../lib/skins/skinRegistry';
import {
  canEquipSkin as canEquipSkinPure,
  getActiveSkin,
  getAllSkins,
  getSkinById,
  isSkinUnlocked as isSkinUnlockedPure,
} from '../lib/skins/skinUtils';
import { applyUiTheme } from '../lib/skins/applyUiTheme';
import type { Skin } from '../types/skins';

/**
 * Skin system state — wraps three localStorage keys (active id, unlocked
 * ids, owned premium ids) and exposes a small set of mutators. Also takes
 * care of mirroring the active skin's UiTheme into :root CSS variables
 * whenever the active skin changes.
 *
 * The hook is intentionally narrow. It does not know about UI, sheets, or
 * the 3D scene; those concerns wire it together at the App level.
 */
export function useSkinSystem() {
  const [activeSkinId, setActiveSkinId] = useLocalStorage<string>(
    ACTIVE_SKIN_KEY,
    DEFAULT_SKIN_ID,
  );
  const [unlockedSkinIds, setUnlockedSkinIds] = useLocalStorage<string[]>(
    UNLOCKED_SKINS_KEY,
    [],
  );
  const [ownedPremiumSkinIds, setOwnedPremiumSkinIds] = useLocalStorage<
    string[]
  >(OWNED_PREMIUM_SKINS_KEY, []);

  // Memoize Set views so the pure helpers can do O(1) lookups.
  const unlockedSet = useMemo(
    () => new Set(unlockedSkinIds),
    [unlockedSkinIds],
  );
  const ownedPremiumSet = useMemo(
    () => new Set(ownedPremiumSkinIds),
    [ownedPremiumSkinIds],
  );

  const allSkins = useMemo(() => [...getAllSkins()], []);

  const activeSkin = useMemo<Skin>(
    () => getActiveSkin(activeSkinId),
    [activeSkinId],
  );

  // Mirror the active skin into :root CSS vars BEFORE paint so a non-default
  // skin doesn't briefly flash the default palette on cold load. (For the
  // first paint specifically, the inline-script in index.html would be
  // even better — but useLayoutEffect at least catches subsequent changes.)
  useLayoutEffect(() => {
    applyUiTheme(activeSkin.uiTheme);
  }, [activeSkin]);

  // Reconcile activeSkinId against unlock state on mount + whenever the
  // unlock sets change. If storage was hand-edited or a future build
  // re-locks a previously-equipped skin, this falls back to the default
  // so the user can't stay locked into a skin they don't own.
  useEffect(() => {
    if (activeSkin.category === 'free') return;
    if (
      activeSkin.category === 'premium' &&
      !ownedPremiumSet.has(activeSkin.id)
    ) {
      setActiveSkinId(DEFAULT_SKIN_ID);
    } else if (
      activeSkin.category === 'unlockable' &&
      !unlockedSet.has(activeSkin.id)
    ) {
      setActiveSkinId(DEFAULT_SKIN_ID);
    }
  }, [activeSkin, ownedPremiumSet, unlockedSet, setActiveSkinId]);

  const isUnlocked = useCallback(
    (id: string) => isSkinUnlockedPure(id, unlockedSet, ownedPremiumSet),
    [unlockedSet, ownedPremiumSet],
  );

  const canEquip = useCallback(
    (id: string) => canEquipSkinPure(id, unlockedSet, ownedPremiumSet),
    [unlockedSet, ownedPremiumSet],
  );

  const equipSkin = useCallback(
    (id: string) => {
      if (!canEquipSkinPure(id, unlockedSet, ownedPremiumSet)) return false;
      setActiveSkinId(id);
      return true;
    },
    [setActiveSkinId, unlockedSet, ownedPremiumSet],
  );

  /**
   * Local-only unlock. For premium skins, this would normally come from a
   * verified purchase; we expose it for dev/test affordances and for the
   * future progression system to hand-tune.
   */
  const unlockSkin = useCallback(
    (id: string) => {
      const skin = getSkinById(id);
      if (!skin) return;
      if (skin.category === 'free') return; // already unlocked by definition
      if (skin.category === 'premium') {
        setOwnedPremiumSkinIds((cur) =>
          cur.includes(id) ? cur : [...cur, id],
        );
      } else {
        setUnlockedSkinIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
      }
    },
    [setOwnedPremiumSkinIds, setUnlockedSkinIds],
  );

  /** Dev/test helper — re-lock a skin and unequip if it was active. */
  const lockSkin = useCallback(
    (id: string) => {
      const skin = getSkinById(id);
      if (!skin || skin.category === 'free') return;
      if (skin.category === 'premium') {
        setOwnedPremiumSkinIds((cur) => cur.filter((x) => x !== id));
      } else {
        setUnlockedSkinIds((cur) => cur.filter((x) => x !== id));
      }
      // If the skin being locked was active, drop back to the default.
      if (activeSkinId === id) setActiveSkinId(DEFAULT_SKIN_ID);
    },
    [
      activeSkinId,
      setActiveSkinId,
      setOwnedPremiumSkinIds,
      setUnlockedSkinIds,
    ],
  );

  return {
    activeSkin,
    activeSkinId: activeSkin.id,
    allSkins,
    isUnlocked,
    canEquip,
    equipSkin,
    unlockSkin,
    lockSkin,
  };
}

export type SkinSystem = ReturnType<typeof useSkinSystem>;
