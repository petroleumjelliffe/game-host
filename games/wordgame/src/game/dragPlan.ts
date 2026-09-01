// Pure drop resolution for tile drags. Geometry works off live
// getBoundingClientRect values, which already reflect the zoom transform —
// so a drop targets the same cell at 1× and 3× with no special casing.

import type { Tile } from '../../engine/constants';
import type { Placement, Square } from '../../session/protocol';
import type { Point } from './boardTransform';

export type DragSource =
  | { kind: 'rack'; index: number; tile: Tile }
  | { kind: 'board'; pos: number; tile: Tile };

export interface Rect { left: number; top: number; width: number; height: number }

/** Which of the 15×15 cells a viewport point lands on; null off-grid or for
 * a zero-size rect (jsdom's default — callers stub rects in tests). */
export function hitCell(rect: Rect, p: Point): number | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const col = Math.floor(((p.x - rect.left) / rect.width) * 15);
  const row = Math.floor(((p.y - rect.top) / rect.height) * 15);
  if (col < 0 || col > 14 || row < 0 || row > 14) return null;
  return row * 15 + col;
}

/** Insertion slot (0..count) in a tray of `count` visible tiles, or null
 * when the point isn't near the tray. The hit area is padded so a drop "at
 * the rack" doesn't demand pixel accuracy from a thumb. */
export function rackSlot(rect: Rect, p: Point, count: number): number | null {
  const PAD = 24;
  if (rect.width <= 0) return null;
  if (p.x < rect.left - PAD || p.x > rect.left + rect.width + PAD) return null;
  if (p.y < rect.top - PAD || p.y > rect.top + rect.height + PAD) return null;
  const slotWidth = rect.width / Math.max(1, count);
  return Math.max(0, Math.min(count, Math.round((p.x - rect.left) / slotWidth)));
}

export type DropAction =
  | { kind: 'place'; rackIndex: number; pos: number }
  | { kind: 'moveStaged'; from: number; pos: number }
  | { kind: 'reorderRack'; from: number; slot: number }
  | { kind: 'recallAt'; from: number; slot: number | null }
  | { kind: 'none' };

export function dropAction(
  source: DragSource,
  cell: number | null,
  slot: number | null,
  board: Square[],
  staged: Placement[],
): DropAction {
  if (cell !== null) {
    const empty = (board[cell] ?? null) === null && !staged.some((p) => p.pos === cell);
    if (source.kind === 'rack') {
      return empty ? { kind: 'place', rackIndex: source.index, pos: cell } : { kind: 'none' };
    }
    if (cell === source.pos) return { kind: 'none' };
    return empty ? { kind: 'moveStaged', from: source.pos, pos: cell } : { kind: 'none' };
  }
  if (slot !== null) {
    return source.kind === 'rack'
      ? { kind: 'reorderRack', from: source.index, slot }
      : { kind: 'recallAt', from: source.pos, slot };
  }
  return source.kind === 'board' ? { kind: 'recallAt', from: source.pos, slot: null } : { kind: 'none' };
}

/** Reorder: remove `from`, insert at `slot` — slots are counted with the
 * moved item already removed, matching what rackSlot sees on screen. */
export function moveTile<T>(items: T[], from: number, slot: number): T[] {
  const moved = items[from];
  if (moved === undefined) return items;
  const next = items.filter((_, i) => i !== from);
  next.splice(Math.min(slot, next.length), 0, moved);
  return next;
}
