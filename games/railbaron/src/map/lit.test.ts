import { describe, expect, it } from 'vitest';
import { nodeForCity } from '../../engine';
import { markers, pawns } from './lit';
import { replay } from '../state/game';
import type { GameEvent } from '../state/events';

const CHICAGO = 20;
const DENVER = 39;
const MINNEAPOLIS = 43;
const ST_PAUL = 47;

const join: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' }
];

const lit = (events: GameEvent[]) => markers(replay(events));

describe('which lamps carry a colour', () => {
  it('lights nothing before anyone has rolled', () => {
    expect(lit(join).size).toBe(0);
  });

  it('lights a first destination with no origin behind it', () => {
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 }]);
    expect(map.get(CHICAGO)).toEqual([{ seat: 'red', name: 'ADA', role: 'destination' }]);
    expect(map.size).toBe(1);
  });

  it('lights where a baron set out from as well as where they are bound', () => {
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: DENVER, region: 'PL', payout: 9000 }]);
    expect(map.get(DENVER)?.[0]!.role).toBe('destination');
    expect(map.get(CHICAGO)?.[0]!.role).toBe('origin');
  });

  it('only keeps the last leg, not the whole journey', () => {
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 3000 },
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: DENVER, region: 'PL', payout: 9000 }]);
    expect(map.has(MINNEAPOLIS)).toBe(false);
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([CHICAGO, DENVER]);
  });

  it('does not mark a home town as its own origin', () => {
    // A roll landing where the baron already stands: payout null, and the
    // same city would otherwise be both ends of the leg.
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: null }]);
    expect(map.get(CHICAGO)).toEqual([{ seat: 'red', name: 'ADA', role: 'destination' }]);
  });

  it('keeps a real $0 journey lit like any other', () => {
    // Minneapolis to St. Paul pays nothing and is still somewhere to be.
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 3000 },
      { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 }]);
    expect(map.get(ST_PAUL)?.[0]!.role).toBe('destination');
    expect(map.get(MINNEAPOLIS)?.[0]!.role).toBe('origin');
  });

  it('puts a destination ahead of an origin when two barons share a city', () => {
    const map = lit([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: DENVER, region: 'PL', payout: 9000 },
      { type: 'arrived', seat: 'blue', city: CHICAGO, region: 'NC', payout: 4500 }]);
    const both = map.get(CHICAGO)!;
    expect(both).toHaveLength(2);
    expect(both[0]).toEqual({ seat: 'blue', name: 'MARGO', role: 'destination' });
    expect(both[1]!.role).toBe('origin');
  });

  it('ignores a seat nobody took', () => {
    const map = lit([{ type: 'started' },
      { type: 'arrived', seat: 'green', city: CHICAGO, region: 'NC', payout: 4500 }]);
    expect(map.size).toBe(0);
  });
});

describe('where the pawns are', () => {
  it('is empty before anyone has a home city', () => {
    expect(pawns(replay([{ type: 'joined', seat: 'red', name: 'ADA' }])).size).toBe(0);
  });

  it('puts a baron on their home city node', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }
    ]);
    expect(pawns(state).get(nodeForCity(43))).toEqual(['red']);
  });

  it('stacks two barons standing on the same node', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'GRACE' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(43), nodeForCity(47)], arrived: false }
    ]);
    expect(pawns(state).get(nodeForCity(47))).toEqual(['red', 'green']);
  });
});
