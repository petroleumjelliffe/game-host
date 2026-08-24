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
    let log = opening(CHICAGO, MIAMI); // published target: nobody goes homeward
    const pay = payoutBetween(CHICAGO, NEW_YORK);

    log = play(log, assign('red', CHICAGO, NEW_YORK), 'red');
    expect(replay(log).seats.red.banked).toBe(0);       // assigned, not walked

    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(CHICAGO), nodeForCity(NEW_YORK)], true), 'red');
    expect(replay(log).seats.red.banked).toBe(pay);      // walked, banked

    // Blue's turn; then red is owed its next destination, and it is legal.
    log = play(log, assign('blue', MIAMI, LOS_ANGELES), 'blue');
    log = play(log, roll('blue'), 'blue');
    log = play(log, move('blue', [nodeForCity(MIAMI), nodeForCity(LOS_ANGELES)], true), 'blue');
    log = play(log, assign('red', NEW_YORK, MIAMI), 'red');
    expect(replay(log).seats.red.banked).toBe(pay);      // next trip in flight
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
      // since phase 2 the turn bills its $1,000 bank fee at close.
      expect(state.seats.red.banked).toBe(-1000);
      expect(state.seats.red.homeward).toBe(false);
      expect(state.winner).toBeNull();
    });
  }
});

describe('the homeward run', () => {
  /** Red completes a paying trip and goes homeward; blue does the same. */
  const bothHomeward = (): GameEvent[] => {
    let log = opening(CHICAGO, MIAMI, { winTarget: 1000 });
    log = play(log, assign('red', CHICAGO, NEW_YORK), 'red');
    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(CHICAGO), nodeForCity(NEW_YORK)], true), 'red');
    log = play(log, assign('blue', MIAMI, LOS_ANGELES), 'blue');
    log = play(log, roll('blue'), 'blue');
    log = play(log, move('blue', [nodeForCity(MIAMI), nodeForCity(LOS_ANGELES)], true), 'blue');
    return log;
  };

  it('is several turns under different rules, ending in the winning arrival', () => {
    let log = bothHomeward();
    expect(replay(log).seats.red.homeward).toBe(true);

    // Red's turn, homeward: destinations are refused, by reason —
    const ballot = appendLegality(log,
      { type: 'regionRequested', seat: 'red', rolled: cityById(CHICAGO).region }, 'red');
    expect(ballot?.message).toMatch(/homeward/);
    const dest = appendLegality(log, assign('red', NEW_YORK, MIAMI), 'red');
    expect(dest?.message).toMatch(/homeward/);

    // — while ordinary turns stay legal. Red wanders without arriving:
    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(NEW_YORK), 'd100'], false), 'red');

    // Blue (also homeward) plays an ordinary turn in between, unaffected.
    log = play(log, roll('blue'), 'blue');
    log = play(log, move('blue', [nodeForCity(LOS_ANGELES), 'd200'], false), 'blue');

    // The run ends in the winning arrival at the home city's node.
    log = play(log, roll('red'), 'red');
    log = play(log, move('red', ['d100', nodeForCity(CHICAGO)], true), 'red');

    const state = replay(log);
    expect(state.winner).toBe('red');
    expect(state.phase).toBe('over');
  });

  it('closes the game to every event type after the win', () => {
    let log = bothHomeward();
    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], true), 'red');

    const attempts: [GameEvent, SeatId][] = [
      [{ type: 'joined', seat: 'green', name: 'C' }, 'green'],
      [{ type: 'renamed', seat: 'blue', name: 'Z' }, 'blue'],
      [{ type: 'started' }, 'blue'],
      [{ type: 'regionRequested', seat: 'blue', rolled: cityById(MIAMI).region }, 'blue'],
      [assign('blue', LOS_ANGELES, MIAMI), 'blue'],
      [{ type: 'orderRolled', seat: 'blue', first: 'blue' }, 'blue'],
      [roll('blue'), 'blue'],
      [{ type: 'bonusRolled', seat: 'blue', face: 3 }, 'blue'],
      [move('blue', [nodeForCity(LOS_ANGELES), 'd1'], false), 'blue'],
    ];
    for (const [event, sender] of attempts) {
      const refusal = appendLegality(log, event, sender);
      expect(refusal, event.type).not.toBeNull();
      expect(refusal!.message, event.type).toMatch(/game is over/);
    }
  });

  it('lets the second homeward seat overtake a leader still on the road', () => {
    let log = bothHomeward();                            // red crossed first
    log = play(log, roll('red'), 'red');
    log = play(log, move('red', [nodeForCity(NEW_YORK), 'd100'], false), 'red'); // dawdles
    log = play(log, roll('blue'), 'blue');
    log = play(log, move('blue',
      [nodeForCity(LOS_ANGELES), nodeForCity(MIAMI)], true), 'blue');            // beats them home

    expect(replay(log).winner).toBe('blue');
  });
});
