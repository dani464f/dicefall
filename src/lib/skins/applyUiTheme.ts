import type { UiTheme } from '../../types/skins';

/**
 * Mirror the active skin's UiTheme into the CSS custom properties that
 * Tailwind v4's @theme block declares in index.css. Every utility class the
 * app uses (bg-bg, text-gold, border-subtle, etc.) reads from these same
 * variables, so writing them here changes the entire visual shell without
 * any component refactor.
 *
 * See UiTheme docstring (types/skins.ts) for the field→variable map.
 */

const TOKEN_MAP: ReadonlyArray<readonly [keyof UiTheme, string]> = [
  ['background', '--color-bg'],
  ['surface', '--color-tray'],
  ['surfaceDeep', '--color-tray-deep'],
  ['surfaceWarm', '--color-tray-warm'],
  ['primaryText', '--color-ivory'],
  ['secondaryText', '--color-secondary'],
  ['accent', '--color-gold'],
  ['accentSoft', '--color-gold-soft'],
  ['danger', '--color-danger'],
  ['special', '--color-special'],
  ['border', '--color-subtle'],
];

export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [field, cssVar] of TOKEN_MAP) {
    root.style.setProperty(cssVar, theme[field]);
  }
  // `button` and `buttonText` are exposed on the skin model for future
  // skin authors who want custom Roll button gradients — we don't map
  // them to global tokens because every button shouldn't restyle on
  // equip. Components that opt-in can read theme.button via useSkinSystem.
}

/** Reset all skin-driven CSS vars; useful for tests or hard-reload paths. */
export function resetUiTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [, cssVar] of TOKEN_MAP) {
    root.style.removeProperty(cssVar);
  }
}
