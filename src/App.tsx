import { useCallback, useState } from 'react';
import { DiceTray } from './components/DiceTray';
import { DiceSelector } from './components/DiceSelector';
import { ResultPanel } from './components/ResultPanel';
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

const DEFAULT_DIE: DiceType = 'd20';
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
  const [modifier] = useState(DEFAULT_MODIFIER);
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
    const usePhysics =
      isPhysicsDie(diceType) && !effectiveReducedMotion(settings);
    if (usePhysics) {
      throwDice(diceType, quantity);
    } else {
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

  const handleSavePreset = (name: string, setup: RollSetup) => {
    const preset: Preset = { id: makeId(), name, ...setup };
    setPresets((p) => [preset, ...p]);
  };

  const handleLoadPreset = (preset: Preset) => {
    setDiceType(preset.diceType);
    setQuantity(preset.quantity);
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

  const currentSetup: RollSetup = {
    diceType,
    quantity,
    modifier: 0,
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      {/* Full-screen 3D tavern scene */}
      <DiceTray
        result={lastRoll}
        isRolling={isRolling}
        throwRequest={throwRequest}
        onResult={handlePhysicsResult}
      />

      {/* Vignette over the scene for cinematic edges */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Top bar */}
      <header
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-5"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 0.75rem)',
          paddingBottom: '0.5rem',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 100%)',
        }}
      >
        <CircleButton label="Menu" onClick={() => setOpenSheet('history')}>
          <HamburgerIcon />
        </CircleButton>
        <h1
          className="font-display text-xl text-gold uppercase tracking-[0.4em]"
          style={{ textShadow: '0 0 14px rgba(201,164,92,0.4)' }}
        >
          Tavern
        </h1>
        <CircleButton label="Presets" onClick={() => setOpenSheet('presets')}>
          <PouchIcon />
        </CircleButton>
      </header>

      {/* Bottom control stack */}
      <div
        className="absolute left-0 right-0 bottom-0 flex flex-col gap-3 px-4"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
        }}
      >
        <div className="mx-auto w-full max-w-md flex flex-col gap-2.5">
          <ResultPanel result={lastRoll} isRolling={isRolling} />
          <DiceSelector selected={diceType} onSelect={setDiceType} />
          <QuantityPill
            diceType={diceType}
            quantity={quantity}
            onChange={setQuantity}
          />
          <RollButton onClick={handleRoll} disabled={isRolling} rolling={isRolling} />
          <BottomNav
            hasResult={!!lastRoll}
            onClear={clear}
            onHistory={() => setOpenSheet('history')}
            onSettings={() => setOpenSheet('settings')}
          />
        </div>
      </div>

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

// ===========================================================================
// Small in-file UI bits
// ===========================================================================

interface QuantityPillProps {
  diceType: DiceType;
  quantity: number;
  onChange: (n: number) => void;
}

function QuantityPill({ diceType, quantity, onChange }: QuantityPillProps) {
  const dec = () => onChange(Math.max(1, quantity - 1));
  const inc = () => onChange(Math.min(20, quantity + 1));
  return (
    <div
      className="self-center flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        background:
          'linear-gradient(180deg, rgba(20,12,8,0.78) 0%, rgba(10,6,3,0.88) 100%)',
        border: '1px solid rgba(201, 164, 92, 0.5)',
      }}
    >
      <button
        type="button"
        onClick={dec}
        aria-label="Decrease quantity"
        className="w-6 h-6 rounded-full text-gold/80 hover:text-gold text-base leading-none flex items-center justify-center"
      >
        −
      </button>
      <span className="text-xs uppercase tracking-[0.2em] text-gold/70">
        {quantity} × {diceType.toUpperCase()}
      </span>
      <button
        type="button"
        onClick={inc}
        aria-label="Increase quantity"
        className="w-6 h-6 rounded-full text-gold/80 hover:text-gold text-base leading-none flex items-center justify-center"
      >
        +
      </button>
    </div>
  );
}

interface RollButtonProps {
  onClick: () => void;
  disabled: boolean;
  rolling: boolean;
}

function RollButton({ onClick, disabled, rolling }: RollButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative w-full rounded-2xl py-3.5 transition-all duration-100 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        background:
          'linear-gradient(180deg, #e6c378 0%, #c9a45c 45%, #8c6c3a 100%)',
        border: '1px solid rgba(0,0,0,0.55)',
        boxShadow:
          '0 8px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,230,180,0.65), inset 0 -2px 4px rgba(0,0,0,0.4)',
      }}
    >
      <span
        className="block font-display text-2xl uppercase tracking-[0.45em] leading-none"
        style={{
          color: '#1c0f06',
          textShadow: '0 1px 0 rgba(255,230,180,0.55)',
        }}
      >
        {rolling ? 'Rolling' : 'Roll'}
      </span>
      <span
        className="block text-[9px] uppercase tracking-[0.4em] mt-1"
        style={{ color: 'rgba(28,15,6,0.65)' }}
      >
        Tap to roll
      </span>
    </button>
  );
}

interface BottomNavProps {
  hasResult: boolean;
  onClear: () => void;
  onHistory: () => void;
  onSettings: () => void;
}

function BottomNav({ hasResult, onClear, onHistory, onSettings }: BottomNavProps) {
  return (
    <div className="flex items-center justify-between pt-1">
      <NavItem icon={<ClockIcon />} label="History" onClick={onHistory} />
      {hasResult ? (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] uppercase tracking-[0.3em] text-secondary/70 hover:text-gold transition-colors"
        >
          Clear tray
        </button>
      ) : (
        <span aria-hidden />
      )}
      <NavItem icon={<GearIcon />} label="Settings" onClick={onSettings} />
    </div>
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function NavItem({ icon, label, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 text-secondary/80 hover:text-gold transition-colors"
    >
      <span className="w-9 h-9 rounded-full border border-gold/35 flex items-center justify-center">
        {icon}
      </span>
      <span className="text-[9px] uppercase tracking-[0.3em]">{label}</span>
    </button>
  );
}

interface CircleButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function CircleButton({ label, onClick, children }: CircleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 rounded-full flex items-center justify-center text-gold/85 hover:text-gold transition-colors"
      style={{
        background: 'rgba(10,6,3,0.55)',
        border: '1px solid rgba(201,164,92,0.45)',
      }}
    >
      {children}
    </button>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function PouchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M6 9c0-1.5 6-3 6-3s6 1.5 6 3v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9z" />
      <path d="M9 8V5l3-2 3 2v3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12,7 12,12 15.5,14" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
