import { describe, expect, it } from 'vitest';
import { passAndPlay } from './passAndPlay';
import { replay } from '../../state/game';
import type { GameEvent } from '../../state/events';
import { BOARD_ROWS } from '../types';

const state = (events: GameEvent[]) => replay(events);
const rowsFor = (events: GameEvent[]) => passAndPlay(state(events)).rows;
const startRow = (events: GameEvent[]) => rowsFor(events)[BOARD_ROWS - 1]!;

const two: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' }
];

describe('the pass-and-play setup screen', () => {
  it('offers all six seats plus a start row', () => {
    const rows = rowsFor([]);
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(rows[0]!.text).toBe('TAP TO JOIN');
    expect(rows[5]!.text).toBe('TAP TO JOIN');
    expect(rows[6]!.text).toBe('START GAME');
  });

  it('lets an empty seat be typed into', () => {
    expect(rowsFor([])[0]!.action).toEqual({
      kind: 'edit', field: 'seat:red', placeholder: 'Type a name, press Enter'
    });
  });

  it('shows a taken seat by name and still lets it be edited', () => {
    const row = rowsFor([{ type: 'joined', seat: 'red', name: 'ADA' }])[0]!;
    expect(row.text).toBe('ADA');
    expect(row.right).toBe('Tap to edit');
    expect(row.action).toEqual({
      kind: 'edit', field: 'seat:red', placeholder: 'Type a name, press Enter'
    });
  });

  it('holds the start row shut below two barons', () => {
    expect(startRow([]).tone).toBe('disabled');
    expect(startRow([]).action).toBeNull();
    expect(startRow([]).right).toBe('Need 2 seats');
    expect(startRow([{ type: 'joined', seat: 'red', name: 'ADA' }]).tone).toBe('disabled');
  });

  it('opens the start row at two barons', () => {
    expect(startRow(two).tone).toBe('normal');
    expect(startRow(two).action).toEqual({ kind: 'navigate', to: 'play' });
  });

  it('carries each seat its own colour once taken', () => {
    // SEATS order is red, green, blue, … so green is the second row.
    expect(rowsFor([{ type: 'joined', seat: 'green', name: 'DEV' }])[1]!.chip).toBe('#5fbb2e');
  });

  it('leaves an untaken seat without a colour', () => {
    expect(rowsFor([])[0]!.chip).toBeNull();
  });

  it('counts a vacated seat as empty again', () => {
    const vacated: GameEvent[] = [...two, { type: 'renamed', seat: 'blue', name: null }];
    expect(startRow(vacated).tone).toBe('disabled');
    expect(rowsFor(vacated)[2]!.text).toBe('TAP TO JOIN');
  });

  it('goes back to the mode select', () => {
    expect(passAndPlay(state([])).back).toBe('home');
  });
});
