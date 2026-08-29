import { findFormedWords, type ResolvedPlacement } from './words';
import { parseCoord } from './board';
import { emptyBoard, setBoardWord } from './testHelpers';
import type { Letter } from './constants';

function placed(coord: string, letter: Letter, isBlank = false): ResolvedPlacement {
  return { pos: parseCoord(coord), letter, isBlank };
}

describe('findFormedWords', () => {
  it('extends the main word across existing tiles at both ends', () => {
    // Board: B at F8, D at I8. Place E at G8 and N at H8 → BEND, with the
    // existing tiles marked old and the placed ones new.
    const board = emptyBoard();
    setBoardWord(board, 'F8', 'row', 'B');
    setBoardWord(board, 'I8', 'row', 'D');
    const words = findFormedWords(board, [placed('G8', 'E'), placed('H8', 'N')], 'row');
    expect(words).toHaveLength(1);
    expect(words[0]?.word).toBe('BEND');
    expect(words[0]?.squares.map((s) => s.isNew)).toEqual([false, true, true, false]);
  });

  it('finds every perpendicular crossword', () => {
    // Board: BE across G8–H8. Place AN across G9–H9 → main AN, crosses BA and EN.
    const board = emptyBoard();
    setBoardWord(board, 'G8', 'row', 'BE');
    const words = findFormedWords(board, [placed('G9', 'A'), placed('H9', 'N')], 'row');
    expect(words.map((w) => w.word)).toEqual(['AN', 'BA', 'EN']);
  });

  it('finds a lone tile’s words in both axes', () => {
    // Board: A at G8 (left of center), B at H7 (above center). Place T at H8:
    // the row reads AT, the column reads BT.
    const board = emptyBoard();
    setBoardWord(board, 'G8', 'row', 'A');
    setBoardWord(board, 'H7', 'row', 'B');
    const words = findFormedWords(board, [placed('H8', 'T')], 'row');
    expect(words.map((w) => w.word).sort()).toEqual(['AT', 'BT']);
  });

  it('does not report a one-letter run as a word', () => {
    // A lone tile touching something only vertically: the row "word" is one
    // letter and must not appear.
    const board = emptyBoard();
    setBoardWord(board, 'H7', 'row', 'B');
    const words = findFormedWords(board, [placed('H8', 'T')], 'row');
    expect(words.map((w) => w.word)).toEqual(['BT']);
  });

  it('carries blank flags through so scoring can zero them', () => {
    const board = emptyBoard();
    setBoardWord(board, 'G8', 'row', 'A');
    const words = findFormedWords(board, [placed('H8', 'T', true)], 'row');
    expect(words[0]?.word).toBe('AT');
    expect(words[0]?.squares.map((s) => s.isBlank)).toEqual([false, true]);
  });

  it('reads a word that reaches the board edge', () => {
    // A word ending at O8 (the right edge) must not walk off the row.
    const board = emptyBoard();
    setBoardWord(board, 'N8', 'row', 'A');
    const words = findFormedWords(board, [placed('O8', 'T')], 'row');
    expect(words.map((w) => w.word)).toEqual(['AT']);
  });

  it('finds the main word of a first move on an otherwise empty board', () => {
    const board = emptyBoard();
    const words = findFormedWords(board, [placed('H8', 'A'), placed('I8', 'T')], 'row');
    expect(words.map((w) => w.word)).toEqual(['AT']);
  });
});
