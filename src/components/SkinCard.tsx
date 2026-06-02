import type { Skin } from '../types/skins';

interface SkinCardProps {
  skin: Skin;
  isEquipped: boolean;
  isUnlocked: boolean;
  onEquip: () => void;
  /** Dev-only affordance for unlockable skins; not shown for premium skins. */
  onDevUnlock?: (() => void) | undefined;
}

/**
 * One row in the SkinSelector. Premium and dark-fantasy in tone — small
 * gradient swatch on the left, name + status on the right, action button
 * at the end. No fake store sparkles, no aggressive monetization cues.
 */
export function SkinCard({
  skin,
  isEquipped,
  isUnlocked,
  onEquip,
  onDevUnlock,
}: SkinCardProps) {
  const swatch = buildSwatchGradient(skin);

  return (
    <div
      className="flex items-stretch rounded-xl border border-subtle bg-white/[0.03] overflow-hidden"
      style={
        isEquipped
          ? {
              boxShadow: `inset 0 0 0 1px ${skin.uiTheme.accent}66`,
            }
          : undefined
      }
    >
      {/* Preview swatch */}
      <div
        className="w-14 shrink-0"
        aria-hidden
        style={{ background: swatch }}
      />

      {/* Body */}
      <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium text-ivory truncate">{skin.name}</p>
          <CategoryBadge skin={skin} />
        </div>
        <p className="text-[11px] text-secondary leading-snug line-clamp-2">
          {!isUnlocked && skin.unlockRequirement
            ? skin.unlockRequirement
            : skin.description}
        </p>
      </div>

      {/* Action */}
      <div className="shrink-0 flex items-center pr-2.5 pl-1">
        <ActionButton
          skin={skin}
          isEquipped={isEquipped}
          isUnlocked={isUnlocked}
          onEquip={onEquip}
          onDevUnlock={onDevUnlock}
        />
      </div>
    </div>
  );
}

function CategoryBadge({ skin }: { skin: Skin }) {
  const label =
    skin.category === 'free'
      ? 'Free'
      : skin.category === 'premium'
        ? 'Premium'
        : 'Unlockable';
  return (
    <span className="shrink-0 text-[8.5px] uppercase tracking-[0.18em] text-secondary/85 border border-subtle px-1.5 py-0.5 rounded">
      {label}
    </span>
  );
}

interface ActionButtonProps {
  skin: Skin;
  isEquipped: boolean;
  isUnlocked: boolean;
  onEquip: () => void;
  onDevUnlock?: (() => void) | undefined;
}

function ActionButton({
  skin,
  isEquipped,
  isUnlocked,
  onEquip,
  onDevUnlock,
}: ActionButtonProps) {
  if (isEquipped) {
    return (
      <span className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-gold/90 border border-gold/40 rounded-md">
        Equipped
      </span>
    );
  }

  if (isUnlocked) {
    return (
      <button
        type="button"
        onClick={onEquip}
        className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-tray-deep bg-gold rounded-md active:scale-95 transition-transform"
      >
        Equip
      </button>
    );
  }

  if (skin.category === 'premium') {
    return (
      <span className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-secondary/80 border border-subtle rounded-md">
        Coming Soon
      </span>
    );
  }

  // Unlockable + locked. Show locked state, and a dev-test unlock button
  // *only* in development builds (Vite strips the JSX out of the prod
  // bundle when the condition is statically false).
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.18em] text-secondary/80 border border-subtle rounded-md">
        Locked
      </span>
      {import.meta.env.DEV && onDevUnlock && (
        <button
          type="button"
          onClick={onDevUnlock}
          className="text-[8.5px] uppercase tracking-[0.2em] text-secondary/70 hover:text-ivory/90"
          aria-label={`Dev unlock ${skin.name}`}
        >
          Dev · Unlock
        </button>
      )}
    </div>
  );
}

/**
 * Build a small gradient swatch from the skin's UiTheme so users get a
 * preview of the palette without needing image assets.
 */
function buildSwatchGradient(skin: Skin): string {
  const { background, surface, accent } = skin.uiTheme;
  return `linear-gradient(135deg, ${background} 0%, ${surface} 60%, ${accent} 130%)`;
}
