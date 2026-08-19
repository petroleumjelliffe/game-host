import { describe, it, expect } from 'vitest';
import { AVAILABLE_STARTUPS, getSharePriceAtSize, getNextSharePrice, SAFE_SIZE, END_SIZE } from './startups';
import { setupGameWithStartups } from './testHelpers';

describe('startups', () => {
  it('carries the seven brands with their tickers', () => {
    expect(AVAILABLE_STARTUPS.map((s) => [s.id, s.tier, s.ticker])).toEqual([
      ['Gobble', 2, '$G'],
      ['Scrapple', 2, '$S'],
      ['PaperfulPost', 0, '$PP'],
      ['CamCrooned', 1, '$C'],
      ['Messla', 0, '$M'],
      ['ZuckFace', 1, '$Z'],
      ['WrecksonMobil', 1, '$W'],
    ]);
  });

  it('prices by size threshold and tier', () => {
    expect(getSharePriceAtSize(0, 0)).toBe(0);
    expect(getSharePriceAtSize(0, 2)).toBe(200);
    expect(getSharePriceAtSize(0, 6)).toBe(600);
    expect(getSharePriceAtSize(1, 2)).toBe(300);
    expect(getSharePriceAtSize(2, 2)).toBe(400);
    expect(getSharePriceAtSize(0, 41)).toBe(1000);
    expect(getSharePriceAtSize(0, 60)).toBe(1000);
  });

  it('gives the price one tile from now, and null once the top band is reached', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 5, tier: 0 }]);
    expect(getNextSharePrice(state, 'Messla')).toBe(600);   // 5 → 6 crosses a threshold
    const big = setupGameWithStartups([{ id: 'Messla', tiles: 41, tier: 0 }]);
    expect(getNextSharePrice(big, 'Messla')).toBeNull();
  });

  it('exports the shared size constants', () => {
    expect(SAFE_SIZE).toBe(11);
    expect(END_SIZE).toBe(41);
  });
});
