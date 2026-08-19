import { describe, expect, it } from 'vitest';
import { destinationInRegion, rollDestination } from './roll';
import { CITIES, cityById } from './cities';
import type { CityId, Rng } from './types';

const scripted = (...values: number[]): Rng => {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('rng called more times than scripted');
    return values[i++]!;
  };
};
const idOf = (name: string) => CITIES.find(c => c.name === name)!.id;

describe('rolling a destination', () => {
  it('gives a baron with no history a home city and no payout', () => {
    const outcome = rollDestination(null, scripted(0, 0, 0, 0, 0, 0));
    expect(outcome.kind).toBe('home');
    if (outcome.kind !== 'home') throw new Error('unreachable');
    expect(cityById(outcome.city).region).toBe(outcome.region);
  });

  it('asks the player to choose when the roll repeats their own region', () => {
    // Row 8 has CODES[8][0] = 5, which is REGIONS[5] = NW. Use rollRow values
    // that produce row 8: floor(0.55*6) + floor(0.9*6) + floor(0.1*2)*11 = 3+5+0 = 8.
    const seattle = idOf('Seattle');
    const rolled = rollDestination(seattle, scripted(0.55, 0.9, 0.1));
    expect(rolled.kind).toBe('chooseRegion');
    if (rolled.kind !== 'chooseRegion') throw new Error('unreachable');
    expect(rolled.rolled).toBe(cityById(seattle).region);
    expect(rolled.rolled).toBe('NW');
  });

  it('pays for a journey to a different region', () => {
    let found = false;
    for (let seed = 0; seed < 200 && !found; seed++) {
      const outcome = rollDestination(0, () => (seed * 7919 % 1000) / 1000);
      if (outcome.kind !== 'arrived') continue;
      found = true;
      expect(outcome.payout).toBeGreaterThan(0);
      expect(Number.isInteger(outcome.payout)).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('reports a zero payout as zero rather than as nothing', () => {
    // Minneapolis to St. Paul is legal and pays $0. `payout` must be the
    // number 0, never null or undefined, or the board will show a blank.
    // Row 1 has CODES[1][5] = 8, which picks the 8th city in PL (St. Paul).
    // rollRow = 1: floor(0.2*6) + floor(0.1*6) + floor(0.1*2)*11 = 1+0+0 = 1.
    const result = destinationInRegion(idOf('Minneapolis'), 'PL', scripted(0.2, 0.1, 0.1));
    expect(result.city).toBe(idOf('St. Paul'));
    expect(result.payout).toBe(0);
  });

  it('never sends a baron to the city they are already in', () => {
    // destinationInRegion is the only path that draws from the player's current region.
    // Test it by calling destinationInRegion(from, from's own region, rng).
    const from = idOf('Chicago');
    const chicagoRegion = cityById(from).region;
    for (let i = 0; i < 500; i++) {
      const outcome = destinationInRegion(from, chicagoRegion, () => Math.random());
      expect(outcome.city).not.toBe(from);
    }
  });
});

describe('choosing a region after a repeat roll', () => {
  it('picks a city in the chosen region and prices the journey', () => {
    const from = idOf('Boston');
    const result = destinationInRegion(from, 'SW', scripted(0, 0, 0));
    expect(cityById(result.city).region).toBe('SW');
    expect(result.region).toBe('SW');
    expect(result.payout).toBeGreaterThan(0);
  });
});

describe('rolling a home city', () => {
  it('never lands on a home city another baron already holds', () => {
    const taken = new Set<CityId>();
    for (let baron = 0; baron < 6; baron++) {
      const outcome = rollDestination(null, Math.random, taken);
      expect(outcome.kind).toBe('home');
      const city = (outcome as { city: CityId }).city;
      expect(taken.has(city)).toBe(false);
      taken.add(city);
    }
    expect(taken.size).toBe(6);
  });

  it('takes the first roll when nothing is taken', () => {
    expect(rollDestination(null, () => 0, new Set())).toEqual(rollDestination(null, () => 0));
  });

  it('gives up rather than spinning for ever when every city is taken', () => {
    const everywhere = new Set(CITIES.map(city => city.id));
    expect(() => rollDestination(null, Math.random, everywhere)).toThrow(/home city/);
  });
});
