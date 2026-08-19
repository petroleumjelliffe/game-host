import { describe, expect, it } from 'vitest';
import { PAYOUT_TABLE, payoutBetween } from './payouts';
import { CITIES } from './cities';

// Locked-in digest of every value in PAYOUT_TABLE, in row-major order. Two
// independent element-by-element comparisons against js/railbaronv2.js
// (the 2013 source, which a later task deletes) confirmed this data is
// correct on 2026-08-11 — see task-3-report.md. This constant freezes that
// verified state so any future edit to a single cell, anywhere in the
// table, is caught even though js/railbaronv2.js will no longer exist to
// re-check against.
//
// Plain FNV-1a over the decimal text of each value (comma-terminated, so
// e.g. "1,2" and "12," hash differently). No Node/DOM APIs — engine/ code
// and its tests stay platform-free.
const PAYOUT_TABLE_DIGEST = '11d42253';

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

const idOf = (name: string) => {
  const city = CITIES.find(c => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

describe('the payout table', () => {
  it('is triangular — row n holds n entries, so every pair is covered', () => {
    expect(PAYOUT_TABLE).toHaveLength(67);
    PAYOUT_TABLE.forEach((row, n) => expect(row).toHaveLength(n));
  });

  it('answers the same whichever way round the journey is asked', () => {
    for (const a of [0, 17, 33, 52, 66]) {
      for (const b of [4, 21, 40, 59, 66]) {
        if (a === b) continue;
        expect(payoutBetween(a, b)).toBe(payoutBetween(b, a));
      }
    }
  });

  it('pays nothing between the two twin pairs, and only those', () => {
    // These are the board's only zero-paying journeys. They are legal
    // destinations you can be sent to; the trip is simply worth nothing.
    const zeros: string[] = [];
    for (let hi = 1; hi < PAYOUT_TABLE.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        if (payoutBetween(hi, lo) === 0) {
          zeros.push([CITIES[lo]!.name, CITIES[hi]!.name].sort().join(' / '));
        }
      }
    }
    expect(zeros.sort()).toEqual([
      'Minneapolis / St. Paul',
      'Oakland / San Francisco'
    ]);
  });

  it('still charges for the pairs that only look like twins', () => {
    expect(payoutBetween(idOf('Dallas'), idOf('Fort Worth'))).toBe(500);
    expect(payoutBetween(idOf('New York'), idOf('Philadelphia'))).toBe(1000);
  });

  it('reports dollars, not thousands', () => {
    expect(payoutBetween(idOf('Albany'), idOf('Baltimore'))).toBe(3500);
  });

  it('refuses a journey from a city to itself', () => {
    expect(() => payoutBetween(12, 12)).toThrow(/same city/);
  });

  it('never returns a negative or fractional dollar amount', () => {
    for (let hi = 1; hi < PAYOUT_TABLE.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        const paid = payoutBetween(hi, lo);
        expect(paid).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(paid)).toBe(true);
      }
    }
  });

  it('pins every value in the table, so a single corrupted cell fails', () => {
    // The other tests here sample a handful of cells; symmetry and range
    // checks can't detect most transposed digits. This test covers all
    // 2,211 values by digest, so any single-cell change — anywhere in the
    // table — turns this red.
    expect(digestOf(PAYOUT_TABLE)).toBe(PAYOUT_TABLE_DIGEST);
  });
});
