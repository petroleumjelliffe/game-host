import { describe, expect, it } from 'vitest';
import { replay, undo } from './game';
import type { GameEvent } from './events';
import { nodeForCity } from '../../engine';
import { destinationOf, homesDone, needsDestination, nextHomeSeat, rotate } from './turns';

const join = (seat: 'red' | 'blue', name: string): GameEvent =>
  ({ type: 'joined', seat, name });

describe('replaying the log', () => {
  it('starts with six empty seats', () => {
    const state = replay([]);
    expect(Object.keys(state.seats)).toHaveLength(6);
    expect(state.seats.red.name).toBeNull();
    expect(state.seats.red.stops).toEqual([]);
    expect(state.seats.red.awaiting).toBeNull();
  });

  it('seats a player by name', () => {
    expect(replay([join('red', 'Pete')]).seats.red.name).toBe('Pete');
  });

  it('records a home town with no payout', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    expect(state.seats.red.stops).toEqual([{ city: 20, region: 'NC', payout: null }]);
  });

  it('keeps a zero payout as zero rather than losing it', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
    ]);
    expect(state.seats.red.stops[1]!.payout).toBe(0);
  });

  it('holds a seat waiting once a region has been requested', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' }
    ]);
    expect(state.seats.red.awaiting).toBe('NC');
  });

  it('clears the wait when the baron arrives somewhere', () => {
    const state = replay([
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null },
      { type: 'regionRequested', seat: 'red', rolled: 'NC' },
      { type: 'arrived', seat: 'red', city: 59, region: 'SW', payout: 22000 }
    ]);
    expect(state.seats.red.awaiting).toBeNull();
    expect(state.seats.red.stops).toHaveLength(2);
  });

  it('keeps seats independent', () => {
    const state = replay([join('red', 'Pete'), join('blue', 'Sam')]);
    expect(state.seats.red.name).toBe('Pete');
    expect(state.seats.blue.name).toBe('Sam');
    expect(state.seats.green.name).toBeNull();
  });

  it('is a pure fold — replaying twice gives the same answer', () => {
    const log: GameEvent[] = [
      join('red', 'Pete'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ];
    expect(replay(log)).toEqual(replay(log));
  });
});

describe('the begin gate', () => {
  it('starts in setup, with no game under way', () => {
    expect(replay([]).phase).toBe('setup');
    expect(replay([join('red', 'ADA')]).phase).toBe('setup');
  });

  it('leaves setup once the log says it started, landing in homes rather than playing', () => {
    // `started` alone is not enough to reach `playing` under the new model —
    // that also needs `orderRolled`, covered by `the phases` below. This
    // pins the other half: the gate does open, moving the game somewhere,
    // not nowhere.
    const state = replay([join('red', 'ADA'), { type: 'started' }]);
    expect(state.phase).not.toBe('setup');
    expect(state.phase).toBe('homes');
  });
});

describe('renaming a seat', () => {
  it('changes the name without disturbing the journeys', () => {
    const state = replay([
      join('red', 'ADA'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
      { type: 'renamed', seat: 'red', name: 'MARGO' }
    ]);
    expect(state.seats.red.name).toBe('MARGO');
    expect(state.seats.red.stops).toHaveLength(1);
  });

  it('vacates the seat when the name is cleared', () => {
    const state = replay([join('red', 'ADA'), { type: 'renamed', seat: 'red', name: null }]);
    expect(state.seats.red.name).toBeNull();
  });
});

describe('what a seat has earned', () => {
  it('sums the payouts, counting a zero-paying journey as zero', () => {
    const state = replay([
      join('red', 'ADA'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'arrived', seat: 'red', city: 59, region: 'SW', payout: 8500 }
    ]);
    expect(state.seats.red.earned).toBe(13000);
  });

  it('ignores home towns, which pay nothing at all', () => {
    const state = replay([
      join('red', 'ADA'),
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ]);
    expect(state.seats.red.earned).toBe(0);
  });
});

describe('undo', () => {
  it('does nothing during setup — a taken seat is renamed, not undone', () => {
    const log: GameEvent[] = [join('red', 'ADA')];
    expect(undo(log)).toEqual(log);
  });

  it('refuses to rewind back across the start of the game', () => {
    const log: GameEvent[] = [join('red', 'ADA'), { type: 'started' }];
    expect(undo(log)).toEqual(log);
  });

  it('takes back the last move once play is under way', () => {
    const log: GameEvent[] = [
      join('red', 'ADA'),
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 }
    ];
    expect(undo(log)).toHaveLength(2);
    expect(replay(undo(log)).seats.red.stops).toEqual([]);
  });

  it('does nothing to an empty log', () => {
    expect(undo([])).toEqual([]);
  });
});

const MINNEAPOLIS_CITY = 43;
const ST_PAUL_CITY = 47;
const MINNEAPOLIS = nodeForCity(MINNEAPOLIS_CITY);
const ST_PAUL = nodeForCity(ST_PAUL_CITY);

/** Two seated barons, started, homes rolled, order settled on green. */
const twoBarons: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: MINNEAPOLIS_CITY, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: ST_PAUL_CITY, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'green' }
];

describe('the phases', () => {
  it('is setup before the game has started', () => {
    expect(replay([{ type: 'joined', seat: 'red', name: 'ADA' }]).phase).toBe('setup');
  });

  it('is homes once started, while home cities are still being rolled', () => {
    expect(replay(twoBarons.slice(0, 3)).phase).toBe('homes');
  });

  it('is playing once the order has been rolled', () => {
    expect(replay(twoBarons).phase).toBe('playing');
  });

  it('resumes a game saved before turn order existed in the homes phase', () => {
    // A v1.0.1 log: started, destinations rolled, no orderRolled. It lands in
    // `homes` with every home already in, so the only thing left is the roll
    // for first player — no migration code, and nothing discarded.
    const old = twoBarons.slice(0, 5);
    const state = replay(old);
    expect(state.phase).toBe('homes');
    expect(homesDone(state)).toBe(true);
  });
});

describe('where a pawn stands', () => {
  it('is nowhere until a home city is rolled', () => {
    expect(replay(twoBarons.slice(0, 3)).seats.red.at).toBeNull();
  });

  it('is the home city once one is', () => {
    expect(replay(twoBarons).seats.red.at).toBe(MINNEAPOLIS);
  });

  it('does not move when a destination is rolled', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 }];
    expect(replay(log).seats.red.at).toBe(MINNEAPOLIS);
    expect(destinationOf(replay(log).seats.red)).toBe(ST_PAUL_CITY);
  });

  it('is the last node of the last leg once one has been walked', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    expect(replay(log).seats.red.at).toBe(ST_PAUL);
  });
});

describe('the sections a trip has spent', () => {
  const trip = (arrived: boolean): GameEvent[] => [...twoBarons,
    { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
    { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived }];

  it('records every section a leg crossed', () => {
    expect(replay(trip(false)).seats.red.used.size).toBe(1);
  });

  it('releases them all on arrival', () => {
    expect(replay(trip(true)).seats.red.used.size).toBe(0);
  });
});

describe('turn order', () => {
  it('rotates the seated barons to start with the high roll', () => {
    expect(rotate(['red', 'green', 'blue'], 'green')).toEqual(['green', 'blue', 'red']);
    expect(rotate(['red', 'green', 'blue'], 'red')).toEqual(['red', 'green', 'blue']);
  });

  it('gives the first turn to whoever won the roll', () => {
    const state = replay(twoBarons);
    expect(state.order).toEqual(['green', 'red']);
    expect(state.turn).toBe('green');
  });

  it('stays with a baron whose turn is under way', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null }];
    const state = replay(log);
    expect(state.turn).toBe('green');
    expect(state.rolled).toEqual({ white: [3, 4], bonus: null });
  });

  it('passes to the left once the turn is spent', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    const state = replay(log);
    expect(state.turn).toBe('red');
    expect(state.rolled).toBeNull();
  });

  // The three that follow are logs from before the Bonus Roll moved to after
  // the white movement: their face is already in `turnRolled`, which is the
  // one thing replay treats as the legacy pre-rolled form. They are kept
  // exactly as they were, because a game saved on a tablet then must replay
  // into the same game now. The staging as it is played today is pinned in
  // "a turn that earns a Bonus Roll" below.
  it('keeps the turn when a pre-rolled bonus leg is still owed', () => {
    // Arrived inside the white dice with a bonus die rolled: the book has the
    // player roll a new destination and spend the bonus starting that trip.
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    const state = replay(log);
    expect(state.turn).toBe('green');
    expect(state.rolled).toEqual({ white: [6, 6], bonus: 4 });
  });

  it('ends the turn after a pre-rolled bonus leg', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true },
      { type: 'arrived', seat: 'green', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
      { type: 'moved', seat: 'green', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    expect(replay(log).turn).toBe('red');
  });

  it('ends a pre-rolled turn that did not arrive, as that form always did', () => {
    // The distinguishing case, and the reason the legacy branch exists at all.
    // In the pre-rolled form the whole roll was one continuous run — white and
    // bonus together — so a leg that stopped short of the destination had
    // spent all of it and the turn was over. Under the staging as played now
    // the same white pair would leave a Bonus Roll owed. A saved game must
    // replay into the game that was played, not the game it would be today.
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: false }];
    const state = replay(log);
    expect(state.turn).toBe('red');
    expect(state.rolled).toBeNull();
    expect(state.bonusOwed, 'a pre-rolled turn never owes one — its face was in hand')
      .toBe(false);
  });

  it('counts the leg so a pre-rolled bonus leg knows what it has to spend', () => {
    const base: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 }];
    expect(replay(base).leg).toBe(0);
    const after: GameEvent[] = [...base,
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    expect(replay(after).leg).toBe(1);
  });
});

/**
 * The Bonus Roll as it is actually played: the white pair is rolled and
 * announced, entitlement is fixed at that moment by the doubles rules, the
 * pawn walks the whites, and only then is the die thrown — its own roll, its
 * own event. Playtest is what settled the order, because a player who knows
 * the bonus face while walking the whites plans an eighteen-dot route and a
 * player at the table cannot.
 *
 * Every baron is on a Freight, so double six is the entitlement here.
 */
describe('a turn that earns a Bonus Roll', () => {
  const upNext: GameEvent[] = [...twoBarons,
    { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 }];
  const doubleSix: GameEvent[] = [...upNext,
    { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: null }];
  const whiteLeg = (arrived: boolean): GameEvent =>
    ({ type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived });

  it('is not holding the face when the whites land', () => {
    const state = replay(doubleSix);
    expect(state.rolled).toEqual({ white: [6, 6], bonus: null });
    expect(state.bonusOwed, 'nothing is owed until the white leg has been walked')
      .toBe(false);
  });

  it('keeps the turn open after a white leg that did not arrive', () => {
    // "If entitled, he must take it." This is the case the first draft of the
    // spec had wrong: it ended the turn here, because it thought a bonus leg
    // was only owed when the pawn arrived inside the white dice. Entitlement
    // is fixed by the white pair and has nothing to do with arriving — a leg
    // that stops in open country still owes its Bonus Roll.
    const state = replay([...doubleSix, whiteLeg(false)]);
    expect(state.turn, 'the turn cannot advance past an untaken entitlement').toBe('green');
    expect(state.bonusOwed).toBe(true);
    expect(state.leg).toBe(1);
  });

  it('keeps it open after one that did, for the new destination and then the die', () => {
    const state = replay([...doubleSix, whiteLeg(true)]);
    expect(state.turn).toBe('green');
    expect(state.bonusOwed).toBe(true);
  });

  it('ends the turn after one leg when the white pair earned nothing', () => {
    const state = replay([...upNext,
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
      whiteLeg(false)]);
    expect(state.turn).toBe('red');
    expect(state.bonusOwed).toBe(false);
    expect(state.rolled).toBeNull();
  });

  it('takes the face from the bonusRolled event, and stops owing one', () => {
    // This is what hands the second leg its movement: `state.rolled.bonus`
    // going non-null is what `useRoute` spends on the bonus leg.
    const state = replay([...doubleSix, whiteLeg(false),
      { type: 'bonusRolled', seat: 'green', face: 3 }]);
    expect(state.rolled).toEqual({ white: [6, 6], bonus: 3 });
    expect(state.bonusOwed).toBe(false);
    expect(state.turn).toBe('green');
    expect(state.leg).toBe(1);
  });

  it('ends the turn after the bonus leg, and not before', () => {
    const state = replay([...doubleSix, whiteLeg(false),
      { type: 'bonusRolled', seat: 'green', face: 3 },
      { type: 'moved', seat: 'green', path: [MINNEAPOLIS, ST_PAUL], arrived: true }]);
    expect(state.turn).toBe('red');
    expect(state.rolled).toBeNull();
    expect(state.bonusOwed).toBe(false);
  });

  it('owes nothing on a turn that has not rolled at all', () => {
    expect(replay(upNext).bonusOwed).toBe(false);
  });

  /**
   * Logs this app could not have written. Replay has to stay coherent on any
   * log it is handed — it already refuses a `bonusRolled` with no turn open —
   * and the ordering cases are the ones that would quietly change the game
   * rather than merely look odd.
   */
  describe('a bonusRolled that could not have been written by this app', () => {
    it('does not put the face on a turn whose white leg is still unwalked', () => {
      // The damaging one. With the face on the roll before `moved`, leg 0's
      // `movement()` spends white+bonus — fifteen — and then leg 1 is offered
      // the same face again: an eighteen-dot turn out of a fifteen-dot roll.
      // Ignoring it leaves the die owed, which is what the log goes on to say.
      const early: GameEvent[] = [...doubleSix,
        { type: 'bonusRolled', seat: 'green', face: 3 }];
      expect(replay(early).rolled, 'the face is not in hand yet')
        .toEqual({ white: [6, 6], bonus: null });

      const andWalked: GameEvent[] = [...early, whiteLeg(false)];
      const state = replay(andWalked);
      expect(state.rolled, 'and the white leg spent the whites alone')
        .toEqual({ white: [6, 6], bonus: null });
      expect(state.bonusOwed, 'the die is still owed, not already spent').toBe(true);
    });

    it('does not put a second face on a turn that already threw', () => {
      const twice: GameEvent[] = [...doubleSix, whiteLeg(false),
        { type: 'bonusRolled', seat: 'green', face: 3 },
        { type: 'bonusRolled', seat: 'green', face: 6 }];
      expect(replay(twice).rolled).toEqual({ white: [6, 6], bonus: 3 });
    });

    it('does not put one on a turn that earned nothing', () => {
      const unearned: GameEvent[] = [...upNext,
        { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
        { type: 'bonusRolled', seat: 'green', face: 3 }];
      expect(replay(unearned).rolled).toEqual({ white: [3, 4], bonus: null });
    });

    it('does not invent a turn to hold one', () => {
      const orphan: GameEvent[] = [...upNext,
        { type: 'bonusRolled', seat: 'green', face: 3 }];
      expect(replay(orphan).rolled).toBeNull();
      expect(replay(orphan).turn).toBe('green');
    });
  });
});

/**
 * A turn is no longer one event, so neither is taking one back. The row that
 * offers this says "Take back a turn"; these are what make that true.
 */
describe('undo takes back a whole turn', () => {
  /** GREEN is up, standing in St. Paul and bound for Minneapolis. */
  const upNext: GameEvent[] = [...twoBarons,
    { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 }];

  const shorterBy = (log: GameEvent[]) => log.length - undo(log).length;

  it('pops the roll and the leg together, and hands the turn back', () => {
    const log: GameEvent[] = [...upNext,
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    expect(replay(log).turn, 'the turn had passed on').toBe('red');

    expect(shorterBy(log)).toBe(2);
    const state = replay(undo(log));
    expect(state.turn).toBe('green');
    expect(state.rolled).toBeNull();
    expect(state.seats.green.at).toBe(ST_PAUL);
  });

  it('pops all four events of a turn with a bonus leg', () => {
    // Arrived inside the white dice: paid, given a new destination, and the
    // bonus die spent starting that trip. One tap took back the last leg
    // alone and left the board mid-turn with dice still on the table.
    const log: GameEvent[] = [...upNext,
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true },
      { type: 'arrived', seat: 'green', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
      { type: 'moved', seat: 'green', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];

    expect(shorterBy(log)).toBe(4);
    expect(undo(log)).toEqual(upNext);
    const state = replay(undo(log));
    expect(state.turn).toBe('green');
    expect(state.rolled).toBeNull();
    expect(state.leg).toBe(0);
    expect(state.seats.green.stops).toHaveLength(2);
  });

  it('pops a roll that has not been walked yet, and nothing else', () => {
    const log: GameEvent[] = [...upNext,
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null }];
    expect(shorterBy(log)).toBe(1);
    expect(replay(undo(log)).rolled).toBeNull();
    expect(replay(undo(log)).turn).toBe('green');
  });

  it('pops a destination on its own — it is its own action, not a turn', () => {
    expect(shorterBy(upNext)).toBe(1);
    expect(undo(upNext)).toEqual(twoBarons);
  });

  it('pops a region ballot on its own too', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'regionRequested', seat: 'green', rolled: 'PL' }];
    expect(shorterBy(log)).toBe(1);
    expect(replay(undo(log)).seats.green.awaiting).toBeNull();
  });
});

describe('who may be given a destination', () => {
  const nodeOf = nodeForCity;

  it('may be, with no home city yet', () => {
    expect(needsDestination(replay(twoBarons.slice(0, 3)).seats.red, nodeOf)).toBe(true);
  });

  it('may be, standing on the last destination reached', () => {
    expect(needsDestination(replay(twoBarons).seats.red, nodeOf)).toBe(true);
  });

  it('may not be, part-way along a trip', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 }];
    expect(needsDestination(replay(log).seats.red, nodeOf)).toBe(false);
  });
});

describe('whose home city is owed', () => {
  it('is the first seated baron without one, in seat order', () => {
    expect(nextHomeSeat(replay(twoBarons.slice(0, 3)))).toBe('red');
    expect(nextHomeSeat(replay(twoBarons.slice(0, 4)))).toBe('green');
    expect(nextHomeSeat(replay(twoBarons))).toBeNull();
  });
});

describe('the last committed move', () => {
  it('is nothing before anyone has moved', () => {
    expect(replay(twoBarons).lastMove).toBeNull();
  });

  it('is the most recent leg, whoever walked it', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    expect(replay(log).lastMove)
      .toEqual({ seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true });
  });
});
