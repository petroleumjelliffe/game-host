import { describe, expect, it } from 'vitest';
import { previewPlay } from './scorePreview';
import { BOARD_SQUARES, CENTER } from '../../engine/constants';
import type { Placement, Square } from '../../session/protocol';

const empty = (): Square[] => Array.from({ length: BOARD_SQUARES }, () => null);

describe('previewPlay', () => {
  it('scores a first play across the center (DW doubles it)', () => {
    // A(1) T(1) on H8+H9 horizontally: word "AT" (2) x center DW = 4.
    const preview = previewPlay(empty(), [
      { pos: CENTER, tile: 'A' },
      { pos: CENTER + 1, tile: 'T' },
    ]);
    expect(preview).toEqual({ total: 4, bingo: false, anchorPos: CENTER + 1 });
  });

  it('is null for a disconnected/gapped staging', () => {
    expect(
      previewPlay(empty(), [
        { pos: CENTER, tile: 'A' },
        { pos: CENTER + 2, tile: 'T' }, // gap at CENTER+1
      ]),
    ).toBeNull();
  });

  it('is null for no tiles', () => {
    expect(previewPlay(empty(), [])).toBeNull();
  });

  it('flags a bingo and scores blanks as zero', () => {
    const board = empty();
    board[CENTER] = { letter: 'A', isBlank: false }; // something to connect to
    // A column down from the center: H9..H15 (rows 8..14, col 7), all new,
    // connected to the existing tile at H8. 7 tiles staged — a bingo.
    const staged: Placement[] = (['B', 'C', 'D', 'E', 'F', 'G'] as const).map((tile, i) => ({
      pos: CENTER + 15 * (i + 1),
      tile,
    }));
    staged.push({ pos: CENTER + 15 * 7, tile: '_', as: 'S' });
    const preview = previewPlay(board, staged);
    expect(preview?.bingo).toBe(true);
  });
});
