/**
 * Coordinate arithmetic for the 15×15 board. Positions are row-major
 * integers 0..224; rows and columns are 0..14. `parseCoord` (the "H8" form)
 * is defined in constants.ts because the premium layout is built from it —
 * re-exported here so callers find every coordinate helper in one place.
 */
import { BOARD_SIZE, PREMIUMS, type Premium } from './constants.js';

export { parseCoord } from './constants.js';

export function posOf(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function rowOf(pos: number): number {
  return Math.floor(pos / BOARD_SIZE);
}

export function colOf(pos: number): number {
  return pos % BOARD_SIZE;
}

/** An integer position actually on the board. */
export function isBoardPos(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < BOARD_SIZE * BOARD_SIZE;
}

export function premiumAt(pos: number): Premium | null {
  return PREMIUMS[pos] ?? null;
}

/** The human name of a position — "H8" — for error messages. */
export function coordName(pos: number): string {
  return `${String.fromCharCode('A'.charCodeAt(0) + colOf(pos))}${rowOf(pos) + 1}`;
}
