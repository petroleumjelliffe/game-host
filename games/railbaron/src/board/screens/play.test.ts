import { describe, expect, it } from 'vitest';
import { REGIONS, nodeForCity } from '../../../engine';
import { diceFor, play } from './play';
import { replay } from '../../state/game';
import { SEATS, type GameEvent } from '../../state/events';
import { BOARD_ROWS } from '../types';

const log: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 }
];

const rows = (events: GameEvent[] = log) => play(replay(events)).rows;

describe('the in-play board', () => {
  it('shows one row per seated baron and blanks the rest', () => {
    expect(rows()).toHaveLength(BOARD_ROWS);
    expect(rows()[0]!.label).toBe('ADA');
    expect(rows()[1]!.label).toBe('MARGO');
    expect(rows()[2]!.action).toBeNull();
  });

  it('keeps the map on the last row whoever is playing', () => {
    const last = BOARD_ROWS - 1;
    expect(rows()[last]!.action).toEqual({ kind: 'navigate', to: 'map' });

    // Six barons fills every other row; the map must not be pushed off.
    const full: GameEvent[] = [
      ...SEATS.map((seat, i) => ({ type: 'joined' as const, seat, name: `B${i}` })),
      { type: 'started' }
    ];
    expect(rows(full)).toHaveLength(BOARD_ROWS);
    expect(rows(full)[last]!.action).toEqual({ kind: 'navigate', to: 'map' });
    expect(rows(full)[last - 1]!.label).toBe('B5');
  });

  it('declares every region as the panel vocabulary, whoever is on the board', () => {
    // Not derived from the rows: on the first roll of a game there is one
    // region on the board at most, and a panel that can only turn through
    // what is already showing announces the answer instead of withholding it.
    const declared = play(replay(log)).panel;
    expect(declared).toEqual(REGIONS.map(region => region.name));
  });

  it('makes a baron row roll when tapped', () => {
    expect(rows()[0]!.action).toEqual({ kind: 'act', seat: 'red' });
  });

  it('shows the latest destination and what it paid', () => {
    const row = rows()[0]!;
    expect(row.text).toBe('Chicago');
    expect(row.status).toBe('North Central');
    expect(row.amount).toBe('4,500');
    expect(row.showDollar).toBe(true);
  });

  it('leaves a baron who has not travelled with an empty destination', () => {
    expect(rows()[1]!.text).toBe('');
    expect(rows()[1]!.amount).toBe('');
  });

  it('says HOME rather than a payout for a home town', () => {
    const home: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null }
    ];
    expect(rows(home)[0]!.right).toBe('Home');
    // No figure — but the sign stays printed on the row, as it would on a
    // board. What says "no payout" is the empty field and the note.
    expect(rows(home)[0]!.amount).toBe('');
    expect(rows(home)[0]!.showDollar).toBe(true);
  });

  it('shows a zero-paying journey as a real zero, not as blank', () => {
    // Minneapolis to St. Paul really does pay nothing.
    const zero: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
    ];
    expect(rows(zero)[0]!.amount).toBe('0');
    expect(rows(zero)[0]!.showDollar).toBe(true);
  });
});

describe('strict turn order', () => {
  const playing: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'joined', seat: 'green', name: 'GRACE' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
    { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'green' }
  ];

  it('offers the roll only to the baron whose turn it is', () => {
    const rows = play(replay(playing)).rows;
    // green is first, and sits in the second row: seating order is unchanged.
    expect(rows[0]!.action).toBeNull();
    expect(rows[1]!.action).toEqual({ kind: 'act', seat: 'green' });
  });

  it('dims every baron who is not up, and marks the one owed a destination active', () => {
    const rows = play(replay(playing)).rows;
    expect(rows[0]!.tone).toBe('dim');
    // Green is up and owes a destination roll: this row is the tap, and the
    // board says so in amber rather than leaving "normal" to carry it.
    expect(rows[1]!.tone).toBe('active');
  });

  it('drops the active tone once the destination is rolled', () => {
    const rows = play(replay([...playing,
      { type: 'arrived', seat: 'green', city: 43, region: 'PL', payout: 0 }])).rows;
    expect(rows[1]!.tone).toBe('normal');
  });

  it('offers nothing once the destination is rolled — movement is on the map', () => {
    const rows = play(replay([...playing,
      { type: 'arrived', seat: 'green', city: 43, region: 'PL', payout: 0 }])).rows;
    expect(rows[1]!.action).toBeNull();
  });

  it('offers undo once anything has happened this game', () => {
    const rows = play(replay(playing)).rows;
    expect(rows.some(row => row.action?.kind === 'undo')).toBe(true);
  });

  it('offers no undo before the game has started', () => {
    const rows = play(replay(playing.slice(0, 2))).rows;
    expect(rows.some(row => row.action?.kind === 'undo')).toBe(false);
  });

  it('pins undo immediately above the map, not immediately after the barons', () => {
    // Two barons: three blank rows would separate undo from the map row if
    // undo were pushed before padding rather than written into a fixed slot.
    const rows = play(replay(playing)).rows;
    expect(rows[BOARD_ROWS - 2]!.action).toEqual({ kind: 'undo' });
    expect(rows[BOARD_ROWS - 1]!.action).toEqual({ kind: 'navigate', to: 'map' });
  });

  it('pins undo immediately above the map with five barons too', () => {
    // Five barons leave exactly one spare slot — the one case the old,
    // push-before-padding code happened to get right anyway.
    const five: GameEvent[] = [
      ...(['red', 'green', 'blue', 'yellow', 'black'] as const)
        .map(seat => ({ type: 'joined', seat, name: seat.toUpperCase() }) as GameEvent),
      { type: 'started' },
      { type: 'orderRolled', seat: 'red', first: 'red' }
    ];
    const rows = play(replay(five)).rows;
    expect(rows[BOARD_ROWS - 2]!.action).toEqual({ kind: 'undo' });
    expect(rows[BOARD_ROWS - 1]!.action).toEqual({ kind: 'navigate', to: 'map' });
  });

  it('leaves undo off a full board rather than growing past seven rows', () => {
    const full: GameEvent[] = [
      ...(['red', 'green', 'blue', 'yellow', 'black', 'white'] as const)
        .map(seat => ({ type: 'joined', seat, name: seat.toUpperCase() }) as GameEvent),
      { type: 'started' },
      { type: 'orderRolled', seat: 'red', first: 'red' }
    ];
    const screen = play(replay(full));
    expect(screen.rows).toHaveLength(7);
    expect(screen.rows.some(row => row.action?.kind === 'undo')).toBe(false);
  });
});

/**
 * The readout both surfaces share. Two live states now, because a turn holds
 * two rolls: the white pair at the start, and the Bonus Roll once the white
 * movement has been walked. The `pending*` arguments are the roll that has
 * been made but not yet told by the drums — the gate that keeps a face out of
 * the log until the table has seen it.
 */
describe('the dice the board and the map both show', () => {
  const MINNEAPOLIS = nodeForCity(43);
  const ST_PAUL = nodeForCity(47);
  /** ADA is up, standing in Minneapolis and bound for St. Paul. */
  const upNext: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'joined', seat: 'blue', name: 'MARGO' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
    { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
  ];
  const doubleSix: GameEvent[] = [...upNext,
    { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null }];

  const dice = (events: GameEvent[], pendingDice = null, pendingBonus: number | null = null) =>
    diceFor(replay(events), pendingDice, pendingBonus);

  it('is live for the white pair when the baron up has somewhere to go and no dice', () => {
    expect(dice(upNext)).toEqual({ roll: null, live: true, mine: true });
  });

  it('goes dead while a rolled pair is waiting on the drums', () => {
    const pending = { white: [6, 6] as [number, number], bonus: null };
    expect(diceFor(replay(upNext), pending)).toEqual({ roll: pending, live: false, mine: true });
  });

  it('is mine only on the seated actor\'s own device', () => {
    // red is up. The shared tablet ('all') always owns the dice; online, only
    // the actor's device does — the glow must not light a spectator's phone.
    expect(diceFor(replay(upNext), null, null, 'all').mine).toBe(true);
    expect(diceFor(replay(upNext), null, null, 'red').mine).toBe(true);
    expect(diceFor(replay(upNext), null, null, 'green').mine).toBe(false);
  });

  it('goes dead once the whites are in the log and the leg is being walked', () => {
    expect(dice(doubleSix).live).toBe(false);
  });

  it('comes live again for a Bonus Roll owed after the white leg', () => {
    const owed: GameEvent[] = [...doubleSix,
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }];
    const shown = dice(owed);
    expect(shown.live).toBe(true);
    expect(shown.roll, 'the whites are still lying on the table')
      .toEqual({ white: [6, 6], bonus: null });
  });

  it('stays dead when the white leg arrived and a destination is owed first', () => {
    const arrived: GameEvent[] = [...doubleSix,
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    expect(dice(arrived).live).toBe(false);
  });

  it('shows a bonus face still on the drums riding on the whites already logged', () => {
    // One roll of one turn, not a second pair of dice: the white faces come
    // from the log, the bonus from the hand that has not told it yet.
    const owed: GameEvent[] = [...doubleSix,
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }];
    expect(dice(owed, null, 4)).toEqual({ roll: { white: [6, 6], bonus: 4 }, live: false, mine: true });
  });

  it('goes dead for everyone once no baron is up', () => {
    expect(dice(log).live).toBe(false);
  });
});
