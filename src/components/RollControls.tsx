import type { DiceType } from '../types/dice';

interface RollControlsProps {
  diceType: DiceType;
  quantity: number;
  modifier: number;
  onQuantityChange: (q: number) => void;
  onModifierChange: (m: number) => void;
  /** When true, the modifier stepper is locked at 0 (used during the physics build). */
  modifierLocked?: boolean;
}

const QUANTITY_MIN = 1;
const QUANTITY_MAX = 20;
const MODIFIER_MIN = -50;
const MODIFIER_MAX = 50;

export function RollControls({
  diceType,
  quantity,
  modifier,
  onQuantityChange,
  onModifierChange,
  modifierLocked = false,
}: RollControlsProps) {
  const clampQty = (n: number) =>
    Math.max(QUANTITY_MIN, Math.min(QUANTITY_MAX, n));
  const clampMod = (n: number) =>
    Math.max(MODIFIER_MIN, Math.min(MODIFIER_MAX, n));

  const effectiveModifier = modifierLocked ? 0 : modifier;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Stepper
        label="Quantity"
        display={String(quantity)}
        onDec={() => onQuantityChange(clampQty(quantity - 1))}
        onInc={() => onQuantityChange(clampQty(quantity + 1))}
      />
      <Stepper
        label="Modifier"
        display={
          effectiveModifier >= 0 ? `+${effectiveModifier}` : `${effectiveModifier}`
        }
        onDec={() => onModifierChange(clampMod(modifier - 1))}
        onInc={() => onModifierChange(clampMod(modifier + 1))}
        disabled={modifierLocked}
        sublabel={modifierLocked ? 'physics build' : undefined}
      />
      <div className="col-span-2 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">
          Formula
        </p>
        <p className="font-display text-2xl text-ivory leading-none">
          {formatFormula(diceType, quantity, effectiveModifier)}
        </p>
      </div>
    </div>
  );
}

interface StepperProps {
  label: string;
  display: string;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
  sublabel?: string;
}

function Stepper({
  label,
  display,
  onDec,
  onInc,
  disabled = false,
  sublabel,
}: StepperProps) {
  return (
    <div
      className={
        'rounded-xl border border-subtle bg-white/[0.02] px-3 py-2 transition-opacity duration-200 ' +
        (disabled ? 'opacity-40' : '')
      }
    >
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] uppercase tracking-[0.2em] text-secondary">
          {label}
        </p>
        {sublabel && (
          <p className="text-[9px] uppercase tracking-[0.15em] text-secondary/60">
            {sublabel}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <StepBtn onClick={onDec} aria-label={`Decrease ${label}`} disabled={disabled}>
          −
        </StepBtn>
        <span className="font-display text-2xl text-ivory tabular-nums leading-none">
          {display}
        </span>
        <StepBtn onClick={onInc} aria-label={`Increase ${label}`} disabled={disabled}>
          +
        </StepBtn>
      </div>
    </div>
  );
}

function StepBtn({
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        'w-9 h-9 rounded-full border border-subtle text-ivory text-xl leading-none flex items-center justify-center transition-all duration-100 ' +
        (disabled
          ? 'cursor-not-allowed'
          : 'hover:border-gold/60 active:scale-90')
      }
      {...rest}
    >
      {children}
    </button>
  );
}

function formatFormula(
  diceType: DiceType,
  quantity: number,
  modifier: number,
): string {
  const base = `${quantity}${diceType}`;
  if (modifier === 0) return base;
  if (modifier > 0) return `${base} + ${modifier}`;
  return `${base} − ${Math.abs(modifier)}`;
}
