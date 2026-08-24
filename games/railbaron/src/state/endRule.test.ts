// The end rule as a fold: banked vs earned, declaring, and the winning move.
// Events are built by helpers so payouts are computed, never hardcoded —
// a fixture that hardcodes a payout is wrong the day the table is retyped.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { replay } from './game.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';
import { destinationOf, mayDeclare } from './turns.js';

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

const declare = (seat: SeatId, from: CityId, alt: CityId): GameEvent =>
  ({ type: 'declared', seat,
     alternate: { city: alt, region: cityById(alt).region,
                  payout: payoutBetween(from, alt) } });

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');

const opening = (aHome: CityId, bHome: CityId, rules: object = {}): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000, ...rules } },
  home('red', aHome), home('blue', bHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

/** Red completes a paying trip: banked past winTarget 1000, at New York. */
const brink = (): GameEvent[] => [
  ...opening(CHICAGO, MIAMI),
  assign('red', CHICAGO, NEW_YORK),
  ...walk('red', CHICAGO, NEW_YORK),
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
    // The trip is not walked: only the rulebook's starting cash is banked.
    expect(mid.seats.red.banked).toBe(PUBLISHED_RULES.startingCash);
    expect(mayDeclare(mid, 'red')).toBe(false);

    const done = replay([...log, ...walk('red', CHICAGO, NEW_YORK)]);
    expect(done.seats.red.banked).toBe(PUBLISHED_RULES.startingCash + pay);
    // winTarget 1000: any real payout crosses it — but crossing only makes
    // declaring *eligible*; nothing changes by itself (spec Decision 3).
    expect(mayDeclare(done, 'red')).toBe(true);
    expect(done.seats.red.run).toBeNull();
  });

  it('keeps a completed trip banked while running home', () => {
    // The trap banked-by-position falls into: a declared baron who leaves
    // their last stop must not have that trip silently un-banked.
    const log: GameEvent[] = [
      ...brink(),
      declare('red', NEW_YORK, LOS_ANGELES),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), 'd100'], arrived: false },
    ];
    const state = replay(log);
    expect(state.seats.red.banked)
      .toBe(PUBLISHED_RULES.startingCash + payoutBetween(CHICAGO, NEW_YORK));
    expect(state.seats.red.run?.toHome).toBe(true);
    expect(state.winner).toBeNull();
  });
});

describe('the declared run', () => {
  it('crossing the target no longer changes anything by itself', () => {
    const state = replay(brink());
    expect(state.seats.red.run).toBeNull();
    expect(state.winner).toBeNull();
    expect(mayDeclare(state, 'red')).toBe(true);
    expect(mayDeclare(state, 'blue')).toBe(false);
  });

  it('declaring sets the run and aims the baron home', () => {
    const state = replay([...brink(), declare('red', NEW_YORK, LOS_ANGELES)]);
    expect(state.seats.red.run).toEqual({
      alternate: { city: LOS_ANGELES, region: cityById(LOS_ANGELES).region,
                   payout: payoutBetween(NEW_YORK, LOS_ANGELES) },
      toHome: true,
    });
    expect(destinationOf(state.seats.red)).toBe(CHICAGO);
    expect(state.winner).toBeNull();
    expect(state.phase).toBe('playing');
  });

  it('a declared moved ending at home wins — undeclared, the same move does not', () => {
    const winning: GameEvent[] = [
      { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
    ];
    const declaredWin = replay([
      ...brink(), declare('red', NEW_YORK, LOS_ANGELES), ...winning,
    ]);
    expect(declaredWin.winner).toBe('red');
    expect(declaredWin.phase).toBe('over');

    // "A player cannot win just by moving into his home city during a
    // normal trip" — the same log without the declare has no winner.
    const silent = replay([...brink(), ...winning]);
    expect(silent.winner).toBeNull();
    expect(silent.phase).toBe('playing');
  });

  it('declaring while standing at home wins immediately', () => {
    // Red's latest destination IS Chicago, their home — a legal trip.
    const log: GameEvent[] = [
      ...brink(),
      assign('red', NEW_YORK, CHICAGO), ...walk('red', NEW_YORK, CHICAGO),
      declare('red', CHICAGO, MIAMI),
    ];
    const state = replay(log);
    expect(state.winner).toBe('red');
    expect(state.phase).toBe('over');
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

  it('a $0 trip banks nothing and lights nothing', () => {
    const MPLS = id('Minneapolis');
    const STP = id('St. Paul');
    const log: GameEvent[] = [
      // Starting cash zeroed: this test's subject is a trip that lights
      // nothing, and the published $20,000 already clears winTarget 1000.
      ...opening(MPLS, MIAMI, { startingCash: 0 }),
      assign('red', MPLS, STP),
      ...walk('red', MPLS, STP),
    ];
    const state = replay(log);
    expect(payoutBetween(MPLS, STP)).toBe(0);
    // The trip banks nothing — but Minneapolis–St. Paul is a real edge, so
    // since phase 2 the turn itself bills its $1,000 bank fee at close.
    expect(state.seats.red.banked).toBe(-1000);
    expect(mayDeclare(state, 'red')).toBe(false);
  });
});
