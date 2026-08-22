import { describe, expect, it } from 'vitest';
import { payoutBetween } from '../../engine/index.js';
import type { GameEvent } from './events';
import { appendLegality, undoLegality } from './legal';

/**
 * The log the server seeds at Begin for a red/blue game, plus whatever the
 * story adds. Every fixture reads as a story from this prefix, because that
 * is exactly what a real online log is.
 */
const seeded = (...rest: GameEvent[]): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'BEN' },
  { type: 'started' },
  ...rest,
];

// Real board data, checked against engine/cities.ts and engine/network.json
// rather than remembered: city 20 is Chicago (NC, node c24), city 9 is Atlanta
// (SE, node c64), and d122 is a real neighbour of Chicago. Region mismatches
// are isGameEvent's job and arrive pre-checked; legality only decides *when* —
// but a fixture that lied about the board would still be a fixture that lies.
const redHome: GameEvent =
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };
const blueHome: GameEvent =
  { type: 'arrived', seat: 'blue', city: 9, region: 'SE', payout: null };
const order: GameEvent = { type: 'orderRolled', seat: 'red', first: 'red' };
/** Red's first destination, so red no longer owes a destination roll. */
const redDestination: GameEvent =
  { type: 'arrived', seat: 'red', city: 9, region: 'SE', payout: payoutBetween(20, 9) };

/** Homes in, order rolled: phase `playing`, red to act, owing a destination. */
const afterOrder = seeded(redHome, blueHome, order);
/** Red has somewhere to go, so red owes a roll of the dice. */
const redRolling = seeded(redHome, blueHome, order, redDestination);

describe('appendLegality', () => {
  it('rejects joined, renamed and started from a client — the server seeds those', () => {
    for (const event of [
      { type: 'joined', seat: 'red', name: 'X' },
      { type: 'renamed', seat: 'red', name: 'X' },
      { type: 'started' },
    ] as GameEvent[]) {
      expect(appendLegality(seeded(), event, 'red')?.code).toBe('notNow');
    }
  });

  it('lets the next home seat roll its home, and only that seat', () => {
    expect(appendLegality(seeded(), redHome, 'red')).toBeNull();
    // Homes are rolled in seat order and red has not taken one yet.
    expect(appendLegality(seeded(), blueHome, 'blue')?.code).toBe('notNow');
    // Once red has a home, blue is the actor.
    expect(appendLegality(seeded(redHome), blueHome, 'blue')).toBeNull();
  });

  it('rejects an event whose seat is not the sender', () => {
    expect(appendLegality(seeded(), redHome, 'blue')?.code).toBe('notYourSeat');
  });

  it('lets any seated sender append orderRolled once homes are done — and only once', () => {
    // Homes are not done: blue still owes one.
    expect(appendLegality(seeded(redHome), order, 'red')?.code).toBe('notNow');
    // Done, and the roll for first player is a shared ceremony: red's event,
    // and red may send it.
    expect(appendLegality(seeded(redHome, blueHome), order, 'red')).toBeNull();
    // A second one has nothing to decide — the game is already playing.
    expect(appendLegality(afterOrder, order, 'red')?.code).toBe('notNow');
  });

  it('rejects orderRolled from a sender who holds no seat', () => {
    expect(appendLegality(seeded(redHome, blueHome), order, 'green')?.code)
      .toBe('notYourSeat');
  });

  it('lets the acting seat ask for a region, but not twice, and not out of turn', () => {
    const ask: GameEvent = { type: 'regionRequested', seat: 'red', rolled: 'SE' };
    expect(appendLegality(afterOrder, ask, 'red')).toBeNull();
    // Asked already: the ballot is open, and the answer is `arrived`.
    expect(appendLegality(seeded(redHome, blueHome, order, ask), ask, 'red')?.code)
      .toBe('notNow');
    // Red is the one playing.
    expect(appendLegality(afterOrder,
      { type: 'regionRequested', seat: 'blue', rolled: 'SE' }, 'blue')?.code)
      .toBe('notNow');
    // Red already has a destination, so no destination roll is owed.
    expect(appendLegality(redRolling, ask, 'red')?.code).toBe('notNow');
  });

  it('accepts the arrival that resolves an open region ballot', () => {
    const ask: GameEvent = { type: 'regionRequested', seat: 'red', rolled: 'SE' };
    expect(appendLegality(seeded(redHome, blueHome, order, ask), redDestination, 'red'))
      .toBeNull();
  });

  it('rejects a turn roll out of turn, before a destination, and twice over', () => {
    const redRoll: GameEvent =
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null };
    // Not blue's turn.
    expect(appendLegality(redRolling,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue')?.code)
      .toBe('notNow');
    // Red owes a destination before it owes a roll.
    expect(appendLegality(afterOrder, redRoll, 'red')?.code).toBe('notNow');
    // With a destination in hand, the roll is red's to make.
    expect(appendLegality(redRolling, redRoll, 'red')).toBeNull();
    // The turn already has its dice.
    expect(appendLegality([...redRolling, redRoll], redRoll, 'red')?.code).toBe('notNow');
  });

  it('rejects bonusRolled when none is owed, and accepts it when one is', () => {
    const bonus: GameEvent = { type: 'bonusRolled', seat: 'red', face: 5 };
    // No turn open at all.
    expect(appendLegality(redRolling, bonus, 'red')?.code).toBe('notNow');
    // A freight train earns a Bonus Roll on double sixes and nothing else, so
    // 3-4 is a turn that never owes one however far it walks.
    const plainTurn: GameEvent[] = [...redRolling,
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c24', 'd122'], arrived: false }];
    expect(appendLegality(plainTurn, bonus, 'red')?.code).toBe('notNow');
    // Double sixes, and the white leg walked: now the die is owed.
    const owedTurn: GameEvent[] = [...redRolling,
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: ['c24', 'd122'], arrived: false }];
    expect(appendLegality(owedTurn, bonus, 'red')).toBeNull();
    // Entitled, but the white leg has not been walked yet.
    expect(appendLegality([...redRolling,
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null }],
      bonus, 'red')?.code).toBe('notNow');
  });

  it('rejects a move with no roll behind it, and accepts one with', () => {
    const move: GameEvent =
      { type: 'moved', seat: 'red', path: ['c24', 'd122'], arrived: false };
    expect(appendLegality(redRolling, move, 'red')?.code).toBe('notNow');
    expect(appendLegality([...redRolling,
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }],
      move, 'red')).toBeNull();
  });
});

describe('undoLegality', () => {
  it('grants undo only to the seat whose action would be popped', () => {
    const log: GameEvent[] = [...redRolling,
      { type: 'turnRolled', seat: 'red', white: [2, 3], bonus: null }];
    expect(undoLegality(log, 'red')).toBeNull();
    expect(undoLegality(log, 'blue')?.code).toBe('notYourUndo');
  });

  it('refuses to undo into the seeded prefix', () => {
    expect(undoLegality(seeded(), 'red')?.code).toBe('nothingToUndo');
    expect(undoLegality([], 'red')?.code).toBe('nothingToUndo');
  });
});
