// The rulebook's railroad purchase prices, in thousands — the transcription
// (docs/rules/railroad-prices.md) is the record, this table is the runtime,
// and the digest test is the lock, exactly as PAYOUT_TABLE and CODES are
// pinned. SLSF is 19: the paste read 119, out of family against a 4–42
// range, and the cell was held out until the owner checked the printed
// page (2026-08-23, a doubled keystroke). That story is why the digest
// exists — range checks pass on mis-copied cells.
import type { RailroadId } from './network.js';

export const RAILROAD_PRICES: ReadonlyMap<RailroadId, number> = new Map([
  ['ACL', 12], ['AT&SF', 40], ['B&M', 4], ['B&O', 24], ['C&NW', 14],
  ['C&O', 20], ['CB&Q', 20], ['CMStP&P', 18], ['CRI&P', 29], ['D&RGW', 6],
  ['GM&O', 12], ['GN', 17], ['IC', 14], ['L&N', 18], ['MP', 21],
  ['N&W', 12], ['NP', 14], ['NYC', 28], ['NYNH&H', 4], ['PA', 30],
  ['RF&P', 4], ['SAL', 14], ['SLSF', 19], ['SOU', 20], ['SP', 42],
  ['T&P', 10], ['UP', 40], ['WP', 8],
]);

/** Dollars — thousands ×1000, payoutBetween's convention. */
export function railroadPrice(id: RailroadId): number {
  const thousands = RAILROAD_PRICES.get(id);
  if (thousands === undefined) throw new Error(`no railroad priced: ${id}`);
  return thousands * 1000;
}

/**
 * What the bank pays in a forced sale: half the purchase price. A
 * PLACEHOLDER by decision (spec Decision 4, docs/rules/user-fees.md) —
 * the customary figure, held against the still-owed forced-sale text.
 * `sold` events carry their price, so correcting this later changes new
 * sales only; history replays as written.
 */
export const bankSalePrice = (id: RailroadId): number => railroadPrice(id) / 2;
