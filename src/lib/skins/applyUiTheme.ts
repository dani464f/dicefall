import type { UiTheme } from '../../types/skins';

/**
 * Mirror the active skin's UiTheme into the CSS custom properties that
 * Tailwind v4's @theme block declares in index.css. Every utility class
 * the app uses (bg-bg, text-gold, border-subtle, etc.) reads from these
 * same variables, so writing them here changes the entire visual shell
 * without any component refactor.
 *
 * Token mapping (UiTheme field → CSS variable):
 *   background     → --color-bg
 *   surface        → --color-tray             (used by panels + tray surfaces)
 *   primaryText    → --color-ivory
 *   secondaryText  → --color-secondary
 *   accent         → --color-gold             (and --color-gold-soft, derived)
 *   border         → --color-subtle
 *   button         → --color-gold             (button bg = accent)
 *   buttonText     → --color-tray-deep        (text on the gold button)
 */
export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--color-bg', theme.background);
  root.style.setProperty('--color-tray', theme.surface);
  // Derive a slightly darker tray-deep from the surface for legibility on
  // gold buttons; falls back to buttonText if a skin wants a hard override.
  root.style.setProperty('--color-tray-deep', theme.buttonText);
  root.style.setProperty('--color-ivory', theme.primaryText);
  root.style.setProperty('--color-secondary', theme.secondaryText);
  root.style.setProperty('--color-gold', theme.accent);
  root.style.setProperty('--color-gold-soft', theme.accent);
  root.style.setProperty('--color-subtle', theme.border);
}

/** Reset all skin-driven CSS vars; useful for tests or hard-reload paths. */
export function resetUiTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const v of [
    '--color-bg',
    '--color-tray',
    '--color-tray-deep',
    '--color-ivory',
    '--color-secondary',
    '--color-gold',
    '--color-gold-soft',
    '--color-subtle',
  ]) {
    root.style.removeProperty(v);
  }
}
