import type { Skin, SkinCategory } from '../../types/skins';
import { ALL_SKINS, DEFAULT_SKIN_ID } from './skinRegistry';

/**
 * Pure utility functions over the skin registry. None of these touch state
 * or storage — they're predicates and lookups that the hook layer composes.
 */

export function getAllSkins(): readonly Skin[] {
  return ALL_SKINS;
}

export function getSkinById(id: string): Skin | null {
  return ALL_SKINS.find((s) => s.id === id) ?? null;
}

export function getSkinsByCategory(category: SkinCategory): Skin[] {
  return ALL_SKINS.filter((s) => s.category === category);
}

/**
 * Whether a skin is currently unlocked for the given user state. Free
 * skins are always unlocked; premium and unlockable skins must be in
 * `unlockedIds` (or, for premium, in `ownedPremiumIds`).
 */
export function isSkinUnlocked(
  id: string,
  unlockedIds: ReadonlySet<string>,
  ownedPremiumIds: ReadonlySet<string>,
): boolean {
  const skin = getSkinById(id);
  if (!skin) return false;
  if (skin.category === 'free') return true;
  if (skin.category === 'premium') return ownedPremiumIds.has(id);
  return unlockedIds.has(id);
}

/** A skin can be equipped only if it exists in the registry AND is unlocked. */
export function canEquipSkin(
  id: string,
  unlockedIds: ReadonlySet<string>,
  ownedPremiumIds: ReadonlySet<string>,
): boolean {
  return (
    getSkinById(id) !== null &&
    isSkinUnlocked(id, unlockedIds, ownedPremiumIds)
  );
}

/** Resolve the active skin, falling back to the default if storage is bad. */
export function getActiveSkin(activeSkinId: string | null | undefined): Skin {
  const fromStorage = activeSkinId ? getSkinById(activeSkinId) : null;
  if (fromStorage) return fromStorage;
  const fallback = getSkinById(DEFAULT_SKIN_ID);
  if (fallback) return fallback;
  // Shouldn't happen unless the registry is empty.
  return ALL_SKINS[0];
}
