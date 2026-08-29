/**
 * Geometric validation of a play: one line, contiguous once existing tiles
 * fill the gaps, connected to what is already on the board (or covering the
 * center, first time). Word-finding and scoring are elsewhere — this module
 * answers only "may these tiles sit on these squares at all".
 */
import type { Square } from './gameTypes.js';
import { BOARD_SIZE, CENTER } from './constants.js';
import { colOf, coordName, posOf, rowOf } from './board.js';
import { reject } from './errors.js';

export type Axis = 'row' | 'col';

export interface PlacementLine {
  /**
   * The line the tiles lie on. A single tile is reported as 'row' — word
   * finding scans the perpendicular of every placed tile anyway, so both of
   * a lone tile's words are found either way.
   */
  axis: Axis;
  /** The placed positions, sorted ascending. */
  positions: number[];
}

function isOccupied(board: readonly Square[], pos: number): boolean {
  return (board[pos] ?? null) !== null;
}

function hasOccupiedNeighbour(board: readonly Square[], pos: number): boolean {
  const row = rowOf(pos);
  const col = colOf(pos);
  if (col > 0 && isOccupied(board, pos - 1)) return true;
  if (col < BOARD_SIZE - 1 && isOccupied(board, pos + 1)) return true;
  if (row > 0 && isOccupied(board, pos - BOARD_SIZE)) return true;
  if (row < BOARD_SIZE - 1 && isOccupied(board, pos + BOARD_SIZE)) return true;
  return false;
}

/**
 * Validate the geometry of a play; throws IllegalIntentError('badPlacement')
 * with a message naming the rule that failed. Assumes positions are already
 * range-checked, unique and unoccupied (intents.ts does that shape pass).
 */
export function validatePlacement(
  board: readonly Square[],
  positions: readonly number[],
  isFirstMove: boolean,
): PlacementLine {
  const sorted = [...positions].sort((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) reject('badPlacement', 'a play must place at least one tile');

  const rows = new Set(sorted.map(rowOf));
  const cols = new Set(sorted.map(colOf));
  const sameRow = rows.size === 1;
  const sameCol = cols.size === 1;
  if (!sameRow && !sameCol) {
    reject('badPlacement', 'all tiles must lie in a single row or a single column');
  }
  // A lone tile is both; call it a row and let word finding look both ways.
  const axis: Axis = sameRow ? 'row' : 'col';

  if (isFirstMove) {
    if (sorted.length < 2) {
      reject('badPlacement', 'the first play needs at least two tiles');
    }
    if (!sorted.includes(CENTER)) {
      reject('badPlacement', `the first play must cover the center square (${coordName(CENTER)})`);
    }
  }

  // Contiguity: every square between the outermost placed tiles must hold
  // either a new tile or an existing one.
  const placedSet = new Set(sorted);
  const last = sorted[sorted.length - 1];
  if (last !== undefined) {
    if (axis === 'row') {
      const row = rowOf(first);
      for (let col = colOf(first); col <= colOf(last); col++) {
        const pos = posOf(row, col);
        if (!placedSet.has(pos) && !isOccupied(board, pos)) {
          reject('badPlacement', `gap at ${coordName(pos)} — the word must be contiguous`);
        }
      }
    } else {
      const col = colOf(first);
      for (let row = rowOf(first); row <= rowOf(last); row++) {
        const pos = posOf(row, col);
        if (!placedSet.has(pos) && !isOccupied(board, pos)) {
          reject('badPlacement', `gap at ${coordName(pos)} — the word must be contiguous`);
        }
      }
    }
  }

  if (!isFirstMove && !sorted.some((pos) => hasOccupiedNeighbour(board, pos))) {
    reject('badPlacement', 'the play must connect to at least one existing tile');
  }

  return { axis, positions: sorted };
}
