import { describe, it, expect } from 'vitest';
import { goldenState } from './fixtures';
import { getSharePriceAtSize } from '../../../engine/startups';

describe('catalog fixtures', () => {
  it('resolves a state by game id and step index', () => {
    const s = goldenState('G9', 1);
    expect(s.stage).toBe('buy');
  });

  it('throws on an unknown game rather than returning undefined', () => {
    expect(() => goldenState('G99', 0)).toThrow(/G99/);
  });

  it('throws on an out-of-range step index', () => {
    expect(() => goldenState('G9', 99)).toThrow(/step/);
  });

  // The error states.html shipped: Gobble at 41 tiles is $1200, not $1000.
  it('carries engine-derived prices, not authored ones', () => {
    const s = goldenState('G9', 1);
    const gobble = s.startups.Gobble!;
    expect(getSharePriceAtSize(gobble.tier, 41)).toBe(1200);
  });
});
