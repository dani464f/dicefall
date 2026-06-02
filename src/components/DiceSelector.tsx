import { ALL_DICE, type DiceType } from '../types/dice';

interface DiceSelectorProps {
  selected: DiceType;
  onSelect: (d: DiceType) => void;
}

export function DiceSelector({ selected, onSelect }: DiceSelectorProps) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {ALL_DICE.map((d) => {
        const isActive = d === selected;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            className={
              'py-2.5 rounded-full text-xs font-semibold tracking-wider transition-all duration-150 active:scale-95 ' +
              (isActive
                ? 'bg-gold text-tray-deep shadow-[0_2px_12px_rgba(201,164,92,0.35)]'
                : 'bg-white/[0.04] text-secondary hover:text-ivory border border-subtle')
            }
          >
            {d.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
