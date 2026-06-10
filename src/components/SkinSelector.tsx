import { Sheet } from './Sheet';
import { SkinCard } from './SkinCard';
import { tavernSectionLabel } from '../lib/ui/tavernSurface';
import type { Skin, SkinCategory } from '../types/skins';

interface SkinSelectorProps {
  open: boolean;
  onClose: () => void;
  skins: readonly Skin[];
  activeSkinId: string;
  isUnlocked: (id: string) => boolean;
  onEquip: (id: string) => void;
  onDevUnlock: (id: string) => void;
}

const SECTIONS: { label: string; category: SkinCategory }[] = [
  { label: 'Free', category: 'free' },
  { label: 'Premium', category: 'premium' },
  { label: 'Unlockable', category: 'unlockable' },
];

/**
 * Premium-feeling skin picker — uses the same bottom-sheet primitive as
 * Presets, History, and Settings so it feels native to the app.
 *
 * Sections render in the order defined above; empty categories are
 * omitted, so adding only-free skins still looks clean.
 */
export function SkinSelector({
  open,
  onClose,
  skins,
  activeSkinId,
  isUnlocked,
  onEquip,
  onDevUnlock,
}: SkinSelectorProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Skins">
      <div className="flex flex-col gap-5 pb-2">
        {SECTIONS.map(({ label, category }) => {
          const list = skins.filter((s) => s.category === category);
          if (list.length === 0) return null;
          return (
            <section key={category} className="flex flex-col gap-2">
              <header className="flex items-baseline justify-between px-0.5">
                <h3 className={tavernSectionLabel}>{label}</h3>
                <span className="text-2xs text-secondary/50 tabular-nums">
                  {list.length}
                </span>
              </header>
              <ul className="flex flex-col gap-2">
                {list.map((skin) => (
                  <li key={skin.id}>
                    <SkinCard
                      skin={skin}
                      isEquipped={skin.id === activeSkinId}
                      isUnlocked={isUnlocked(skin.id)}
                      onEquip={() => {
                        onEquip(skin.id);
                      }}
                      onDevUnlock={
                        skin.category === 'unlockable' && !isUnlocked(skin.id)
                          ? () => onDevUnlock(skin.id)
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <p className="text-2xs text-secondary/50 leading-relaxed mt-2 px-0.5">
          Skins only change how Dicefall looks and sounds. Roll math, physics,
          history, and presets stay the same across every skin.
        </p>
      </div>
    </Sheet>
  );
}
