import { describe, expect, it } from 'vitest';
import { RAILROADS } from './network';
import { RAILROAD_PRICES, bankSalePrice, railroadPrice } from './railroads';

// Locked-in digest of the price list, transcribed 2026-08-23 from the
// printed rulebook (docs/rules/railroad-prices.md). FNV-1a over
// "ID:thousands," in id order — the same policy that pins PAYOUT_TABLE
// and CODES, because range checks pass on mis-copied cells and this
// table already produced one (SLSF pasted as 119; it is 19).
const RAILROAD_PRICES_DIGEST = 'fac6bc07';

const digestOf = (prices: ReadonlyMap<string, number>): string => {
  let hash = 0x811c9dc5;
  for (const id of [...prices.keys()].sort()) {
    const text = `${id}:${prices.get(id)},`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

describe('the railroad price list', () => {
  it('matches the transcription digest, cell for cell', () => {
    expect(digestOf(RAILROAD_PRICES)).toBe(RAILROAD_PRICES_DIGEST);
  });

  it('prices exactly the 28 railroads the map carries', () => {
    expect([...RAILROAD_PRICES.keys()].sort())
      .toEqual([...RAILROADS.keys()].sort());
  });

  it('agrees with the cost the built network already carries', () => {
    // network.json is generated data; this table is the pinned record.
    // If a graph rebuild ever drifts a cost, this is what says which of
    // the two is the transcription.
    for (const [id, line] of RAILROADS) {
      expect(railroadPrice(id), id).toBe(line.cost);
    }
  });

  it('answers in dollars, and halves for the bank', () => {
    expect(railroadPrice('SLSF')).toBe(19000);
    expect(bankSalePrice('SLSF')).toBe(9500);
    expect(bankSalePrice('CRI&P')).toBe(14500);
  });

  it('throws on a railroad that never existed', () => {
    expect(() => railroadPrice('AMTRAK')).toThrow(/AMTRAK/);
  });
});
