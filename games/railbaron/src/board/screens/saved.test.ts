import { describe, expect, it } from 'vitest';
import { saved } from './saved';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';
import { BOARD_ROWS } from '../types';

const DAY = 86_400_000;

const game: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: 4500 },
  { type: 'arrived', seat: 'blue', city: 4, region: 'NE', payout: 8500 }
];

const screen = (now = 0, savedAt: number | null = 0) => saved(replay(game), savedAt, now);

describe('the saved-game screen', () => {
  it('offers continue and new game as the first two choices', () => {
    expect(screen().rows[0]!.text).toBe('CONTINUE GAME');
    expect(screen().rows[1]!.text).toBe('NEW GAME');
  });

  it('sends new game through a confirmation rather than discarding at once', () => {
    expect(screen().rows[1]!.action).toEqual({ kind: 'navigate', to: 'confirm' });
  });

  it('summarises the roster in one row, so six barons still fit seven rows', () => {
    const rows = screen().rows;
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(rows[2]!.right).toBe('2 barons · Turn 1');
  });

  it('names the leader and what they have earned', () => {
    const summary = screen().rows[2]!;
    expect(summary.text).toBe('MARGO');
    expect(summary.amount).toBe('8,500');
    expect(summary.showDollar).toBe(true);
    expect(summary.chip).toBe('#2f7fe8');
  });

  it('says how long ago the game was saved', () => {
    expect(screen(2 * DAY, 0).rows[0]!.status).toBe('2 days ago');
    expect(screen(DAY, 0).rows[0]!.status).toBe('1 day ago');
    expect(screen(0, 0).rows[0]!.status).toBe('Just now');
  });

  it('says only that it is saved when the record predates timestamps', () => {
    expect(screen(0, null).rows[0]!.status).toBe('Saved');
  });

  it('still fits seven rows with six barons, which is what the summary is for', () => {
    const six: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'MARGO' },
      { type: 'joined', seat: 'blue', name: 'DEV' },
      { type: 'joined', seat: 'yellow', name: 'KIT' },
      { type: 'joined', seat: 'black', name: 'RAY' },
      { type: 'joined', seat: 'white', name: 'SAM' },
      { type: 'started' }
    ];
    const rows = saved(replay(six), 0, 0).rows;
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(rows[2]!.right).toBe('6 barons · Turn 0');
  });
});
