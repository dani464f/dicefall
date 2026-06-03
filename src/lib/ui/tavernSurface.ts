/**
 * Canonical class string for the dark-tavern surface treatment used by
 * cards, list rows, settings rows, and the SkinCard frame. Compose with
 * the caller's own padding / layout / hover classes via template literal:
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
    ? ' hover:border-gold/30 transition-colors'
    : '';
  return `rounded-xl border border-subtle ${bg}${interactive}`;
}
