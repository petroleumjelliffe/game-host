import { describe, expect, it } from 'vitest';
import { bonusLegOwed, d6, earnsBonus, movement, rollTurn, type TurnRoll } from './dice';

/** Feeds exact die faces, one per call. `face` is 1-6. */
const dice = (...faces: number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) throw new Error('the scripted dice ran out');
    return (face - 1) / 6;
  };
};

describe('one die', () => {
  it('reads the scripted face', () => {
    const rng = dice(1, 6, 3);
    expect([d6(rng), d6(rng), d6(rng)]).toEqual([1, 6, 3]);
  });
});

describe('who earns a Bonus Roll', () => {
  it('gives a Freight one only on double six', () => {
    expect(earnsBonus('freight', [6, 6])).toBe(true);
    expect(earnsBonus('freight', [5, 5])).toBe(false);
    expect(earnsBonus('freight', [6, 5])).toBe(false);
  });

  it('gives an Express one on any double', () => {
    expect(earnsBonus('express', [2, 2])).toBe(true);
    expect(earnsBonus('express', [6, 6])).toBe(true);
    expect(earnsBonus('express', [2, 3])).toBe(false);
  });

  it('gives a Superchief one every turn', () => {
    expect(earnsBonus('superchief', [1, 2])).toBe(true);
    expect(earnsBonus('superchief', [6, 6])).toBe(true);
  });
});

/**
 * These were rewritten when the Bonus Roll moved to after the white movement.
 * They previously asserted that `rollTurn` hands back a bonus face up front —
 * that is not a weakened assertion now, it is a *different rule*: the die is
 * not thrown until the pawn has walked the whites, so there is no face to hand
 * back and no third draw to make. Entitlement is all that is fixed here, and
 * `earnsBonus` above is where it is fixed.
 */
describe('rolling a turn', () => {
  it('rolls two white dice and never a bonus, whatever they show', () => {
    expect(rollTurn('freight', dice(3, 4))).toEqual({ white: [3, 4], bonus: null });
    expect(rollTurn('freight', dice(6, 6))).toEqual({ white: [6, 6], bonus: null });
    expect(rollTurn('superchief', dice(1, 2))).toEqual({ white: [1, 2], bonus: null });
  });

  it('takes exactly two draws, even on a turn that earns the die', () => {
    // The scripted rng throws once the queue is empty, so a third draw is a
    // failure rather than a face — and a double six on a Freight is precisely
    // the turn that used to take one.
    expect(() => rollTurn('freight', dice(6, 6))).not.toThrow();
    expect(() => rollTurn('superchief', dice(1, 2))).not.toThrow();
    // The other direction: a leftover face is never reached for.
    const rng = dice(6, 6, 5);
    expect(rollTurn('freight', rng).bonus).toBeNull();
    // ...and it is still there, unread, for the Bonus Roll that follows later.
    expect(d6(rng)).toBe(5);
  });

  it('leaves entitlement to be read off the white pair', () => {
    const rolled = rollTurn('freight', dice(6, 6));
    expect(rolled.bonus, 'the face is not known yet').toBeNull();
    expect(earnsBonus('freight', rolled.white), 'but the entitlement is').toBe(true);
  });

  it('adds the bonus into the movement it grants', () => {
    expect(movement({ white: [3, 4], bonus: null })).toBe(7);
    expect(movement({ white: [6, 6], bonus: 5 })).toBe(17);
  });
});

/**
 * The legacy pre-rolled form, and nothing else — see `bonusLegOwed`'s comment.
 * A live turn earns its second leg from `earnsBonus` now, whether or not the
 * white leg arrived; these cases survive because logs written before the
 * staging changed still replay through here.
 */
describe('whether a bonus leg is still owed', () => {
  const withBonus: TurnRoll = { white: [4, 4], bonus: 3 };
  const without: TurnRoll = { white: [4, 4], bonus: null };

  it('is owed when the pawn arrived inside the white dice', () => {
    expect(bonusLegOwed(withBonus, 6, true)).toBe(true);
    expect(bonusLegOwed(withBonus, 8, true)).toBe(true);
  });

  it('is not owed when the pawn never arrived', () => {
    expect(bonusLegOwed(withBonus, 11, false)).toBe(false);
  });

  it('is not owed when the arrival came out of the bonus movement itself', () => {
    expect(bonusLegOwed(withBonus, 9, true)).toBe(false);
  });

  it('is not owed when no bonus was earned', () => {
    expect(bonusLegOwed(without, 4, true)).toBe(false);
  });
});
