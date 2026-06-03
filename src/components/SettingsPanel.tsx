import { Sheet } from './Sheet';
import { tavernSurface } from '../lib/ui/tavernSurface';
import type { Settings } from '../types/dice';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (next: Settings) => void;
  /** Optional: render a "Skins" row that opens the skin selector. */
  onOpenSkins?: () => void;
  /** Active skin name shown next to the Skins row. */
  activeSkinName?: string;
}

export function SettingsPanel({
  open,
  onClose,
  settings,
  onChange,
  onOpenSkins,
  activeSkinName,
}: SettingsPanelProps) {
  const update = (patch: Partial<Settings>) =>
    onChange({ ...settings, ...patch });

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-3">
        {onOpenSkins && (
          <NavRow
            label="Skins"
            sublabel={activeSkinName ? `Active · ${activeSkinName}` : 'Pick a look'}
            onClick={onOpenSkins}
          />
        )}
        <SegmentRow
          label="Reduced motion"
          sublabel="Skip the 3D dice throw and just show the result"
          value={settings.reducedMotion}
          options={[
            { value: 'auto', label: 'System' },
            { value: 'off', label: 'Animated' },
            { value: 'on', label: 'Reduced' },
          ]}
          onChange={(v) =>
            update({ reducedMotion: v as Settings['reducedMotion'] })
          }
        />
        <ToggleRow
          label="Sound"
          sublabel="Procedural clack on every dice impact"
          value={settings.soundEnabled}
          onChange={(v) => update({ soundEnabled: v })}
        />
        <ToggleRow
          label="Haptics"
          sublabel="Phone vibration on landing"
          value={settings.hapticsEnabled}
          onChange={(v) => update({ hapticsEnabled: v })}
          comingSoon
        />

        <p className="mt-4 text-xs text-secondary/60 leading-relaxed">
          Rolls of D4 / D6 / D8 / D12 / D20 are decided by the physics —
          the value shown is read from the upward face of the settled die.
          D10 and D100 still use a fair random generator while their geometry
          is finished.
        </p>
      </div>
    </Sheet>
  );
}

interface NavRowProps {
  label: string;
  sublabel?: string;
  onClick: () => void;
}

function NavRow({ label, sublabel, onClick }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${tavernSurface({ intensity: 'inner', interactive: true })} w-full flex items-center justify-between gap-3 px-4 py-3 text-left`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ivory font-medium">{label}</p>
        {sublabel && (
          <p className="text-xs text-secondary mt-0.5 truncate">{sublabel}</p>
        )}
      </div>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-secondary/70"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

interface ToggleRowProps {
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  comingSoon?: boolean;
}

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
  comingSoon = false,
}: ToggleRowProps) {
  return (
    <div
      className={
        `${tavernSurface({ intensity: 'inner' })} flex items-center justify-between gap-3 px-4 py-3 ` +
        (comingSoon ? 'opacity-50' : '')
      }
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ivory font-medium flex items-center gap-2">
          {label}
          {comingSoon && (
            <span className="text-[9px] uppercase tracking-[0.15em] text-secondary/80 border border-subtle px-1.5 py-0.5 rounded">
              soon
            </span>
          )}
        </p>
        {sublabel && (
          <p className="text-xs text-secondary mt-0.5">{sublabel}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        disabled={comingSoon}
        className={
          'relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ' +
          (value
            ? 'bg-gold'
            : 'bg-white/[0.08] border border-subtle')
        }
      >
        <span
          className={
            'absolute top-[2px] w-5 h-5 rounded-full transition-transform duration-200 ' +
            (value
              ? 'bg-tray-deep translate-x-[22px]'
              : 'bg-ivory translate-x-[2px]')
          }
        />
      </button>
    </div>
  );
}

interface SegmentRowProps {
  label: string;
  sublabel?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}

function SegmentRow({
  label,
  sublabel,
  value,
  options,
  onChange,
}: SegmentRowProps) {
  return (
    <div className={`${tavernSurface({ intensity: 'inner' })} px-4 py-3`}>
      <p className="text-sm text-ivory font-medium">{label}</p>
      {sublabel && (
        <p className="text-xs text-secondary mt-0.5 mb-2">{sublabel}</p>
      )}
      <div className="flex gap-1.5 mt-2 rounded-lg bg-tray-deep/40 p-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                'flex-1 text-xs uppercase tracking-wider py-1.5 rounded-md transition-all duration-150 ' +
                (active
                  ? 'bg-gold text-tray-deep font-semibold'
                  : 'text-secondary hover:text-ivory')
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
