// The Rover Play and everything that ends a declaration short of winning —
// all derivations, no events. The catch needs two pawns on real adjacent
// nodes: red's latest destination St. Paul (c95), blue travelling the real
// c13–c95 spur (verified against engine/network.json).
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { currentCity, replay } from './game.js';
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

/** [3,4]: no freight Bonus Roll, so every turn closes on its one leg. */
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
const MIAMI = id('Miami');
const MPLS = id('Minneapolis');   // node c13
const STP = id('St. Paul');       // node c95

const opening = (aHome: CityId, bHome: CityId): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  home('red', aHome), home('blue', bHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

/** Red banks two trips, ends at St. Paul, and declares. Alternate: the $0
 *  Minneapolis journey, so the alternate's own arrival changes no balance. */
const runnerAtStPaul = (): GameEvent[] => [
  ...opening(CHICAGO, MIAMI),
  assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
  assign('red', NEW_YORK, STP), ...walk('red', NEW_YORK, STP),
  declare('red', STP, MPLS),
];

describe('the rover play', () => {
  it('transfers $50,000 to the first catcher and clears the declaration', () => {
    const before = replay(runnerAtStPaul());
    const caught = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },
    ]);
    expect(caught.seats.red.banked).toBe(before.seats.red.banked - 50000);
    // Blue collects the prize; their own real-edge turn still owes its
    // $1,000 bank fee at close.
    expect(caught.seats.blue.banked).toBe(before.seats.blue.banked + 50000 - 1000);
    expect(caught.seats.red.run).toEqual({
      alternate: { city: MPLS, region: cityById(MPLS).region, payout: 0 },
      toHome: false,
    });
    expect(destinationOf(caught.seats.red)).toBe(MPLS);
    expect(caught.winner).toBeNull();
  });

  it('moving through the runner\'s dot catches too — and only the first pawn collects', () => {
    const through = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95', 'c13'], arrived: false },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: true },
      // A second pass finds no declared pawn: the run cleared on the first.
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },
    ]);
    // Red's whole ledger, folded from the events: the starting cash, both
    // trips' payouts, the alternate's $0, one rover payment, and the $1,000
    // their own real-edge turn to the alternate billed.
    expect(through.seats.red.banked).toBe(
      PUBLISHED_RULES.startingCash
      + payoutBetween(CHICAGO, NEW_YORK) + payoutBetween(NEW_YORK, STP)
      - 50000 - 1000);
  });

  it('starting beside the runner is not a catch — the path\'s first node is where the pawn already was', () => {
    const state = replay([
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c95', 'c13'], arrived: false },
    ]);
    expect(state.seats.red.run?.toHome).toBe(true);
  });
});

describe('the road to the alternate', () => {
  it('a caught runner arrives at the alternate, collects its payout, and re-declaring is the ordinary rule', () => {
    const log: GameEvent[] = [
      ...runnerAtStPaul(),
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },   // catch
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: true },      // alternate reached
    ];
    const state = replay(log);
    const red = state.seats.red;
    expect(red.run).toBeNull();
    expect(red.stops[red.stops.length - 1])
      .toEqual({ city: MPLS, region: cityById(MPLS).region, payout: 0 });
    expect(currentCity(red)).toBe(MPLS);
    // Re-declaring is the ordinary eligibility rule again — which on THIS
    // bankroll answers false: the $50,000 rover payment sank red far below
    // the target. The affirmative case (caught, re-funded, re-declared) is
    // the phase-2 golden shelf's.
    expect(mayDeclare(state, 'red')).toBe(false);
    expect(red.banked).toBeLessThan(state.rules.winTarget);
    expect(state.winner).toBeNull();
  });
});

describe('un-declaring by poverty', () => {
  it('a fee that breaks the target clears the declaration', () => {
    // Target pinned exactly at the banked total, so one $1,000 bank fee
    // breaks the line. Starting cash zeroed: this test's subject is a fee
    // breaking the target, and the published $20,000 cushion would keep
    // the declaration standing.
    const target = payoutBetween(CHICAGO, NEW_YORK);
    const tight: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'A' },
      { type: 'joined', seat: 'blue', name: 'B' },
      { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: target, startingCash: 0 } },
      home('red', CHICAGO), home('blue', MIAMI),
      { type: 'orderRolled', seat: 'red', first: 'red' },
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      declare('red', NEW_YORK, MIAMI),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      // Any real edge anywhere: the fee fires at close. Fold tolerance
      // lets a test walk red on rails their pawn never stood beside.
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
    ];
    const state = replay(tight);
    expect(state.seats.red.banked).toBeLessThan(state.rules.winTarget);
    expect(state.seats.red.run?.toHome).toBe(false);
  });
});
