export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export const ALL_DICE: readonly DiceType[] = [
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd20',
  'd100',
] as const;

export const DICE_FACES: Record<DiceType, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
  d100: 100,
};

/**
 * Roll mode — borrowed from D&D 5e.
 *   'normal'        roll `quantity` dice, sum them
 *   'advantage'     roll 2 dice, take the higher (quantity is forced to 2)
 *   'disadvantage'  roll 2 dice, take the lower  (quantity is forced to 2)
 * Persisted in stored shapes as optional so existing presets/history
 * loaded from a previous build still parse cleanly.
 */
export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface RollSetup {
  diceType: DiceType;
  quantity: number;
  modifier: number;
  rollMode?: RollMode;
}

export interface RollResult {
  id: string;
  diceType: DiceType;
  quantity: number;
  modifier: number;
  rollMode?: RollMode;
  individualResults: number[];
  total: number;
  timestamp: number;
}

export interface Preset {
  id: string;
  name: string;
  diceType: DiceType;
  quantity: number;
  modifier: number;
  rollMode?: RollMode;
}

export interface Settings {
  /** 'auto' follows prefers-reduced-motion; 'on' forces; 'off' forces 3D. */
  reducedMotion: 'auto' | 'on' | 'off';
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: 'auto',
  soundEnabled: false,
  hapticsEnabled: false,
};
