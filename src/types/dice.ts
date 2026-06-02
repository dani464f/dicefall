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

export interface RollSetup {
  diceType: DiceType;
  quantity: number;
  modifier: number;
}

export interface RollResult {
  id: string;
  diceType: DiceType;
  quantity: number;
  modifier: number;
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
