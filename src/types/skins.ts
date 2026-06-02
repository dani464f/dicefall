/**
 * Skin / theme system types.
 *
 * Design principle: ONE physics system, MANY visual skins.
 * A skin controls visual + sensory presentation only — never physics, math,
 * dice logic, history, presets, or any other behavior.
 *
 * The skin registry is local-only for now. Premium / unlockable states are
 * placeholders for future monetization and progression systems; no payment
 * code, no backend, no accounts are involved yet.
 */

export type SkinCategory = 'free' | 'premium' | 'unlockable';

export type UnlockStatus = 'unlocked' | 'locked';

/**
 * UI colors applied to the React shell. Each field maps 1:1 to a CSS
 * custom property that Tailwind v4's @theme block declares in index.css.
 * Equipping a skin writes these values via applyUiTheme() so every
 * Tailwind utility (bg-bg, text-gold, border-subtle, …) re-tints
 * immediately.
 *
 * Token map (UiTheme → CSS variable):
 *   background   → --color-bg
 *   surface      → --color-tray
 *   surfaceDeep  → --color-tray-deep
 *   surfaceWarm  → --color-tray-warm
 *   primaryText  → --color-ivory
 *   secondaryText→ --color-secondary
 *   accent       → --color-gold
 *   accentSoft   → --color-gold-soft
 *   danger       → --color-danger
 *   special      → --color-special
 *   border       → --color-subtle
 *   button       → (skin authors only — drives custom button gradients)
 *   buttonText   → (skin authors only — drives custom button label color)
 *
 * Values are CSS color strings (any valid CSS color — hex, rgb, rgba, etc).
 */
export interface UiTheme {
  background: string;
  surface: string;
  surfaceDeep: string;
  surfaceWarm: string;
  primaryText: string;
  secondaryText: string;
  accent: string;
  accentSoft: string;
  danger: string;
  special: string;
  border: string;
  button: string;
  buttonText: string;
}

/**
 * Identifiers for 3D-scene assets. These are reference IDs that the 3D scene
 * can later resolve to real materials / lighting presets. The scene is not
 * required to honor them yet — they are plumbed through as opt-in props.
 */
export interface SceneTheme {
  tableMaterialId: string;
  trayMaterialId: string;
  diceMaterialId: string;
  lightingPresetId: string;
  shadowPresetId: string;
  environmentPresetId: string;
}

/** Audio pack reference. Placeholder until a sound system lands. */
export interface AudioTheme {
  soundPackId: string;
  enabledByDefault: boolean;
}

/** VFX references for milestone moments (nat 20, nat 1, trails). Placeholder. */
export interface EffectsTheme {
  naturalTwentyEffectId: string;
  naturalOneEffectId: string;
  rollTrailEffectId: string;
}

export interface Skin {
  id: string;
  name: string;
  description: string;
  category: SkinCategory;
  /** Current ownership / availability state, persisted locally. */
  unlockStatus: UnlockStatus;
  /** Short label shown on locked skins, e.g. "Premium" or "Unlockable". */
  priceLabel?: string | undefined;
  /** Free-text reason a skin is locked, e.g. "Coming soon" or "Roll 100 D20s". */
  unlockRequirement?: string | undefined;
  /** Optional preview image path; we use a CSS gradient swatch when absent. */
  previewImage?: string | undefined;
  uiTheme: UiTheme;
  sceneTheme: SceneTheme;
  audioTheme: AudioTheme;
  effectsTheme: EffectsTheme;
}

/** Persisted state shape — local only. */
export interface SkinPersistState {
  activeSkinId: string;
  unlockedSkinIds: string[];
  ownedPremiumSkinIds: string[];
  dismissedSkinPrompts: string[];
}
