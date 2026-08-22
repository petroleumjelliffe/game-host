// What legal.ts refuses once money means something: appends into a finished
// game, destination rolls from homeward barons, and payouts the table never
// said. Refusals are asserted by *reason* — a turn-order mistake in a builder
// must not impersonate a pass.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
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

/** [3,4] earns no freight Bonus Roll, so the turn closes on its one leg. */
const walk = (seat: SeatId, from: CityId, to: CityId): GameEvent[] => [
  { type: 'turnRolled', seat, white: [3, 4], bonus: null },
  { type: 'moved', seat, path: [nodeForCity(from), nodeForCity(to)], arrived: true },
];

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');

const opening = (): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, winTarget: 1000 } },
  home('red', CHICAGO), home('blue', MIAMI),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

/**
 * Red completes a trip (homeward at NEW_YORK), then blue completes one too,
 * which hands the turn back to red — the trap the plan warns about: without
 * blue's intervening turn, every red append would be refused `not your turn`
 * and these tests would pass for the wrong reason.
 */
const brink = (): GameEvent[] => [
  ...opening(),
  assign('red', CHICAGO, NEW_YORK),
  ...walk('red', CHICAGO, NEW_YORK),
  assign('blue', MIAMI, LOS_ANGELES),
  ...walk('blue', MIAMI, LOS_ANGELES),
];

const wonLog = (): GameEvent[] => [
  ...brink(),
  { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
  { type: 'moved', seat: 'red',
    path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
];

describe('a finished game is closed', () => {
  it('refuses every append after the winning move, by reason', () => {
    const done = wonLog();
    const refusal = appendLegality(done,
      { type: 'turnRolled', seat: 'blue', white: [1, 1], bonus: null }, 'blue');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/game is over/);
  });
});

describe('homeward seats', () => {
  it('may not roll destinations', () => {
    const log = brink(); // red's turn, red homeward at NEW_YORK
    const region = appendLegality(log,
      { type: 'regionRequested', seat: 'red', rolled: cityById(CHICAGO).region }, 'red');
    expect(region).not.toBeNull();
    expect(region!.message).toMatch(/homeward/);

    const dest = appendLegality(log, assign('red', NEW_YORK, MIAMI), 'red');
    expect(dest).not.toBeNull();
    expect(dest!.message).toMatch(/homeward/);
  });

  it('may roll the turn dice without a destination owed', () => {
    expect(appendLegality(brink(),
      { type: 'turnRolled', seat: 'red', white: [2, 3], bonus: null }, 'red')).toBeNull();
  });
});

describe('payout honesty', () => {
  it('refuses an arrived whose payout is not the table\'s', () => {
    const log = opening(); // red's turn, red owes a destination
    const wrong = { ...assign('red', CHICAGO, NEW_YORK), payout: 999999 } as GameEvent;
    const refusal = appendLegality(log, wrong, 'red');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/payout table/);
    expect(appendLegality(log, assign('red', CHICAGO, NEW_YORK), 'red')).toBeNull();
  });
});
