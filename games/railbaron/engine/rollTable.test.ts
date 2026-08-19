import { describe, expect, it } from 'vitest';
import { CODES, rollCityIn, rollRegion, rollRow } from './rollTable';
import { REGIONS } from './regions';
import { citiesIn } from './cities';
import type { Rng } from './types';

// Locked-in digest of every value in CODES, in row-major order, extracted
// mechanically from js/railbaronv2.js:163-184 and checked element-by-element
// against the source on 2026-08-11 — see task-4-report.md. The other tests
// in this file check range and coverage, which a mis-copied cell can still
// satisfy (e.g. a digit swapped for another value that's already valid for
// that column); this test pins the exact table so any single-cell change
// turns it red. Same FNV-1a-over-decimal-text approach as
// engine/payouts.test.ts's PAYOUT_TABLE_DIGEST, kept platform-free.
const CODES_DIGEST = '5ae80ad8';

const digestOf = (table: readonly (readonly number[])[]): string => {
  let hash = 0x811c9dc5;
  for (const row of table) {
    for (const value of row) {
      const text = `${value},`;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/** Feeds scripted values to the dice, then throws rather than looping. */
const scripted = (...values: number[]): Rng => {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('rng called more times than scripted');
    return values[i++]!;
  };
};

describe('the roll table', () => {
  it('is 22 rows of 8', () => {
    expect(CODES).toHaveLength(22);
    CODES.forEach(row => expect(row).toHaveLength(8));
  });

  it('only ever names a region that exists', () => {
    for (const row of CODES) expect(row[0]).toBeLessThan(REGIONS.length);
  });

  it('only ever names a city that exists in the region of its column', () => {
    // This is what catches a mis-copied row: column c must index into the
    // c-th region's city list, and those lists are different lengths.
    REGIONS.forEach((region, position) => {
      const size = citiesIn(region.id).length;
      for (const row of CODES) {
        expect(row[position + 1]).toBeLessThan(size);
      }
    });
  });

  it('pins every value in the table, so a single corrupted cell fails', () => {
    // The tests above sample shape, range, and coverage — none of them can
    // detect a cell whose corrupted value still lands in range and doesn't
    // shrink a column's coverage set. This test covers all 176 values by
    // digest, so any single-cell change turns it red.
    expect(digestOf(CODES)).toBe(CODES_DIGEST);
  });
});

describe('rolling', () => {
  it('reads one d6, one d6, and a d2 that shifts by eleven', () => {
    expect(rollRow(scripted(0, 0, 0))).toBe(0);
    expect(rollRow(scripted(0.99, 0.99, 0))).toBe(10);
    expect(rollRow(scripted(0, 0, 0.99))).toBe(11);
    expect(rollRow(scripted(0.99, 0.99, 0.99))).toBe(21);
  });

  it('never lands outside the table', () => {
    const rng: Rng = () => Math.random();
    for (let i = 0; i < 5000; i++) {
      const row = rollRow(rng);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(CODES.length);
    }
  });

  it('turns a row into the region that row names', () => {
    const expected = REGIONS[CODES[0]![0]!]!.id;
    expect(rollRegion(scripted(0, 0, 0))).toBe(expected);
  });

  it('picks a city from within the region it was asked for', () => {
    for (const region of REGIONS) {
      const ids = citiesIn(region.id).map(c => c.id);
      expect(ids).toContain(rollCityIn(region.id, scripted(0, 0, 0)));
    }
  });

  it('can reach every city in a region across the whole table', () => {
    // A column that never yields some city would make that city unreachable.
    for (const region of REGIONS) {
      const reachable = new Set(CODES.map(row => row[region.column]));
      expect(reachable.size).toBe(citiesIn(region.id).length);
    }
  });
});
