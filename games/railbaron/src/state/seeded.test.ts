// Generation and verification are the same derivation, so a client that
// rolls with nextRng() always passes seedConformance() — asserted directly
// through appendLegality, the gate that actually runs it.
import { describe, expect, it } from 'vitest';
import { CITIES, cityById, nodeForCity, payoutBetween, rollTurn } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
import { countRollEvents, nextRng } from './seeded.js';
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
});
