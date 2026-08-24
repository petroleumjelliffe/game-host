// The end rule as a fold: banked vs earned, homeward, and the winning move.
// Events are built by helpers so payouts are computed, never hardcoded —
// a fixture that hardcodes a payout is wrong the day the table is retyped.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine/index.js';
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

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');

const opening = (aHome: CityId, bHome: CityId): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  home('red', aHome), home('blue', bHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

describe('banked vs earned', () => {
  it('banks a trip only once it is walked', () => {
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK),
    ];
    const mid = replay(log);
    const pay = payoutBetween(CHICAGO, NEW_YORK);
    expect(mid.seats.red.earned).toBe(pay);   // assignment-time, as today
    expect(mid.seats.red.banked).toBe(0);      // the trip is not walked
    expect(mid.seats.red.homeward).toBe(false);

    const done = replay([...log, ...walk('red', CHICAGO, NEW_YORK)]);
    expect(done.seats.red.banked).toBe(pay);
    // winTarget 1000: any real payout crosses it, so completing goes homeward.
    expect(done.seats.red.homeward).toBe(true);
  });

  it('keeps a completed trip banked while walking home', () => {
    // The trap bankedOf-by-position falls into: a homeward baron who leaves
    // their last stop must not have that trip silently un-banked.
    const log: GameEvent[] = [
      ...opening(CHICAGO, MIAMI),
      assign('red', CHICAGO, NEW_YORK),
      ...walk('red', CHICAGO, NEW_YORK),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), 'd100'], arrived: false },
    ];
    const state = replay(log);
    expect(state.seats.red.banked).toBe(payoutBetween(CHICAGO, NEW_YORK));
    expect(state.seats.red.homeward).toBe(true);
    expect(state.winner).toBeNull();
  });
});

describe('the win', () => {
  const toTheBrink = (): GameEvent[] => [
    ...opening(CHICAGO, MIAMI),
    assign('red', CHICAGO, NEW_YORK),
    ...walk('red', CHICAGO, NEW_YORK),       // red banked past 1000, homeward
  ];

  it('derives the winner from the moved that ends at home', () => {
    const won = replay([
      ...toTheBrink(),
      { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
    ]);
    expect(won.winner).toBe('red');
    expect(won.phase).toBe('over');
  });

  it('does not end on cash alone: a homeward seat mid-run has no winner', () => {
    const state = replay(toTheBrink());
    expect(state.seats.red.homeward).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.phase).toBe('playing');
  });

  it('lets a second seat overtake a leader who has not reached home', () => {
    const log: GameEvent[] = [
      ...toTheBrink(),                          // red homeward, away from home
      assign('blue', MIAMI, LOS_ANGELES),
      ...walk('blue', MIAMI, LOS_ANGELES),      // blue banked past 1000 too
      { type: 'turnRolled', seat: 'blue', white: [1, 2], bonus: null },
      { type: 'moved', seat: 'blue',
        path: [nodeForCity(LOS_ANGELES), nodeForCity(MIAMI)], arrived: true },
    ];
    expect(replay(log).winner).toBe('blue');
  });
});

describe('rules in the fold', () => {
  it('defaults when started carries none — an old save', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'A' },
      { type: 'started' },
    ]);
    expect(state.rules).toEqual(PUBLISHED_RULES);
    expect(state.winner).toBeNull();
  });

  it('a $0 trip banks nothing and changes nothing homeward', () => {
    const MPLS = id('Minneapolis');
    const STP = id('St. Paul');
    const log: GameEvent[] = [
      ...opening(MPLS, MIAMI),
      assign('red', MPLS, STP),
      ...walk('red', MPLS, STP),
    ];
    const state = replay(log);
    expect(payoutBetween(MPLS, STP)).toBe(0);
    // The trip banks nothing — but Minneapolis–St. Paul is a real edge, so
    // since phase 2 the turn itself bills its $1,000 bank fee at close.
    expect(state.seats.red.banked).toBe(-1000);
    expect(state.seats.red.homeward).toBe(false);
  });
});
