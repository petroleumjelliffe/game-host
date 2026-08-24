// The fee schedule against real edges of the built network. The
// neighbourhood (verified against engine/network.json, 2026-08-23):
// c13 Minneapolis –d131 carries [C&NW] alone, c13–d222 carries [CMStP&P]
// alone, and c13–d417 is shared trackage [GN, NP].
import { describe, expect, it } from 'vitest';
import type { SeatId } from './events.js';
import {
  ALL_OWNED_FEE, BANK_FEE, OWNER_FEE,
  attributeSection, sectionRailroads, turnBill,
} from './money.js';

const owners = (entries: [string, SeatId][]): ReadonlyMap<string, SeatId> =>
  new Map(entries);

describe('sectionRailroads', () => {
  it('reads the edge, and answers [] for a pair no edge joins', () => {
    expect([...sectionRailroads('c13', 'd131')]).toEqual(['C&NW']);
    expect([...sectionRailroads('c13', 'd417')].sort()).toEqual(['GN', 'NP']);
    // A hostile log's teleporting path must not throw the fold.
    expect(sectionRailroads('c13', 'c65')).toEqual([]);
  });
});

describe('attributeSection — cheapest legal bill for the mover', () => {
  it('prefers own line over any other, unowned over other-owned', () => {
    expect(attributeSection(['GN', 'NP'], 'red', owners([['NP', 'red']]))).toBe('NP');
    expect(attributeSection(['GN', 'NP'], 'red', owners([['GN', 'blue']]))).toBe('NP');
  });
  it('breaks ties by railroad id, deterministically', () => {
    expect(attributeSection(['NP', 'GN'], 'red', owners([]))).toBe('GN');
    expect(attributeSection(['NP', 'GN'], 'red',
      owners([['GN', 'blue'], ['NP', 'green']]))).toBe('GN');
  });
});

describe('turnBill', () => {
  it('bills $1,000 to the bank for an all-unowned turn', () => {
    const bill = turnBill([['c13', 'd131']], 'red', owners([]), false);
    expect(bill.toBank).toBe(BANK_FEE);
    expect(bill.toOwners.size).toBe(0);
  });

  it('bills one fee per owner, not per line or section', () => {
    const map = owners([['C&NW', 'blue'], ['CMStP&P', 'blue']]);
    const bill = turnBill([['d131', 'c13', 'd222']], 'red', map, false);
    expect(bill.toOwners.get('blue')).toBe(OWNER_FEE);   // both sections, one fee
    expect(bill.toBank).toBe(0);                          // displaced, not added
  });

  it('bills $10,000 per owner once all railroads are owned', () => {
    const map = owners([['C&NW', 'blue']]);
    const bill = turnBill([['c13', 'd131']], 'red', map, true);
    expect(bill.toOwners.get('blue')).toBe(ALL_OWNED_FEE);
  });

  it('bills nothing for a turn entirely on the mover\'s own lines', () => {
    const bill = turnBill([['c13', 'd131']], 'red', owners([['C&NW', 'red']]), false);
    expect(bill.toBank).toBe(0);
    expect(bill.toOwners.size).toBe(0);
  });

  it('rides the unowned line across shared trackage rather than paying', () => {
    // c13–d417 carries GN and NP; blue owns GN, NP is free.
    const bill = turnBill([['c13', 'd417']], 'red', owners([['GN', 'blue']]), false);
    expect(bill.toOwners.size).toBe(0);
    expect(bill.toBank).toBe(BANK_FEE);
  });

  it('sums both legs of a two-leg turn into one bill', () => {
    const map = owners([['C&NW', 'blue'], ['CMStP&P', 'green']]);
    const bill = turnBill([['c13', 'd131'], ['d131', 'c13', 'd222']], 'red', map, false);
    expect(bill.toOwners.get('blue')).toBe(OWNER_FEE);
    expect(bill.toOwners.get('green')).toBe(OWNER_FEE);
  });
});
