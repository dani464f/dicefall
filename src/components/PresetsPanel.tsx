import { useState, type FormEvent } from 'react';
import { Sheet } from './Sheet';
import { formatDiceFormula } from '../lib/dice';
import { tavernCaption, tavernSurface } from '../lib/ui/tavernSurface';
import type { Preset, RollSetup } from '../types/dice';

interface PresetsPanelProps {
  open: boolean;
  onClose: () => void;
  current: RollSetup;
  presets: Preset[];
  onSave: (name: string, setup: RollSetup) => void;
  onLoad: (preset: Preset) => void;
  onDelete: (id: string) => void;
}

export function PresetsPanel({
  open,
  onClose,
  current,
  presets,
  onSave,
  onLoad,
  onDelete,
}: PresetsPanelProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, current);
    setName('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Presets">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 mb-5 pb-5 border-b border-subtle"
      >
        <label className="block">
          <span className={`block mb-1.5 ${tavernCaption}`}>Save current as</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Longsword Damage"
            maxLength={40}
            className="w-full rounded-lg bg-white/[0.04] border border-subtle px-3 py-2.5 text-ivory placeholder:text-secondary/50 focus:border-gold/55 focus:outline-none transition-colors"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-sm text-secondary tabular-nums">
            {formatDiceFormula(current)}
          </span>
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg font-semibold text-xs tracking-[0.22em] uppercase active:scale-95 transition-all duration-100 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              // Refined "primary" — derived from the gold ramp so it
              // re-tints with the skin instead of pinning #c9a45c. Less
              // candy than the prior flat bg-gold, still reads as the
              // dominant action in the form.
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--color-gold) 92%, white 8%) 0%, var(--color-gold) 100%)',
              color: 'var(--color-tray-deep)',
              border:
                '1px solid color-mix(in srgb, var(--color-gold) 80%, black 20%)',
              boxShadow:
                '0 1px 3px rgba(0,0,0,0.45), inset 0 1px 0 color-mix(in srgb, var(--color-gold) 40%, white 60%)',
            }}
          >
            Save
          </button>
        </div>
      </form>

      {presets.length === 0 ? (
        <p className="text-center text-secondary/70 text-sm py-8">
          No presets yet. Name your current setup above to save it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {presets.map((p) => (
            <li key={p.id}>
              <div className={`${tavernSurface({ interactive: true })} flex items-stretch overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => onLoad(p)}
                  className="flex-1 flex items-center justify-between text-left px-4 py-3 min-w-0 active:bg-white/[0.05] transition-colors"
                >
                  <span className="text-ivory font-medium truncate pr-3">
                    {p.name}
                  </span>
                  <span className="font-display text-sm text-secondary tabular-nums shrink-0">
                    {formatDiceFormula(p)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  aria-label={`Delete ${p.name}`}
                  className="w-11 shrink-0 text-secondary/60 hover:text-danger hover:bg-danger/10 flex items-center justify-center transition-colors border-l border-subtle"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  >
                    <path d="M2 2l8 8M10 2L2 10" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

