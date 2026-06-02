import * as THREE from 'three';
import type { SceneTheme } from '../../types/skins';

/**
 * Resolver from string IDs on `SceneTheme` → concrete THREE materials and
 * light parameters used by DiceScene. New skins only need to register here
 * (and provide matching IDs in the registry) — the scene file itself stays
 * skin-agnostic.
 *
 * The resolver returns plain config objects, not constructed THREE
 * resources. DiceScene constructs the actual materials/lights from them
 * during scene build, with one set per active skin. This keeps the
 * resolver pure and easy to unit-test.
 */

export interface TableMaterialConfig {
  color: number;
  roughness: number;
  metalness: number;
}

export interface TrayFloorMaterialConfig {
  color: number;
  roughness: number;
  metalness: number;
}

export interface TrayRailMaterialConfig {
  color: number;
  roughness: number;
  metalness: number;
}

export interface DiceMaterialConfig {
  color: number;
  roughness: number;
  metalness: number;
}

export interface LightingConfig {
  ambient: { color: number; intensity: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  key: { color: number; intensity: number; position: THREE.Vector3 };
  rim: { color: number; intensity: number; position: THREE.Vector3 };
  top: { color: number; intensity: number; position: THREE.Vector3 };
}

export interface ResolvedSceneTheme {
  table: TableMaterialConfig;
  trayFloor: TrayFloorMaterialConfig;
  trayRail: TrayRailMaterialConfig;
  dice: DiceMaterialConfig;
  lighting: LightingConfig;
}

// ---------- Table / tray / dice material presets ----------------------------

const TABLE_PRESETS: Record<string, TableMaterialConfig> = {
  'wood.walnut': { color: 0x18100a, roughness: 0.92, metalness: 0.05 },
  'stone.obsidian': { color: 0x0a0c14, roughness: 0.55, metalness: 0.2 },
  'stone.malachite': { color: 0x0c1b14, roughness: 0.55, metalness: 0.15 },
};

const TRAY_FLOOR_PRESETS: Record<string, TrayFloorMaterialConfig> = {
  'leather.dark': { color: 0x1c0d06, roughness: 0.88, metalness: 0.02 },
  'velvet.midnight': { color: 0x121730, roughness: 0.85, metalness: 0.0 },
  'leather.emerald': { color: 0x0d2018, roughness: 0.86, metalness: 0.02 },
};

const TRAY_RAIL_PRESETS: Record<string, TrayRailMaterialConfig> = {
  'leather.dark': { color: 0x3b2114, roughness: 0.7, metalness: 0.08 },
  'velvet.midnight': { color: 0x2a3458, roughness: 0.7, metalness: 0.12 },
  'leather.emerald': { color: 0x1f3a2a, roughness: 0.72, metalness: 0.08 },
};

const DICE_PRESETS: Record<string, DiceMaterialConfig> = {
  'dice.obsidian-gold': { color: 0x1c1410, roughness: 0.35, metalness: 0.45 },
  'dice.obsidian-silver': { color: 0x101728, roughness: 0.35, metalness: 0.55 },
  'dice.malachite-bronze': { color: 0x122418, roughness: 0.4, metalness: 0.5 },
};

// ---------- Lighting presets ------------------------------------------------

const LIGHTING_PRESETS: Record<string, LightingConfig> = {
  'tavern.candle': {
    ambient: { color: 0xb88a5a, intensity: 0.65 },
    hemisphere: { sky: 0xbb8a5a, ground: 0x1c0e08, intensity: 0.95 },
    key: {
      color: 0xffc890,
      intensity: 180,
      position: new THREE.Vector3(-3.2, 4.6, 3.4),
    },
    rim: {
      color: 0xe2bc7a,
      intensity: 40,
      position: new THREE.Vector3(2.8, 3.5, -3),
    },
    top: {
      color: 0xffe2b0,
      intensity: 1.4,
      position: new THREE.Vector3(0.5, 8, 1),
    },
  },
  'court.sapphire': {
    ambient: { color: 0x506488, intensity: 0.55 },
    hemisphere: { sky: 0x5a7ab8, ground: 0x080d18, intensity: 0.85 },
    key: {
      color: 0x9ab8ff,
      intensity: 180,
      position: new THREE.Vector3(-3.2, 4.6, 3.4),
    },
    rim: {
      color: 0xb0c4ff,
      intensity: 40,
      position: new THREE.Vector3(2.8, 3.5, -3),
    },
    top: {
      color: 0xc8d8ff,
      intensity: 1.3,
      position: new THREE.Vector3(0.5, 8, 1),
    },
  },
  'vault.rune': {
    ambient: { color: 0x4a7a5e, intensity: 0.55 },
    hemisphere: { sky: 0x6ea88a, ground: 0x080f0c, intensity: 0.85 },
    key: {
      color: 0x9adcb4,
      intensity: 180,
      position: new THREE.Vector3(-3.2, 4.6, 3.4),
    },
    rim: {
      color: 0xb8e8c8,
      intensity: 40,
      position: new THREE.Vector3(2.8, 3.5, -3),
    },
    top: {
      color: 0xcaecd6,
      intensity: 1.3,
      position: new THREE.Vector3(0.5, 8, 1),
    },
  },
};

// ---------- Public resolver -------------------------------------------------

const DEFAULTS: Required<{ [K in keyof ResolvedSceneTheme]: string }> = {
  table: 'wood.walnut',
  trayFloor: 'leather.dark',
  trayRail: 'leather.dark',
  dice: 'dice.obsidian-gold',
  lighting: 'tavern.candle',
};

const pick = <T>(table: Record<string, T>, id: string, fallback: string): T => {
  return table[id] ?? table[fallback]!;
};

/**
 * Look up the concrete configs that DiceScene needs from a SceneTheme.
 * Any unknown id silently falls back to the Tavern Classic equivalent
 * so unknown skins don't crash the scene.
 */
export function resolveSceneTheme(
  sceneTheme: SceneTheme | undefined,
): ResolvedSceneTheme {
  const id = sceneTheme ?? {
    tableMaterialId: DEFAULTS.table,
    trayMaterialId: DEFAULTS.trayFloor,
    diceMaterialId: DEFAULTS.dice,
    lightingPresetId: DEFAULTS.lighting,
    shadowPresetId: '',
    environmentPresetId: '',
  };
  return {
    table: pick(TABLE_PRESETS, id.tableMaterialId, DEFAULTS.table),
    trayFloor: pick(TRAY_FLOOR_PRESETS, id.trayMaterialId, DEFAULTS.trayFloor),
    // Tray rail palette tracks the floor for now — same trayMaterialId.
    trayRail: pick(TRAY_RAIL_PRESETS, id.trayMaterialId, DEFAULTS.trayRail),
    dice: pick(DICE_PRESETS, id.diceMaterialId, DEFAULTS.dice),
    lighting: pick(LIGHTING_PRESETS, id.lightingPresetId, DEFAULTS.lighting),
  };
}
