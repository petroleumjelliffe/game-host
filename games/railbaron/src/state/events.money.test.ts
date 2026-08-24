// Shape checks for the phase-2 money events. Like every isGameEvent case,
// these are structural only: *when* a purchase or a declare is legal is a
// question about the order of the log, and legal.ts is where order is read.
import { describe, expect, it } from 'vitest';
import { CITIES, REGIONS } from '../../engine/index.js';
import { isGameEvent } from './events.js';

describe('phase 2 money events', () => {
  it('accepts a well-formed bought and sold, and refuses junk', () => {
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'SLSF', price: 19000 })).toBe(true);
    expect(isGameEvent({ type: 'sold', seat: 'red', railroad: 'SLSF', price: 9500 })).toBe(true);
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'AMTRAK', price: 19000 })).toBe(false);
    expect(isGameEvent({ type: 'bought', seat: 'mauve', railroad: 'SLSF', price: 19000 })).toBe(false);
    expect(isGameEvent({ type: 'bought', seat: 'red', railroad: 'SLSF', price: '19000' })).toBe(false);
    expect(isGameEvent({ type: 'sold', seat: 'red', railroad: 'SLSF', price: -1 })).toBe(false);
  });

  it('accepts declared only when the alternate is a real place', () => {
    // Build the alternate from the engine, never literals: city 0's own region.
    const city = CITIES[0]!;
    const good = { type: 'declared', seat: 'red',
      alternate: { city: city.id, region: city.region, payout: 5000 } };
    expect(isGameEvent(good)).toBe(true);
    expect(isGameEvent({ ...good, alternate: { ...good.alternate, region: 'not-a-region' } })).toBe(false);
    expect(isGameEvent({ ...good, alternate: { ...good.alternate, payout: null } })).toBe(false);
    expect(isGameEvent({ ...good, alternate: null })).toBe(false);
    expect(isGameEvent({ type: 'declared', seat: 'red' })).toBe(false);
  });

  it('region must match the alternate city, engine-checked', () => {
    const city = CITIES[0]!;
    const other = REGIONS.find((region) => region.id !== city.region)!;
    expect(isGameEvent({ type: 'declared', seat: 'red',
      alternate: { city: city.id, region: other.id, payout: 5000 } })).toBe(false);
  });
});
