// Ownership as a fold: the owners map, holdings, and the one money ledger.
// Events are built by helpers so payouts and prices are computed, never
// hardcoded — a fixture that hardcodes a price is wrong the day the table
// is retyped.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween, railroadPrice } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { replay } from './game.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const assign = (seat: SeatId, from: CityId, to: CityId): GameEvent =>
  ({ type: 'arrived', seat, city: to, region: cityById(to).region,
     payout: payoutBetween(from, to) });

/**
 * Roll-then-walk, arriving: the two events that complete a trip. The white
 * pair [3, 4] earns no Bonus Roll on a freight (only [6, 6] does — dice.ts),
 * so the turn closes on its one leg and turn order stays predictable.
 */
const walk = (seat: SeatId, from: CityId, to: CityId): GameEvent[] => [
  { type: 'turnRolled', seat, white: [3, 4], bonus: null },
  { type: 'moved', seat, path: [nodeForCity(from), nodeForCity(to)], arrived: true },
];

const buy = (seat: SeatId, railroad: string): GameEvent =>
  ({ type: 'bought', seat, railroad, price: railroadPrice(railroad) });

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const MIAMI = id('Miami');

const opening = (aHome: CityId, bHome: CityId): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  // Starting cash zeroed: this file's subject is the debit and credit of
  // each purchase and sale — the into-debt case included — and the
  // published $20,000 cushion would hide the ledger going short.
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000, startingCash: 0 } },
  home('red', aHome), home('blue', bHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

describe('ownership', () => {
  it('a purchase debits the buyer and lands on the map', () => {
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      buy('red', 'NYC'),
    ];
    const state = replay(log);
    expect(state.owners.get('NYC')).toBe('red');
    expect(state.seats.red.holdings).toEqual(['NYC']);
    expect(state.seats.red.banked)
      .toBe(payoutBetween(CHICAGO, NEW_YORK) - railroadPrice('NYC'));
  });

  it('a sale returns the railroad to the map and credits the seller', () => {
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      buy('red', 'NYC'),
      { type: 'sold', seat: 'red', railroad: 'NYC', price: 14000 },
    ];
    const state = replay(log);
    expect(state.owners.has('NYC')).toBe(false);
    expect(state.seats.red.holdings).toEqual([]);
    expect(state.seats.red.banked)
      .toBe(payoutBetween(CHICAGO, NEW_YORK) - railroadPrice('NYC') + 14000);
  });

  it('replays a pre-ownership log with an empty map', () => {
    const state = replay([...opening(CHICAGO, MIAMI)]);
    expect(state.owners.size).toBe(0);
    expect(state.seats.red.holdings).toEqual([]);
  });

  it('is tolerant: the fold banks whatever the log says, even into debt', () => {
    // No affordability check at replay — that is legal.ts's job. A log
    // that bought beyond its means folds to a negative balance, which
    // Decision 2 makes a legal state anyway.
    const state = replay([...opening(CHICAGO, MIAMI), buy('red', 'SP')]);
    expect(state.seats.red.banked).toBe(-railroadPrice('SP'));
  });
});
