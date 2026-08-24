// The money spec's golden shelf, event level — the layer arrivals live at,
// which is why these are not in engine/golden/. Every append below goes
// through appendLegality before it joins the log, so each game pins the
// wire-facing answer, not only the fold. Payouts are computed via
// payoutBetween, never hardcoded.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
import { replay } from './game.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const START = PUBLISHED_RULES.startingCash;

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const assign = (seat: SeatId, from: CityId, to: CityId): GameEvent =>
  ({ type: 'arrived', seat, city: to, region: cityById(to).region,
     payout: payoutBetween(from, to) });

/** [3,4]: no freight Bonus Roll, so every turn closes on its one leg. */
const roll = (seat: SeatId): GameEvent =>
  ({ type: 'turnRolled', seat, white: [3, 4], bonus: null });

const move = (seat: SeatId, path: string[], arrived: boolean): GameEvent =>
  ({ type: 'moved', seat, path, arrived });

/** Append through the gate: the legality IS the assertion. */
const play = (log: GameEvent[], event: GameEvent, sender: SeatId): GameEvent[] => {
  const refusal = appendLegality(log, event, sender);
  expect(refusal, `${event.type} by ${sender}: ${refusal?.message ?? ''}`).toBeNull();
  return [...log, event];
};

const opening = (redHome: CityId, blueHome: CityId, rules: object = {}): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, ...rules } } as GameEvent,
  home('red', redHome), home('blue', blueHome),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

describe('the standard cycle', () => {
  it('destination assigned, walked, paid on completion, next one legal', () => {
    let log = opening(CHICAGO, MIAMI); // published target: nobody nears it
    const pay = payoutBetween(CHICAGO, NEW_YORK);

    log = play(log, assign('red', CHICAGO, NEW_YORK), 'red');
    // Assigned, not walked: only the rulebook's starting cash is in hand.
    expect(replay(log).seats.red.banked).toBe(START);

    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(CHICAGO), nodeForCity(NEW_YORK)], true), 'red');
    expect(replay(log).seats.red.banked).toBe(START + pay);  // walked, banked

    // Blue's turn; then red is owed its next destination, and it is legal.
    log = play(log, assign('blue', MIAMI, LOS_ANGELES), 'blue');
    log = play(log, roll('blue'), 'blue');
    log = play(log, move('blue', [nodeForCity(MIAMI), nodeForCity(LOS_ANGELES)], true), 'blue');
    log = play(log, assign('red', NEW_YORK, MIAMI), 'red');
    expect(replay(log).seats.red.banked).toBe(START + pay);  // next trip in flight
  });
});

describe('the $0 neighbours', () => {
  const pairs: [string, string][] = [
    ['Minneapolis', 'St. Paul'],
    ['Oakland', 'San Francisco'],
  ];
  for (const [fromName, toName] of pairs) {
    it(`${fromName} to ${toName} is a real trip worth nothing`, () => {
      const from = id(fromName);
      const to = id(toName);
      expect(payoutBetween(from, to)).toBe(0);

      let log = opening(from, MIAMI);
      log = play(log, assign('red', from, to), 'red');   // payout: 0 accepted
      log = play(log, roll('red'), 'red');
      log = play(log, move('red', [nodeForCity(from), nodeForCity(to)], true), 'red');

      const state = replay(log);
      // The trip banks its real $0 — and the twin spur is a real edge, so
      // since phase 2 the turn bills its $1,000 bank fee at close, straight
      // out of the starting cash.
      expect(state.seats.red.banked).toBe(START - 1000);
      expect(state.seats.red.run).toBeNull();
      expect(state.winner).toBeNull();
    });
  }
});
