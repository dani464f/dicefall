import type { CSSProperties } from 'react';

/**
 * Canonical class strings + style objects for the dark-tavern surface
 * treatment used by cards, list rows, settings rows, the SkinCard frame,
 * and the framed ResultPanel / DiceSelector tray. Compose with the
 * caller's own padding / layout / hover classes via template literal:
 *
 *   <div className={`${tavernSurface()} px-4 py-3`}>...</div>
 *   <button className={`${tavernSurface({ interactive: true })} ...`}>
 *
 * Why a function and not a <TavernSurface> component:
 *   Every site needs a different host element (div / li / button) and
 *   different padding / event handlers. A polymorphic wrapper would
 *   need an `as` prop, ref forwarding, and a generic prop type —
 *   strictly more surface area than the duplication it would eliminate.
 *   The function form composes cleanly with Tailwind class strings,
 *   keeps the call site readable, and adds zero render overhead.
 *
 * JSX-bearing flourishes (corner ornaments, divider with diamond) live
 * in the sibling `tavernOrnaments.tsx` so this module stays a pure
 * non-React module that can be imported from anywhere.
 */
export interface TavernSurfaceOptions {
  /**
   * `card` (default): bg-white/[0.03] — free-standing cards and list
   *  rows that sit directly on the bg.
   * `inner`:           bg-white/[0.02] — rows nested inside a section
   *  so they read as one level deeper than a card.
   */
  intensity?: 'card' | 'inner';
  /**
   * Adds a hover affordance: gold-tinted border + color transition.
   * Use on anything the user can click (buttons, link rows, draggable
   * list items). Skip for static display surfaces.
   */
  interactive?: boolean;
}

export function tavernSurface(opts?: TavernSurfaceOptions): string {
  const bg = opts?.intensity === 'inner' ? 'bg-white/[0.02]' : 'bg-white/[0.03]';
  const interactive = opts?.interactive
    ? ' hover:border-gold/35 transition-colors'
    : '';
  return `rounded-xl border border-subtle ${bg}${interactive}`;
}

/* -------------------------------------------------------------------------- */
/* Shared visual primitives                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Canonical CSS style object for the framed "tavern panel" — used by the
 * ResultPanel and the DiceSelector tray. Skin-aware: derives both the
 * surface fill and the gold edge from CSS variables so equipping
 * Obsidian / Arcane re-tints automatically.
 *
 * `tone`:
 *   - 'lifted' (default): a brighter gold edge + soft outer shadow —
 *     reads as the primary surface in its row (ResultPanel).
 *   - 'inset':            a quieter edge + inset glow — reads as a recessed
 *     tray (DiceSelector).
 */
export interface TavernPanelOptions {
  tone?: 'lifted' | 'inset';
}
export function tavernPanelStyle(
  opts?: TavernPanelOptions,
): CSSProperties {
  const lifted = opts?.tone !== 'inset';
  return {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--color-tray-deep) 76%, transparent) 0%, color-mix(in srgb, var(--color-tray-deep) 88%, #000 12%) 100%)',
    border: `1px solid color-mix(in srgb, var(--color-gold) ${lifted ? 42 : 30}%, transparent)`,
    borderRadius: 12,
    boxShadow: lifted
      ? // Lifted reads above the tray: soft outer shadow, faint inner.
        '0 4px 16px rgba(0,0,0,0.42), inset 0 0 8px rgba(0,0,0,0.3)'
      : // Inset reads as a recessed surface: inner glow only.
        'inset 0 0 14px rgba(0,0,0,0.5)',
  };
}

/**
 * The standard "section heading" microtype used in the bottom sheets and
 * the result panel — uppercase, wide-tracked, two-thirds gold. Keeping
 * this in one place means a future spacing/tracking nudge doesn't need a
 * twelve-file grep. The leading `tavern` prefix is intentional so a
 * grep for `tavernSectionLabel` finds every usage site.
 */
export const tavernSectionLabel =
  'text-2xs uppercase tracking-[0.28em] text-gold/70';

/** Less prominent variant for sub-section caption microtype. */
export const tavernCaption =
  'text-2xs uppercase tracking-[0.22em] text-secondary/70';
