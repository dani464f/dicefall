/**
 * Local persistence keys for the skin system. Keep these versioned so the
 * shape can evolve without trampling old user data.
 *
 * Storage is plain localStorage via the existing useLocalStorage hook —
 * no backend, no accounts.
 */

export const ACTIVE_SKIN_KEY = 'dicefall.activeSkinId.v1';
export const UNLOCKED_SKINS_KEY = 'dicefall.unlockedSkinIds.v1';
export const OWNED_PREMIUM_SKINS_KEY = 'dicefall.ownedPremiumSkinIds.v1';
export const DISMISSED_PROMPTS_KEY = 'dicefall.dismissedSkinPrompts.v1';
