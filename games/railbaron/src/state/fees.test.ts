// Fee settlement as a fold: the bill lands when the turn closes, derived
// from the paths the turn walked. Real edges only where a fee is meant to
// fire — c13 Minneapolis–d131 carries [C&NW] alone (verified against
// engine/network.json); the endRule-style two-fake-node walks ride no
// edge and deliberately bill nothing.
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

const walk = (seat: SeatId, from: CityId, to: CityId): GameEvent[] => [
  { type: 'turnRolled', seat, white: [3, 4], bonus: null },
  { type: 'moved', seat, path: [nodeForCity(from), nodeForCity(to)], arrived: true },
];

const MPLS = id('Minneapolis');
const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const MIAMI = id('Miami');

const opening = (aHome: CityId, bHome: CityId): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  home('red', aHome), home('blue', bHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

describe('fees settle when the turn closes', () => {
  it('bills $1,000 to the bank for an unowned turn — and may go negative', () => {
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(log);
    // The trip is in flight, so nothing is banked yet; the fee still lands.
    expect(state.seats.red.banked).toBe(-1000);
  });

  it('pays the owner, who is credited in the same derivation', () => {
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'bought', seat: 'blue', railroad: 'C&NW', price: railroadPrice('C&NW') },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(log);
    expect(state.seats.red.banked).toBe(-5000);
    expect(state.seats.blue.banked).toBe(-railroadPrice('C&NW') + 5000);
  });

  it('does not bill an open turn — settlement is after the turn', () => {
    // [6, 6] earns a freight its Bonus Roll, so one leg leaves the turn open.
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, NEW_YORK),
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    expect(replay(log).seats.red.banked).toBe(0);
  });

  it('bills a fee-free turn nothing: fake paths ride no edges', () => {
    // The endRule fixtures' two-node walks are off the rail network, so
    // they attract no fee — which is why every phase-1 money assertion
    // survives this task unchanged. This test pins that reading.
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
    ];
    expect(replay(log).seats.red.banked).toBe(payoutBetween(CHICAGO, NEW_YORK));
  });
});
