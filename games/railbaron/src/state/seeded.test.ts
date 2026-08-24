// Generation and verification are the same derivation, so a client that
// rolls with nextRng() always passes seedConformance() — asserted directly
// through appendLegality, the gate that actually runs it.
import { describe, expect, it } from 'vitest';
import {
  CITIES, REGIONS, cityById, destinationInRegion, nodeForCity, payoutBetween,
  rollDestination, rollTurn,
} from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
import { replay } from './game.js';
import { countRollEvents, nextRng } from './seeded.js';
import { homesTaken } from './turns.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const MIAMI = id('Miami');

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const opening = (seed?: string): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: seed === undefined
      ? { ...PUBLISHED_RULES, winTarget: 1000 }
      : { ...PUBLISHED_RULES, winTarget: 1000, seed } },
  home('red', CHICAGO), home('blue', MIAMI),
  { type: 'orderRolled', seat: 'red', first: 'red' },
  // Red holds a destination and owes a plain turn roll — the cleanest site
  // to probe conformance. The history's own values are never re-checked;
  // only the append under test is.
  { type: 'arrived', seat: 'red', city: NEW_YORK,
    region: cityById(NEW_YORK).region, payout: payoutBetween(CHICAGO, NEW_YORK) },
];

describe('a seeded game', () => {
  it('accepts the roll the seed prescribes and refuses any other', () => {
    const log = opening('test-night');
    const prescribed = rollTurn('freight', nextRng(log, 'test-night'));
    const event: GameEvent = { type: 'turnRolled', seat: 'red',
      white: [prescribed.white[0], prescribed.white[1]], bonus: prescribed.bonus };
    expect(appendLegality(log, event, 'red')).toBeNull();

    const other: GameEvent = { ...event,
      white: [(prescribed.white[0] % 6) + 1, prescribed.white[1]] };
    const refusal = appendLegality(log, other, 'red');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/seeded/);
  });

  it('counts only roll-bearing events', () => {
    expect(countRollEvents([
      { type: 'joined', seat: 'red', name: 'A' },
      { type: 'started' },
      { type: 'turnRolled', seat: 'red', white: [1, 2], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(CHICAGO), 'd1'], arrived: false },
      { type: 'bonusRolled', seat: 'red', face: 4 },
    ] as GameEvent[])).toBe(2);
  });

  it('leaves unseeded games unchecked', () => {
    const log = opening();
    const anything: GameEvent =
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null };
    expect(appendLegality(log, anything, 'red')).toBeNull();
  });

  it('verifies the declared alternate against the seed, choice and all', () => {
    // Red walks the assigned trip and blue takes a turn, so red stands at
    // their latest destination, over winTarget 1000, as the actor — the
    // declare window. History is scripted freely: only the append under
    // test is checked, exactly as the header says.
    const log: GameEvent[] = [
      ...opening('test-night'),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(CHICAGO), nodeForCity(NEW_YORK)], arrived: true },
      { type: 'arrived', seat: 'blue', city: id('Los Angeles'),
        region: cityById(id('Los Angeles')).region,
        payout: payoutBetween(MIAMI, id('Los Angeles')) },
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue',
        path: [nodeForCity(MIAMI), 'c95'], arrived: false },
    ];
    // Generate exactly as the hook will: one stream for the whole event,
    // rollDestination first, and the city drawn from the same stream when
    // the region roll handed the choice over.
    const rng = nextRng(log, 'test-night');
    const from = NEW_YORK;
    const taken = homesTaken(replay(log));
    const outcome = rollDestination(from, rng, taken);
    const alternate = outcome.kind === 'arrived'
      ? { city: outcome.city, region: outcome.region, payout: outcome.payout }
      : (() => {
          const region = REGIONS.find((r) => r.id !== cityById(from).region)!.id;
          const arrival = destinationInRegion(from, region, rng);
          return { city: arrival.city, region, payout: arrival.payout };
        })();

    const event: GameEvent = { type: 'declared', seat: 'red', alternate };
    expect(appendLegality(log, event, 'red')).toBeNull();

    // Any other alternate city is not the seed's.
    const elsewhere = CITIES.find((c) =>
      c.region === alternate.region && c.id !== alternate.city && c.id !== from)!;
    const cooked: GameEvent = { type: 'declared', seat: 'red',
      alternate: { city: elsewhere.id, region: elsewhere.region,
                   payout: payoutBetween(from, elsewhere.id) } };
    const refusal = appendLegality(log, cooked, 'red');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/seeded/);
  });
});
