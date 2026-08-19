import { describe, it, expect } from 'vitest';
import { computeChainBonuses, roundBonus } from './bonuses';
import { getSharePriceAtSize } from './startups';

const h = (playerId: string, shares: number) => ({ playerId, playerName: playerId.toUpperCase(), shares });

describe('computeChainBonuses', () => {
  it('pays a clear majority and a clear minority', () => {
    const out = computeChainBonuses('Gobble', 1000, [h('p1', 6), h('p2', 3), h('p3', 1)]);
    expect(out).toEqual([
      { playerId: 'p1', playerName: 'P1', startupId: 'Gobble', shares: 6, amount: 10000, type: 'majority' },
      { playerId: 'p2', playerName: 'P2', startupId: 'Gobble', shares: 3, amount: 5000, type: 'minority' },
    ]);
  });

  // BUG #1 — currently each tied holder gets the FULL minority bonus
  it('splits a tied minority bonus between the tied holders', () => {
    const out = computeChainBonuses('Messla', 600, [h('p2', 7), h('p1', 4), h('p3', 4)]);
    expect(out).toEqual([
      { playerId: 'p2', playerName: 'P2', startupId: 'Messla', shares: 7, amount: 6000, type: 'majority' },
      { playerId: 'p1', playerName: 'P1', startupId: 'Messla', shares: 4, amount: 1500, type: 'minority' },
      { playerId: 'p3', playerName: 'P3', startupId: 'Messla', shares: 4, amount: 1500, type: 'minority' },
    ]);
  });

  // BUG #2 — currently a sole holder gets the majority bonus only
  //
  // Carry-in from Task 6/7: G5 (engine/golden/mergers.ts) can only pin the
  // *cash total* a sole holder receives — the merged chain is unfounded in
  // the same intent that computes this bonus, and finalScore() only ever
  // reports founded chains, so no golden-game assertion can ever see the
  // *shape* of the payout. A two-entry implementation summing to the same
  // total would satisfy G5 identically. This test is the only place that
  // shape is pinned: it asserts the sole holder gets exactly ONE entry of
  // type 'both', not two entries (one 'majority', one 'minority') that
  // merely sum to the same number.
  it('gives a sole holder exactly ONE entry of type "both" — not two entries that merely sum to the same total', () => {
    // ZuckFace is tier 1; price is derived from the engine's own pricing
    // function, never quoted, so this test tracks getSharePriceAtSize if
    // its bands or tier premium ever change.
    const price = getSharePriceAtSize(1, 3);
    const out = computeChainBonuses('ZuckFace', price, [h('p3', 3)]);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('both');
    expect(out).toEqual([
      {
        playerId: 'p3', playerName: 'P3', startupId: 'ZuckFace', shares: 3,
        // majorityPot (price * 10) + minorityPot (price * 5), paid as one
        // combined figure — see computeChainBonuses's own sole-holder branch.
        amount: price * 10 + price * 5,
        type: 'both',
      },
    ]);
  });

  it('splits a tied majority across majority + minority, rounded up to $100', () => {
    // (300×10 + 300×5) / 2 = 2250 → 2300 each
    const out = computeChainBonuses('CamCrooned', 300, [h('p1', 5), h('p2', 5)]);
    expect(out.map((b) => [b.playerId, b.amount, b.type])).toEqual([
      ['p1', 2300, 'majority'],
      ['p2', 2300, 'majority'],
    ]);
  });

  it('pays nobody for a chain with no shareholders', () => {
    expect(computeChainBonuses('Scrapple', 500, [])).toEqual([]);
    expect(computeChainBonuses('Scrapple', 500, [h('p1', 0)])).toEqual([]);
  });

  it('rounds up to the nearest hundred', () => {
    expect(roundBonus(2250)).toBe(2300);
    expect(roundBonus(1500)).toBe(1500);
    expect(roundBonus(1)).toBe(100);
  });
});
