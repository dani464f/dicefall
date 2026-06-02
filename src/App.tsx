import { useCallback, useState } from 'react';
import { DiceTray } from './components/DiceTray';
import { DiceSelector } from './components/DiceSelector';
import { RollControls } from './components/RollControls';
import { PresetsPanel } from './components/PresetsPanel';
import { RollHistory } from './components/RollHistory';
import { SettingsPanel } from './components/SettingsPanel';
import { useDiceRoller } from './hooks/useDiceRoller';
import { useLocalStorage } from './hooks/useLocalStorage';
import { isPhysicsDie } from './lib/faceDetection';
import {
  DEFAULT_SETTINGS,
  type DiceType,
  type Preset,
  type RollResult,
  type RollSetup,
  type Settings,
} from './types/dice';

const DEFAULT_DIE: DiceType = 'd6';
const DEFAULT_QUANTITY = 1;
const DEFAULT_MODIFIER = 0;
const HISTORY_MAX = 50;

const PRESETS_KEY = 'dicefall.presets.v1';
const HISTORY_KEY = 'dicefall.history.v1';
const SETTINGS_KEY = 'dicefall.settings.v1';

type SheetName = 'presets' | 'history' | 'settings' | null;

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function effectiveReducedMotion(s: Settings): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function App() {
  const [diceType, setDiceType] = useState<DiceType>(DEFAULT_DIE);
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);
  const [modifier, setModifier] = useState(DEFAULT_MODIFIER);
  const {
    lastRoll,
    isRolling,
    throwRequest,
    roll,
    throwDice,
    commitPhysicsResult,
    clear,
  } = useDiceRoller();
  const [presets, setPresets] = useLocalStorage<Preset[]>(PRESETS_KEY, []);
  const [history, setHistory] = useLocalStorage<RollResult[]>(HISTORY_KEY, []);
  const [settings, setSettings] = useLocalStorage<Settings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );
  const [openSheet, setOpenSheet] = useState<SheetName>(null);

  const recordRoll = useCallback(
    (result: RollResult) => {
      setHistory((h) => [result, ...h].slice(0, HISTORY_MAX));
    },
    [setHistory],
  );

  const handleRoll = () => {
    const usePhysics = isPhysicsDie(diceType) && !effectiveReducedMotion(settings);
    if (usePhysics) {
      throwDice(diceType, quantity);
    } else {
      // Reduced-motion users (or D10/D100) get an immediate RNG result.
      const result = roll(diceType, quantity, isPhysicsDie(diceType) ? 0 : modifier);
      recordRoll(result);
    }
  };

  const handlePhysicsResult = useCallback(
    (dt: DiceType, qty: number, values: number[]) => {
      const result = commitPhysicsResult(dt, qty, values);
      recordRoll(result);
    },
    [commitPhysicsResult, recordRoll],
  );

  const handleClear = () => {
    setDiceType(DEFAULT_DIE);
    setQuantity(DEFAULT_QUANTITY);
    setModifier(DEFAULT_MODIFIER);
    clear();
  };

  const handleSavePreset = (name: string, setup: RollSetup) => {
    const preset: Preset = { id: makeId(), name, ...setup };
    setPresets((p) => [preset, ...p]);
  };

  const handleLoadPreset = (preset: Preset) => {
    setDiceType(preset.diceType);
    setQuantity(preset.quantity);
    setModifier(preset.modifier);
    setOpenSheet(null);
    const usePhysics =
      isPhysicsDie(preset.diceType) && !effectiveReducedMotion(settings);
    if (usePhysics) {
      throwDice(preset.diceType, preset.quantity);
    } else {
      const result = roll(
        preset.diceType,
        preset.quantity,
        isPhysicsDie(preset.diceType) ? 0 : preset.modifier,
      );
      recordRoll(result);
    }
  };

  const handleDeletePreset = (id: string) => {
    setPresets((p) => p.filter((x) => x.id !== id));
  };

  const modifierLocked =
    isPhysicsDie(diceType) && !effectiveReducedMotion(settings);
  const currentSetup: RollSetup = {
    diceType,
    quantity,
    modifier: modifierLocked ? 0 : modifier,
  };

  return (
    <div
      className="h-full w-full mx-auto flex flex-col gap-3 max-w-md px-4"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 0.75rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
      }}
    >
      <header className="flex items-center justify-between py-1">
        <h1 className="font-display text-2xl tracking-wide text-ivory">
          <span className="text-gold">Dice</span>fall
        </h1>
        <div className="flex items-center gap-1">
          <HeaderIconButton
            label="Presets"
            onClick={() => setOpenSheet('presets')}
          >
            <StarIcon />
          </HeaderIconButton>
          <HeaderIconButton
            label="History"
            onClick={() => setOpenSheet('history')}
          >
            <ClockIcon />
          </HeaderIconButton>
          <HeaderIconButton
            label="Settings"
            onClick={() => setOpenSheet('settings')}
          >
            <GearIcon />
          </HeaderIconButton>
        </div>
      </header>

      <DiceTray
        result={lastRoll}
        isRolling={isRolling}
        throwRequest={throwRequest}
        onResult={handlePhysicsResult}
      />

      <section className="flex flex-col gap-3">
        <DiceSelector selected={diceType} onSelect={setDiceType} />
        <RollControls
          diceType={diceType}
          quantity={quantity}
          modifier={modifier}
          onQuantityChange={setQuantity}
          onModifierChange={setModifier}
          modifierLocked={modifierLocked}
        />
        <button
          type="button"
          onClick={handleRoll}
          disabled={isRolling}
          className="w-full rounded-2xl py-4 font-display text-2xl tracking-[0.3em] uppercase bg-gold text-tray-deep shadow-[0_6px_24px_rgba(201,164,92,0.35),inset_0_-2px_0_rgba(0,0,0,0.15)] active:scale-[0.99] active:shadow-[0_2px_8px_rgba(201,164,92,0.25)] transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRolling ? 'Rolling…' : 'Roll'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          aria-hidden={!lastRoll}
          tabIndex={lastRoll ? 0 : -1}
          className={
            'self-center text-xs uppercase tracking-[0.25em] text-secondary/70 hover:text-ivory transition-opacity duration-200 ' +
            (lastRoll ? 'opacity-100' : 'opacity-0 pointer-events-none')
          }
        >
          Clear tray
        </button>
      </section>

      <PresetsPanel
        open={openSheet === 'presets'}
        onClose={() => setOpenSheet(null)}
        current={currentSetup}
        presets={presets}
        onSave={handleSavePreset}
        onLoad={handleLoadPreset}
        onDelete={handleDeletePreset}
      />

      <RollHistory
        open={openSheet === 'history'}
        onClose={() => setOpenSheet(null)}
        history={history}
        onClear={() => setHistory([])}
      />

      <SettingsPanel
        open={openSheet === 'settings'}
        onClose={() => setOpenSheet(null)}
        settings={settings}
        onChange={setSettings}
      />
    </div>
  );
}

interface HeaderIconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function HeaderIconButton({ label, onClick, children }: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-10 h-10 rounded-full text-secondary hover:text-gold hover:bg-white/[0.04] flex items-center justify-center transition-colors duration-150"
    >
      {children}
    </button>
  );
}

function StarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M12 3l2.79 5.66 6.24.91-4.52 4.4 1.07 6.22L12 17.27l-5.58 2.92 1.07-6.22-4.52-4.4 6.24-.91L12 3z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 15.5,14" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
