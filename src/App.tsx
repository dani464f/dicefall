import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { DiceSelector } from './components/DiceSelector';

// The 3D scene + Rapier WASM are heavy. Lazy-load them so the React shell
// (top bar, controls, sheets) can paint immediately and the dice tray
// arrives in a second chunk a moment later.
const DiceTray = lazy(() =>
  import('./components/DiceTray').then((m) => ({ default: m.DiceTray })),
);
import { ResultPanel } from './components/ResultPanel';
import { PresetsPanel } from './components/PresetsPanel';
import { RollHistory } from './components/RollHistory';
import { SettingsPanel } from './components/SettingsPanel';
import { SkinSelector } from './components/SkinSelector';
import { useDiceRoller } from './hooks/useDiceRoller';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useSkinSystem } from './hooks/useSkinSystem';
import { diceAudio } from './lib/audio/diceAudio';
import { diceHaptics } from './lib/haptics/diceHaptics';
import { isPhysicsDie } from './lib/faceDetection';
import {
  DEFAULT_SETTINGS,
  type DiceType,
  type Preset,
  type RollMode,
  type RollResult,
  type RollSetup,
  type Settings,
} from './types/dice';

const DEFAULT_DIE: DiceType = 'd20';
const DEFAULT_QUANTITY = 1;
const DEFAULT_PROF_BONUS = 0;
const PROF_BONUS_MIN = 0;
const PROF_BONUS_MAX = 6;
const HISTORY_MAX = 50;

const PRESETS_KEY = 'dicefall.presets.v1';
const HISTORY_KEY = 'dicefall.history.v1';
const SETTINGS_KEY = 'dicefall.settings.v1';
const PROF_BONUS_KEY = 'dicefall.profBonus.v1';

type SheetName = 'presets' | 'history' | 'settings' | 'skins' | null;

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function effectiveReducedMotion(s: Settings): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mirror the resolved reduced-motion state onto <html> so the
 *  `html[data-reduced-motion='true']` CSS rule in index.css can suppress
 *  every Tailwind transition + keyframe animation. */
function useReducedMotionAttribute(reduced: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (reduced) root.setAttribute('data-reduced-motion', 'true');
    else root.removeAttribute('data-reduced-motion');
  }, [reduced]);
}

export default function App() {
  const [diceType, setDiceType] = useState<DiceType>(DEFAULT_DIE);
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);
  // Roll mode is intentionally session-only (not persisted). Advantage is
  // a situational, per-encounter state — surviving across reloads would
  // create silent "why is my roll wrong" moments. Toggling it explicitly
  // each time is the safer default.
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [profBonusRaw, setProfBonus] = useLocalStorage<number>(
    PROF_BONUS_KEY,
    DEFAULT_PROF_BONUS,
  );
  // Hand-edited storage or a future build shifting the range could leave a
  // value outside [MIN, MAX]; clamp on read so the UI can never display or
  // apply a bonus the controls couldn't have produced.
  const profBonus = Number.isFinite(profBonusRaw)
    ? Math.min(PROF_BONUS_MAX, Math.max(PROF_BONUS_MIN, Math.trunc(profBonusRaw)))
    : DEFAULT_PROF_BONUS;
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
  const [settingsRaw, setSettings] = useLocalStorage<Settings>(
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
  );
  // Defensive — if a previous build wrote a Settings shape that's missing
  // a field (or storage was hand-edited), merge over DEFAULT_SETTINGS so
  // every downstream `settings.field` access is well-defined. Cheap and
  // forwards-compatible with adding new Settings keys in future builds.
  const settings: Settings = { ...DEFAULT_SETTINGS, ...settingsRaw };
  const [openSheet, setOpenSheet] = useState<SheetName>(null);

  // Skin system — owns active/unlocked/owned-premium state and mirrors the
  // active skin's UiTheme into :root CSS variables on every change.
  const skins = useSkinSystem();

  // Mirror the user's reduced-motion choice onto <html> so the CSS rule in
  // index.css disables every Tailwind transition + keyframe animation.
  useReducedMotionAttribute(effectiveReducedMotion(settings));

  // Mirror the user's sound preference into the audio engine. The actual
  // AudioContext init still has to wait for a user gesture (Roll button)
  // because of the browser autoplay policy; this just gates whether
  // playClack() does anything when impacts arrive.
  useEffect(() => {
    diceAudio.setEnabled(settings.soundEnabled);
  }, [settings.soundEnabled]);

  // Same gate for haptics. navigator.vibrate() doesn't have an autoplay
  // policy — once the user toggles it on, every impact in the scene can
  // fire a pulse. Desktops without a motor and iOS (no API) silently
  // no-op inside diceHaptics; nothing user-visible happens.
  useEffect(() => {
    diceHaptics.setEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

  const recordRoll = useCallback(
    (result: RollResult) => {
      setHistory((h) => [result, ...h].slice(0, HISTORY_MAX));
    },
    [setHistory],
  );

  const handleRoll = () => {
    // Init audio inside the user-gesture handler — required by the
    // browser autoplay policy. Safe no-op after the first call.
    diceAudio.ensureInit();
    const usePhysics =
      isPhysicsDie(diceType) && !effectiveReducedMotion(settings);
    // adv/dis always throw exactly 2 dice; the whoosh + scene match that.
    const effectiveQty = rollMode === 'normal' ? quantity : 2;
    if (usePhysics) {
      diceAudio.playWhoosh(Math.min(1, 0.4 + effectiveQty * 0.12));
      throwDice(diceType, quantity, rollMode);
    } else {
      const result = roll(diceType, quantity, profBonus, rollMode);
      recordRoll(result);
    }
  };

  // The scene reports the raw face values it read; we add the user's
  // proficiency bonus on top here so it lands in the same RollResult.
  // The token guard inside commitPhysicsResult drops stale results (e.g.
  // user hit Clear, or fired a fresh throw before the previous resolved).
  const profBonusRef = useRef(profBonus);
  profBonusRef.current = profBonus;
  // rollMode mirrored into a ref so the async commit reflects whatever the
  // toggle was set to at *throw* time, not at settle time. Switching the
  // pill mid-flight doesn't retroactively change which die was kept.
  const rollModeRef = useRef(rollMode);
  rollModeRef.current = rollMode;
  const handlePhysicsResult = useCallback(
    (dt: DiceType, qty: number, values: number[], token: number) => {
      const result = commitPhysicsResult(
        dt,
        qty,
        values,
        profBonusRef.current,
        token,
        rollModeRef.current,
      );
      if (result) recordRoll(result);
    },
    [commitPhysicsResult, recordRoll],
  );

  const handleSavePreset = (name: string, setup: RollSetup) => {
    const preset: Preset = { id: makeId(), name, ...setup };
    setPresets((p) => [preset, ...p]);
  };

  const handleLoadPreset = (preset: Preset) => {
    // Same gesture-bound init as handleRoll — loading a preset throws.
    diceAudio.ensureInit();
    const presetMode: RollMode = preset.rollMode ?? 'normal';
    setDiceType(preset.diceType);
    setQuantity(preset.quantity);
    setProfBonus(preset.modifier);
    setRollMode(presetMode);
    setOpenSheet(null);
    const usePhysics =
      isPhysicsDie(preset.diceType) && !effectiveReducedMotion(settings);
    const effectiveQty = presetMode === 'normal' ? preset.quantity : 2;
    if (usePhysics) {
      diceAudio.playWhoosh(Math.min(1, 0.4 + effectiveQty * 0.12));
      throwDice(preset.diceType, preset.quantity, presetMode);
    } else {
      const result = roll(
        preset.diceType,
        preset.quantity,
        preset.modifier,
        presetMode,
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
    modifier: profBonus,
    rollMode,
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg">
      {/* Full-screen 3D tavern scene */}
      <Suspense fallback={<div aria-hidden className="absolute inset-0 bg-bg" />}>
        <DiceTray
          result={lastRoll}
          isRolling={isRolling}
          throwRequest={throwRequest}
          onResult={handlePhysicsResult}
          sceneTheme={skins.activeSkin.sceneTheme}
        />
      </Suspense>

      {/* Vignette over the scene for cinematic edges. B1: edge weight
          reduced from rgba(0,0,0,0.55) to var(--vignette-edge) (0.35) so
          the tavern walls breathe — still framed, not boxed-in. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 48%, var(--vignette-edge) 100%)',
        }}
      />

      {/* Top bar — B1: title tracking eased from 0.4em to 0.32em, glow
          dialed back from 40% → 25%; the gradient scrim fades sooner so
          the underlying tavern wall is visible behind the title. */}
      <header
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-5"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 0.75rem)',
          paddingBottom: '0.5rem',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
        }}
      >
        <CircleButton label="Recent rolls" onClick={() => setOpenSheet('history')}>
          <HamburgerIcon />
        </CircleButton>
        <h1
          className="font-display text-xl text-gold uppercase tracking-[0.32em]"
          style={{
            textShadow:
              '0 0 12px color-mix(in srgb, var(--color-gold) 25%, transparent)',
          }}
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
          <DiceSelector
            selected={diceType}
            onSelect={(dt) => {
              setDiceType(dt);
              // Reset quantity on every die-type change. Carrying 6× from a
              // D6 throw into a D20 selection means "I want to roll 6 D20s"
              // — usually not what the user meant. A fresh single die per
              // selection is the safer default; the user re-bumps the
              // stepper if they actually want a pool. Presets carry their
              // own quantity, so this only fires for manual selector taps.
              if (dt !== diceType) setQuantity(DEFAULT_QUANTITY);
            }}
          />
          <div className="flex items-center justify-center flex-wrap gap-2">
            <QuantityPill
              diceType={diceType}
              quantity={quantity}
              onChange={setQuantity}
              rollMode={rollMode}
            />
            <ProfBonusPill
              value={profBonus}
              min={PROF_BONUS_MIN}
              max={PROF_BONUS_MAX}
              onChange={setProfBonus}
            />
            <AdvantagePill value={rollMode} onChange={setRollMode} />
          </div>
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
        activeSkinName={skins.activeSkin.name}
        onOpenSkins={() => setOpenSheet('skins')}
      />

      <SkinSelector
        open={openSheet === 'skins'}
        onClose={() => setOpenSheet('settings')}
        skins={skins.allSkins}
        activeSkinId={skins.activeSkinId}
        isUnlocked={skins.isUnlocked}
        onEquip={(id) => {
          skins.equipSkin(id);
        }}
        onDevUnlock={(id) => {
          skins.unlockSkin(id);
        }}
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
  /** When adv/dis is on, quantity is forced to 2 and the steppers grey out. */
  rollMode: RollMode;
}

const QUANTITY_MIN = 1;
const QUANTITY_MAX = 20;

function QuantityPill({
  diceType,
  quantity,
  onChange,
  rollMode,
}: QuantityPillProps) {
  // adv/dis forces qty=2 regardless of stepper value — we show that here so
  // the displayed math matches the throw the user is about to fire.
  const locked = rollMode !== 'normal';
  const displayQty = locked ? 2 : quantity;
  const dec = () => onChange(Math.max(QUANTITY_MIN, quantity - 1));
  const inc = () => onChange(Math.min(QUANTITY_MAX, quantity + 1));
  return (
    <div
      className="self-center flex items-center gap-2 px-3 py-1.5 rounded-full transition-opacity duration-150"
      role="group"
      aria-label={
        locked
          ? `Quantity locked at 2 for ${rollMode}`
          : `Quantity, ${quantity} ${diceType.toUpperCase()}`
      }
      style={{
        background: PILL_SURFACE_GRADIENT,
        border:
          '1px solid color-mix(in srgb, var(--color-gold) 35%, transparent)',
        opacity: locked ? 0.55 : 1,
      }}
    >
      <PillStepper
        label="Decrease quantity"
        symbol="−"
        onClick={dec}
        disabled={locked || quantity <= QUANTITY_MIN}
      />
      <span
        className="text-2xs uppercase tracking-[0.22em] text-gold/75 tabular-nums"
        aria-live="polite"
      >
        {displayQty} × {diceType.toUpperCase()}
      </span>
      <PillStepper
        label="Increase quantity"
        symbol="+"
        onClick={inc}
        disabled={locked || quantity >= QUANTITY_MAX}
      />
    </div>
  );
}

interface AdvantagePillProps {
  value: RollMode;
  onChange: (m: RollMode) => void;
}

/**
 * Single-tap cycle: Normal → Advantage → Disadvantage → Normal.
 * Cycling rather than a 3-button segmented control because the pill row
 * is already crowded on narrow screens and most D&D rolls only need to
 * flick between Normal and Advantage anyway. The danger-coloured
 * Disadvantage state is the third tap so it's never reached by accident.
 */
function AdvantagePill({ value, onChange }: AdvantagePillProps) {
  const cycle = () => {
    const next: RollMode =
      value === 'normal'
        ? 'advantage'
        : value === 'advantage'
          ? 'disadvantage'
          : 'normal';
    onChange(next);
  };
  const isAdv = value === 'advantage';
  const isDis = value === 'disadvantage';
  const isActive = isAdv || isDis;
  const accent = isDis ? 'var(--color-danger)' : 'var(--color-gold)';
  const ariaLabel = isAdv
    ? 'Roll mode: advantage. Tap to switch to disadvantage.'
    : isDis
      ? 'Roll mode: disadvantage. Tap to return to normal.'
      : 'Roll mode: normal. Tap to enable advantage.';
  const label = isAdv ? 'Adv ↑' : isDis ? 'Dis ↓' : 'Normal';
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={ariaLabel}
      aria-live="polite"
      className="relative px-3.5 py-1.5 rounded-full transition-all duration-150 active:scale-95 before:absolute before:-inset-2 before:content-['']"
      style={{
        background: PILL_SURFACE_GRADIENT,
        border: `1px solid color-mix(in srgb, ${accent} ${
          isActive ? 70 : 28
        }%, transparent)`,
        boxShadow: isActive
          ? `0 0 8px color-mix(in srgb, ${accent} 18%, transparent)`
          : undefined,
      }}
    >
      <span
        className="text-2xs uppercase tracking-[0.22em] tabular-nums"
        style={{
          color: isActive
            ? accent
            : 'color-mix(in srgb, var(--color-gold) 65%, transparent)',
        }}
      >
        {label}
      </span>
    </button>
  );
}

interface ProfBonusPillProps {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}

function ProfBonusPill({ value, min, max, onChange }: ProfBonusPillProps) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  const display = value >= 0 ? `+${value}` : `${value}`;
  const active = value > 0;
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors"
      role="group"
      aria-label={`Proficiency bonus ${display}`}
      style={{
        background: PILL_SURFACE_GRADIENT,
        border: `1px solid color-mix(in srgb, var(--color-gold) ${
          active ? 65 : 28
        }%, transparent)`,
        boxShadow: active
          ? '0 0 8px color-mix(in srgb, var(--color-gold) 14%, transparent)'
          : undefined,
      }}
    >
      <PillStepper
        label="Decrease proficiency bonus"
        symbol="−"
        onClick={dec}
        disabled={value <= min}
      />
      <span
        className="text-2xs uppercase tracking-[0.22em] text-gold/85 tabular-nums"
        title="Proficiency bonus added to every roll"
        aria-live="polite"
      >
        Prof {display}
      </span>
      <PillStepper
        label="Increase proficiency bonus"
        symbol="+"
        onClick={inc}
        disabled={value >= max}
      />
    </div>
  );
}

/** Shared surface gradient for the bottom-stack pills. Drawn from
 *  `--color-tray-deep` at two alpha levels so it re-tints with the skin. */
const PILL_SURFACE_GRADIENT =
  'linear-gradient(180deg, color-mix(in srgb, var(--color-tray-deep) 78%, transparent) 0%, color-mix(in srgb, var(--color-tray-deep) 88%, transparent) 100%)';

interface PillStepperProps {
  label: string;
  symbol: '+' | '−';
  onClick: () => void;
  disabled: boolean;
}

/** 44×44 hit target with a small visible cap. Meets iOS HIG / WCAG 2.5.5
 *  Target Size without making the visible pill look bloated. */
function PillStepper({ label, symbol, onClick, disabled }: PillStepperProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className="relative w-6 h-6 rounded-full text-gold/80 hover:text-gold text-base leading-none flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed before:absolute before:-inset-2.5 before:content-['']"
    >
      {symbol}
    </button>
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
      className="relative w-full rounded-2xl py-3 transition-all duration-100 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        // Three-stop gold gradient derived from --color-gold so a cool-palette
        // skin (Obsidian Court) gets a sapphire-leaning button automatically.
        //
        // B1 refinement: highlight pulled from 30% white → 18% so the cap
        // reads as warm brass rather than shiny chrome; bottom darkened
        // less aggressively (35% → 28%); outer shadow halved
        // (0 8px 24px /0.55 → 0 4px 14px /0.4) — same energy, less weight.
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-gold) 82%, white 18%) 0%, var(--color-gold) 45%, color-mix(in srgb, var(--color-gold) 72%, black 28%) 100%)',
        border: '1px solid rgba(0,0,0,0.45)',
        boxShadow:
          '0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 color-mix(in srgb, var(--color-gold) 30%, white 70%), inset 0 -1px 2px rgba(0,0,0,0.32)',
      }}
    >
      <span
        className="block font-display text-2xl uppercase tracking-[0.4em] leading-none"
        style={{
          color: 'var(--color-tray-deep)',
          textShadow:
            '0 1px 0 color-mix(in srgb, var(--color-gold) 30%, white 60%)',
        }}
      >
        {rolling ? 'Rolling' : 'Roll'}
      </span>
      <span
        className="block text-2xs uppercase tracking-[0.32em] mt-1"
        style={{
          color: 'color-mix(in srgb, var(--color-tray-deep) 60%, transparent)',
        }}
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
    <div className="flex items-center justify-between pt-2">
      <NavItem icon={<ClockIcon />} label="History" onClick={onHistory} />
      {hasResult ? (
        <button
          type="button"
          onClick={onClear}
          className="text-2xs uppercase tracking-[0.28em] text-secondary/70 hover:text-gold transition-colors"
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
      className="flex flex-col items-center gap-1 text-secondary/85 hover:text-gold transition-colors"
    >
      <span
        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        style={{
          border:
            '1px solid color-mix(in srgb, var(--color-gold) 28%, transparent)',
          background:
            'color-mix(in srgb, var(--color-tray-deep) 35%, transparent)',
        }}
      >
        {icon}
      </span>
      <span className="text-2xs uppercase tracking-[0.28em]">{label}</span>
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
      className="relative w-11 h-11 rounded-full flex items-center justify-center text-gold/85 hover:text-gold transition-colors"
      style={{
        background:
          'color-mix(in srgb, var(--color-tray-deep) 50%, transparent)',
        border:
          '1px solid color-mix(in srgb, var(--color-gold) 32%, transparent)',
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
