import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeForCity } from '../../engine';
import { STORAGE_KEY, saveLog } from './storage';
import type { GameEvent } from './events';
import { useGame } from './useGame';
import { needsDestination } from './turns';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);

/** Feeds exact die faces so a roll is never a guess. */
const dice = (...faces: number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) return Math.random();
    return (face - 1) / 6;
  };
};

const seated: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' }
];

/**
 * `seated` plus red's destination: Minneapolis (home) to St. Paul, one of
 * the board's only two real, zero-paying journeys. Rolling movement dice
 * needs a destination to move toward, so any test that gets past that guard
 * builds on this rather than on `seated` alone — and using the $0 journey
 * here means the payout takes the same path a real one would, so a
 * downstream `if (payout)` bug would show up as a test failure.
 */
const underway: GameEvent[] = [
  ...seated,
  { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
];

/**
 * `underway` plus green's own destination — St. Paul (green's home) back to
 * Minneapolis, the same $0 pair in reverse. Needed wherever a test means to
 * isolate a guard that fires *after* `needsDestination`, such as the turn
 * check: with only `underway`, green still owes a destination of its own,
 * so `rollDice('green')` would be refused by that guard regardless of whose
 * turn it is, and the turn check would never actually run.
 */
const bothUnderway: GameEvent[] = [
  ...underway,
  { type: 'arrived', seat: 'green', city: 43, region: 'PL', payout: 0 }
];

beforeEach(() => localStorage.clear());

describe('rolling the movement dice', () => {
  it('hands back the dice without putting them in the log', () => {
    saveLog(underway);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    let rolled: unknown;
    act(() => { rolled = result.current.rollDice('red'); });
    expect(rolled).toEqual({ white: [3, 4], bonus: null });
    expect(result.current.state.rolled).toBeNull();
  });

  it('reaches the log only through commitDice', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    act(() => { result.current.commitDice('red', { white: [3, 4], bonus: null }); });
    expect(result.current.state.rolled).toEqual({ white: [3, 4], bonus: null });
  });

  it('refuses a baron whose turn it is not', () => {
    saveLog(bothUnderway);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    expect(result.current.rollDice('green')).toBeNull();
  });

  it('refuses a second roll inside one turn', () => {
    saveLog([...underway, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }]);
    const { result } = renderHook(() => useGame(dice(1, 1)));
    expect(result.current.rollDice('red')).toBeNull();
  });

  it('refuses movement dice to a baron who still owes a destination roll', () => {
    // seated: red holds only a home town — the state right after homes and
    // turn order, before their first trip has anywhere to go. A destination
    // is rolled once per trip, at its start; movement dice every turn in
    // between. A baron with nowhere to go yet cannot roll to move.
    saveLog(seated);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    expect(result.current.rollDice('red')).toBeNull();
  });
});

/**
 * The third gate, and the same split as the other two: the face is handed
 * back, announced by the drums, and only `commitBonus` puts it in the log.
 *
 * Everything here is a Freight, so a double six is the entitlement.
 */
describe('rolling the Bonus Roll', () => {
  /** Red rolls a double six and walks it without arriving. */
  const owed: GameEvent[] = [...underway,
    { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
    { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }];

  it('hands back a face without putting it in the log', () => {
    saveLog(owed);
    const { result } = renderHook(() => useGame(dice(3)));
    expect(result.current.state.bonusOwed).toBe(true);
    let face: unknown;
    act(() => { face = result.current.rollBonus('red'); });
    expect(face).toBe(3);
    expect(result.current.state.rolled).toEqual({ white: [6, 6], bonus: null });
  });

  it('reaches the log only through commitBonus', () => {
    saveLog(owed);
    const { result } = renderHook(() => useGame(dice(3)));
    act(() => { result.current.commitBonus('red', 3); });
    expect(result.current.state.rolled).toEqual({ white: [6, 6], bonus: 3 });
    expect(result.current.state.bonusOwed).toBe(false);
  });

  it('refuses one on a turn whose white pair earned nothing', () => {
    saveLog([...underway,
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }]);
    const { result } = renderHook(() => useGame(dice(3)));
    expect(result.current.rollBonus('red')).toBeNull();
  });

  it('refuses one before the white movement has been walked', () => {
    // The whole point of the staging: a player who knew the face here would
    // be planning an eighteen-dot route.
    saveLog([...underway, { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null }]);
    const { result } = renderHook(() => useGame(dice(3)));
    expect(result.current.rollBonus('red')).toBeNull();
  });

  it('refuses a second one inside the turn', () => {
    saveLog([...owed, { type: 'bonusRolled', seat: 'red', face: 3 }]);
    const { result } = renderHook(() => useGame(dice(5)));
    expect(result.current.rollBonus('red')).toBeNull();
  });

  it('refuses a baron whose turn it is not', () => {
    // Built on `bothUnderway` for the reason that fixture exists: green must
    // reach the turn check to be refused by it. On `owed` (which is
    // `underway`, where green has no destination of its own) `needsDestination`
    // fires first and this passes with the turn check deleted — the guard would
    // be masked and the test would be pinning nothing.
    //
    // Here green clears every later guard: a destination in hand, and the
    // open turn is entitled with its white leg walked and no face on the die,
    // so `state.bonusOwed` is true. The only thing wrong is whose turn it is.
    saveLog([...bothUnderway,
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }]);
    const { result } = renderHook(() => useGame(dice(3)));
    expect(result.current.state.turn, 'it is red who is owed the roll').toBe('red');
    expect(result.current.state.bonusOwed).toBe(true);
    expect(needsDestination(result.current.state.seats.green, nodeForCity),
           'and green would otherwise be waved through').toBe(false);

    expect(result.current.rollBonus('green')).toBeNull();
  });

  it('waits for the new destination when the white leg arrived', () => {
    // The book's order after an arrival: the baron is paid and rolls a new
    // destination, and the Bonus Roll starts that new trip. Rolling the die
    // first would be a face in hand with nowhere to spend it.
    const arrivedFirst: GameEvent[] = [...underway,
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    saveLog(arrivedFirst);
    const { result } = renderHook(() => useGame(dice(3)));
    expect(result.current.state.bonusOwed, 'the turn is still open').toBe(true);
    expect(result.current.rollBonus('red'), 'but the destination comes first').toBeNull();

    act(() => {
      saveLog([...arrivedFirst,
        { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: 0 }]);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current.rollBonus('red')).toBe(3);
  });
});

describe('rolling a destination', () => {
  it('refuses one mid-trip', () => {
    saveLog([...seated,
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }]);
    const { result } = renderHook(() => useGame(Math.random));
    expect(result.current.roll('red')).toBeNull();
  });

  it('refuses a home city another baron already holds', () => {
    // Only red is seated and homed; green's home roll must avoid red's city.
    saveLog([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'GRACE' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }
    ]);
    const { result } = renderHook(() => useGame(Math.random));
    for (let attempt = 0; attempt < 40; attempt++) {
      const outcome = result.current.roll('green');
      expect(outcome).not.toBeNull();
      expect((outcome as { city: number }).city).not.toBe(43);
    }
  });
});

describe('committing a move', () => {
  it('appends one leg and moves the pawn', () => {
    saveLog([...underway,
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }]);
    const { result } = renderHook(() => useGame(Math.random));
    act(() => { result.current.commitMove('red', [MINNEAPOLIS, ST_PAUL], true); });
    expect(result.current.state.seats.red.at).toBe(ST_PAUL);
    expect(result.current.state.turn).toBe('green');
  });
});

describe('a second tab', () => {
  it('follows the log when another tab writes it', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(Math.random));
    expect(result.current.state.turn).toBe('red');

    // What another tab's write looks like from in here: the store already
    // holds the new log, and the event says which key moved.
    act(() => {
      saveLog([...seated,
        { type: 'turnRolled', seat: 'red', white: [2, 2], bonus: null }]);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current.state.rolled).toEqual({ white: [2, 2], bonus: null });
  });

  it('ignores a key that is not ours', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(Math.random));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'acquire:log:v1' }));
    });
    expect(result.current.state.turn).toBe('red');
  });
});
