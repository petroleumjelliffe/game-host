/**
 * Word finding: given the board and the resolved placements (blanks already
 * carrying their declared letter), enumerate every word the play forms — the
 * main word along the placement line, plus a perpendicular word through each
 * placed tile that touches anything on that axis. A one-letter run is not a
 * word and is never emitted.
 */
import type { Square } from './gameTypes.js';
import type { Letter } from './constants.js';
import { BOARD_SIZE } from './constants.js';
import { colOf, rowOf } from './board.js';
import type { Axis } from './placement.js';

export interface ResolvedPlacement {
  pos: number;
  letter: Letter;
  isBlank: boolean;
}

export interface WordSquare {
  pos: number;
  letter: Letter;
  isBlank: boolean;
  /** Placed this turn — the only squares whose premiums count. */
  isNew: boolean;
}

export interface FormedWord {
  word: string;
  squares: WordSquare[];
}

export function findFormedWords(
  board: readonly Square[],
  placements: readonly ResolvedPlacement[],
  axis: Axis,
): FormedWord[] {
  const fresh = new Map<number, ResolvedPlacement>(placements.map((p) => [p.pos, p]));

  const squareAt = (pos: number): WordSquare | null => {
    const placed = fresh.get(pos);
    if (placed !== undefined) {
      return { pos, letter: placed.letter, isBlank: placed.isBlank, isNew: true };
    }
    const existing = board[pos] ?? null;
    if (existing !== null) {
      return { pos, letter: existing.letter, isBlank: existing.isBlank, isNew: false };
    }
    return null;
  };

  const readWord = (start: number, along: Axis): FormedWord | null => {
    const step = along === 'row' ? 1 : BOARD_SIZE;
    const atLineStart = (pos: number): boolean =>
      along === 'row' ? colOf(pos) === 0 : rowOf(pos) === 0;
    const atLineEnd = (pos: number): boolean =>
      along === 'row' ? colOf(pos) === BOARD_SIZE - 1 : rowOf(pos) === BOARD_SIZE - 1;

    let cur = start;
    while (!atLineStart(cur) && squareAt(cur - step) !== null) cur -= step;

    const squares: WordSquare[] = [];
    for (;;) {
      const square = squareAt(cur);
      if (square === null) break;
      squares.push(square);
      if (atLineEnd(cur)) break;
      cur += step;
    }
    if (squares.length < 2) return null;
    return { word: squares.map((s) => s.letter).join(''), squares };
  };

  const ordered = [...placements].sort((a, b) => a.pos - b.pos);
  const anchor = ordered[0];
  if (anchor === undefined) return [];

  const words: FormedWord[] = [];
  const main = readWord(anchor.pos, axis);
  if (main !== null) words.push(main);

  const crossAxis: Axis = axis === 'row' ? 'col' : 'row';
  for (const placement of ordered) {
    const cross = readWord(placement.pos, crossAxis);
    if (cross !== null) words.push(cross);
  }
  return words;
}
