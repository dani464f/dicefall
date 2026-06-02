import { ALL_DICE, type DiceType } from '../types/dice';

interface DiceSelectorProps {
  selected: DiceType;
  onSelect: (d: DiceType) => void;
}

/**
 * Tavern dice rack — horizontal row of D4..D100 with thin gold dividers
 * between them. Active die glows gold; rest are subtle parchment-on-leather.
 */
export function DiceSelector({ selected, onSelect }: DiceSelectorProps) {
  return (
    <div
      className="relative flex items-stretch w-full overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, rgba(18,10,6,0.72) 0%, rgba(10,6,3,0.82) 100%)',
        border: '1px solid rgba(201, 164, 92, 0.35)',
        borderRadius: '10px',
        boxShadow: 'inset 0 0 18px rgba(0,0,0,0.6)',
      }}
    >
      {ALL_DICE.map((d, idx) => {
        const isActive = d === selected;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            className={
              'relative flex-1 flex flex-col items-center justify-center py-2 transition-all duration-150 active:scale-95 ' +
              (isActive ? 'text-gold' : 'text-secondary hover:text-ivory')
            }
            style={
              isActive
                ? {
                    background:
                      'radial-gradient(ellipse at center, rgba(201,164,92,0.18) 0%, transparent 70%)',
                    textShadow: '0 0 10px rgba(201,164,92,0.55)',
                  }
                : undefined
            }
          >
            {idx > 0 && (
              <span
                aria-hidden
                className="absolute left-0 top-2 bottom-2 w-px bg-gold/25"
              />
            )}
            <DieGlyph type={d} active={isActive} />
            <span className="text-[10px] uppercase tracking-wider font-semibold mt-0.5">
              {d.toUpperCase()}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, #c9a45c 50%, transparent 100%)',
                  boxShadow: '0 0 8px #c9a45c',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function DieGlyph({ type, active }: { type: DiceType; active: boolean }) {
  // Minimal "dice silhouette" per type. Just gives the row a visual cue
  // beyond text — full custom SVGs per die are polish for later.
  const stroke = active ? '#d4af6b' : '#8a7e69';
  const fill = active ? 'rgba(201,164,92,0.12)' : 'transparent';
  switch (type) {
    case 'd4':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 17,17 3,17" />
        </svg>
      );
    case 'd6':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <rect x="4" y="4" width="12" height="12" rx="1.5" />
        </svg>
      );
    case 'd8':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 17,10 10,17 3,10" />
        </svg>
      );
    case 'd10':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,3 16,7 16,13 10,17 4,13 4,7" />
        </svg>
      );
    case 'd12':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,2 17,7 15,16 5,16 3,7" />
        </svg>
      );
    case 'd20':
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="10,2 18,8 15,18 5,18 2,8" />
        </svg>
      );
    case 'd100':
      return (
        <svg width="18" height="16" viewBox="0 0 22 20" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
          <polygon points="7,3 11,7 11,13 7,17 3,13 3,7" />
          <polygon points="15,3 19,7 19,13 15,17 11,13 11,7" />
        </svg>
      );
  }
}
