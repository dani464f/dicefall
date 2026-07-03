import { describe, it, expect } from 'vitest';
import { applyRollMode, formatDiceFormula, rollDice, rollOne } from '../dice';
import { getFaceEntries, getUpwardFaceValue } from '../faceDetection';
import { ALL_DICE, DICE_FACES, type DiceType } from '../../types/dice';

/**
 * Pure-logic smoke tests — the parts of the dice pipeline that run
 * headless (no WebGL, no DOM beyond nothing): RNG fairness bounds, roll
 * modes, formula formatting, and the face-detection tables that the
 * physics read depends on. The visual pipeline is covered separately by
 * the __dfDebug frame-capture harness.
 */

describe('rollOne / rollDice bounds', () => {
  it('rollOne stays within [1, faces]', () => {
    for (let i = 0; i < 500; i++) {
      const v = rollOne(20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rollDice individual results respect each die type', () => {
    for (const type of ALL_DICE) {
      const r = rollDice(type, 8, 0);
      expect(r.individualResults).toHaveLength(8);
      for (const v of r.individualResults) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(DICE_FACES[type]);
      }
      expect(r.total).toBe(r.individualResults.reduce((a, b) => a + b, 0));
    }
  });

  it('modifier lands in the total, not the individuals', () => {
    const r = rollDice('d6', 2, 5);
    const subtotal = r.individualResults.reduce((a, b) => a + b, 0);
    expect(r.total).toBe(subtotal + 5);
  });
});

describe('roll modes', () => {
  it('advantage forces 2 dice and keeps the higher', () => {
    for (let i = 0; i < 50; i++) {
      const r = rollDice('d20', 6, 3, 'advantage');
      expect(r.individualResults).toHaveLength(2);
      expect(r.total).toBe(Math.max(...r.individualResults) + 3);
      expect(r.rollMode).toBe('advantage');
    }
  });

  it('disadvantage forces 2 dice and keeps the lower', () => {
    for (let i = 0; i < 50; i++) {
      const r = rollDice('d20', 1, 0, 'disadvantage');
      expect(r.individualResults).toHaveLength(2);
      expect(r.total).toBe(Math.min(...r.individualResults));
    }
  });

  it('applyRollMode: sum / max / min / empty', () => {
    expect(applyRollMode([3, 5, 2], 'normal')).toBe(10);
    expect(applyRollMode([3, 5, 2], 'advantage')).toBe(5);
    expect(applyRollMode([3, 5, 2], 'disadvantage')).toBe(2);
    expect(applyRollMode([], 'normal')).toBe(0);
  });
});

describe('formatDiceFormula', () => {
  it('formats base, positive and negative modifiers', () => {
    expect(formatDiceFormula({ diceType: 'd20', quantity: 2, modifier: 0 })).toBe(
      '2d20',
    );
    expect(formatDiceFormula({ diceType: 'd20', quantity: 2, modifier: 3 })).toBe(
      '2d20 + 3',
    );
    // U+2212 minus, matching the UI's tabular numerals.
    expect(formatDiceFormula({ diceType: 'd6', quantity: 1, modifier: -2 })).toBe(
      '1d6 − 2',
    );
  });

  it('appends advantage / disadvantage suffixes', () => {
    expect(
      formatDiceFormula({
        diceType: 'd20',
        quantity: 2,
        modifier: 0,
        rollMode: 'advantage',
      }),
    ).toBe('2d20 · adv ↑');
    expect(
      formatDiceFormula({
        diceType: 'd20',
        quantity: 2,
        modifier: 1,
        rollMode: 'disadvantage',
      }),
    ).toBe('2d20 + 1 · dis ↓');
  });
});

describe('face-detection tables (physics read correctness)', () => {
  const uniqueValues = (type: DiceType) => {
    const entries = getFaceEntries(type);
    expect(entries).not.toBeNull();
    return entries!.map((e) => e.value);
  };

  it('every die type exposes a full, unique value table', () => {
    for (const type of ALL_DICE) {
      const values = uniqueValues(type);
      const faces = DICE_FACES[type];
      expect(values).toHaveLength(faces === 100 ? 10 : faces);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('d10 values are 1..10 with antipodal faces summing to 11', () => {
    const entries = getFaceEntries('d10')!;
    const values = entries.map((e) => e.value).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const e of entries) {
      const opposite = entries.find(
        (o) => o !== e && e.localNormal.dot(o.localNormal) < -0.9,
      );
      expect(opposite).toBeDefined();
      expect(e.value + opposite!.value).toBe(11);
    }
  });

  it('d100 mirrors d10 ×10 (10..100)', () => {
    const values = uniqueValues('d100').sort((a, b) => a - b);
    expect(values).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('d20 opposite faces sum to 21', () => {
    const entries = getFaceEntries('d20')!;
    for (const e of entries) {
      const opposite = entries.find(
        (o) => o !== e && e.localNormal.dot(o.localNormal) < -0.9,
      );
      expect(opposite).toBeDefined();
      expect(e.value + opposite!.value).toBe(21);
    }
  });

  it('getUpwardFaceValue reads the d6 +Y face as 1 at identity rotation', () => {
    expect(
      getUpwardFaceValue({ x: 0, y: 0, z: 0, w: 1 }, 'd6'),
    ).toBe(1);
  });

  it('getUpwardFaceValue returns a legal value for random rotations', () => {
    // Not asserting WHICH face — asserting the read never escapes the
    // legal value set, for every die type, across arbitrary rotations.
    for (const type of ALL_DICE) {
      const legal = new Set(uniqueValues(type));
      for (let i = 0; i < 40; i++) {
        // Random unit quaternion.
        const u1 = Math.random();
        const u2 = Math.random() * Math.PI * 2;
        const u3 = Math.random() * Math.PI * 2;
        const a = Math.sqrt(1 - u1);
        const b = Math.sqrt(u1);
        const q = {
          x: a * Math.sin(u2),
          y: a * Math.cos(u2),
          z: b * Math.sin(u3),
          w: b * Math.cos(u3),
        };
        const v = getUpwardFaceValue(q, type);
        if (v !== null) expect(legal.has(v)).toBe(true);
      }
    }
  });
});
