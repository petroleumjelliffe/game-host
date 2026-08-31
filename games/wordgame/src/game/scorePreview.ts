// The optimistic half of doPlay: geometry and arithmetic, no dictionary —
// the bundle must not carry ENABLE (check:bundle), and a wrong word previews
// a score the server will refuse, which is exactly the design's 4.5 state.

import { validatePlacement } from '../../engine/placement';
import { findFormedWords, type ResolvedPlacement } from '../../engine/words';
import { scorePlay } from '../../engine/score';
import type { Placement, Square } from '../../session/protocol';

export interface PlayPreview {
  total: number;
  bingo: boolean;
  /** Highest placed position — where the floating badge anchors. */
  anchorPos: number;
}

export function previewPlay(board: Square[], staged: Placement[]): PlayPreview | null {
  if (staged.length === 0) return null;
  const positions = staged.map((p) => p.pos);
  if (new Set(positions).size !== positions.length) return null;
  if (positions.some((pos) => (board[pos] ?? null) !== null)) return null;
  const isFirstMove = board.every((square) => square === null);
  try {
    const line = validatePlacement(board, positions, isFirstMove);
    const resolved: ResolvedPlacement[] = staged.map((p) =>
      p.tile === '_'
        ? { pos: p.pos, letter: p.as ?? 'A', isBlank: true }
        : { pos: p.pos, letter: p.tile, isBlank: false },
    );
    const formed = findFormedWords(board, resolved, line.axis);
    if (formed.length === 0) return null;
    const { total, bingo } = scorePlay(formed, staged.length);
    return { total, bingo, anchorPos: Math.max(...positions) };
  } catch {
    // validatePlacement rejects with IllegalIntentError; an invalid staging
    // simply has no preview.
    return null;
  }
}
