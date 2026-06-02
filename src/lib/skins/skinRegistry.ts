import type { Skin } from '../../types/skins';

/**
 * Central skin registry. Source of truth for what skins exist.
 *
 * NOTE: These are intentionally placeholder visuals. The premium and
 * unlockable skins use small accent shifts so that swapping into them is
 * visibly distinct from the free baseline, but they are not "designed"
 * skins yet — real art will land later. Keep the list short while the
 * system is being proven out.
 *
 * Naming convention: kebab-case ids, prefixed by category for clarity.
 */

export const TAVERN_CLASSIC_ID = 'free.tavern-classic';
export const OBSIDIAN_COURT_ID = 'premium.obsidian-court';
export const ARCANE_VAULT_ID = 'unlockable.arcane-vault';

export const DEFAULT_SKIN_ID = TAVERN_CLASSIC_ID;

/**
 * The free baseline. UI values mirror the current --color-* tokens in
 * index.css, so equipping this skin is a visual no-op against the default
 * stylesheet — it confirms the system is working without changing how
 * the app looks for a first-time user.
 */
const tavernClassic: Skin = {
  id: TAVERN_CLASSIC_ID,
  name: 'Tavern Classic',
  description:
    'The original Dicefall look — warm candlelight on dark walnut, gold on black dice.',
  category: 'free',
  unlockStatus: 'unlocked',
  previewImage: undefined,
  uiTheme: {
    background: '#101014',
    surface: '#2a1d16',
    primaryText: '#f4e8d0',
    secondaryText: '#b8aa91',
    accent: '#c9a45c',
    border: 'rgba(255, 255, 255, 0.08)',
    button: '#c9a45c',
    buttonText: '#1b120d',
  },
  sceneTheme: {
    tableMaterialId: 'wood.walnut',
    trayMaterialId: 'leather.dark',
    diceMaterialId: 'dice.obsidian-gold',
    lightingPresetId: 'tavern.candle',
    shadowPresetId: 'soft.warm',
    environmentPresetId: 'tavern.interior',
  },
  audioTheme: {
    soundPackId: 'tavern.default',
    enabledByDefault: false,
  },
  effectsTheme: {
    naturalTwentyEffectId: 'gold-burst',
    naturalOneEffectId: 'ash-drop',
    rollTrailEffectId: 'warm-trail',
  },
};

/**
 * Premium placeholder — cooler, royal-court palette. Locked by default;
 * the card shows "Premium · Coming Soon" and cannot be equipped until a
 * future purchase path unlocks it. There is NO dev-unlock affordance for
 * premium skins per the brief.
 */
const obsidianCourt: Skin = {
  id: OBSIDIAN_COURT_ID,
  name: 'Obsidian Court',
  description:
    'Cold royal palette — midnight obsidian with sapphire highlights and pewter trim.',
  category: 'premium',
  unlockStatus: 'locked',
  priceLabel: 'Premium',
  unlockRequirement: 'Coming soon — premium store not yet available.',
  uiTheme: {
    background: '#0b0d14',
    surface: '#181d2a',
    primaryText: '#e6ecf6',
    secondaryText: '#94a3bf',
    accent: '#7ea0ff',
    border: 'rgba(140, 170, 220, 0.10)',
    button: '#7ea0ff',
    buttonText: '#0b0d14',
  },
  sceneTheme: {
    tableMaterialId: 'stone.obsidian',
    trayMaterialId: 'velvet.midnight',
    diceMaterialId: 'dice.obsidian-silver',
    lightingPresetId: 'court.sapphire',
    shadowPresetId: 'cool.soft',
    environmentPresetId: 'court.hall',
  },
  audioTheme: {
    soundPackId: 'court.crystal',
    enabledByDefault: false,
  },
  effectsTheme: {
    naturalTwentyEffectId: 'sapphire-burst',
    naturalOneEffectId: 'shatter',
    rollTrailEffectId: 'cool-trail',
  },
};

/**
 * Unlockable placeholder — emerald arcane vault. Locked by default. The
 * card shows "Unlockable" + a small dev-test unlock button (clearly marked
 * temporary) so the unlock/equip path can be exercised end-to-end before
 * a real achievement system ships.
 */
const arcaneVault: Skin = {
  id: ARCANE_VAULT_ID,
  name: 'Arcane Vault',
  description:
    'Deep emerald rune-light over dark malachite — the kind of room where pacts are signed.',
  category: 'unlockable',
  unlockStatus: 'locked',
  priceLabel: 'Unlockable',
  unlockRequirement: 'Unlocks via future progression milestone.',
  uiTheme: {
    background: '#0a1310',
    surface: '#16241c',
    primaryText: '#e8f1ea',
    secondaryText: '#8eb19a',
    accent: '#7dd6a0',
    border: 'rgba(125, 214, 160, 0.12)',
    button: '#7dd6a0',
    buttonText: '#0a1310',
  },
  sceneTheme: {
    tableMaterialId: 'stone.malachite',
    trayMaterialId: 'leather.emerald',
    diceMaterialId: 'dice.malachite-bronze',
    lightingPresetId: 'vault.rune',
    shadowPresetId: 'soft.green',
    environmentPresetId: 'vault.chamber',
  },
  audioTheme: {
    soundPackId: 'vault.rune',
    enabledByDefault: false,
  },
  effectsTheme: {
    naturalTwentyEffectId: 'rune-spark',
    naturalOneEffectId: 'rune-fizzle',
    rollTrailEffectId: 'rune-trail',
  },
};

export const ALL_SKINS: readonly Skin[] = [
  tavernClassic,
  obsidianCourt,
  arcaneVault,
];
