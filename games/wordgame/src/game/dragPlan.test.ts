import { describe, expect, it } from 'vitest';
import { dropAction, hitCell, moveTile, rackSlot, type DragSource } from './dragPlan';
import type { Placement, Square } from '../../session/protocol';

const emptyBoard: Square[] = Array<Square>(225).fill(null);
const grid = { left: 0, top: 0, width: 300, height: 300 }; // 20px cells

describe('hitCell', () => {
  it('maps a point to its cell', () => {
    expect(hitCell(grid, { x: 30, y: 30 })).toBe(16); // col 1, row 1
    expect(hitCell(grid, { x: 299, y: 299 })).toBe(224);
  });
  it('answers null outside the grid or with a zero-size rect (jsdom)', () => {
    expect(hitCell(grid, { x: -5, y: 30 })).toBeNull();
    expect(hitCell(grid, { x: 30, y: 320 })).toBeNull();
    expect(hitCell({ left: 0, top: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('rackSlot', () => {
  const rack = { left: 100, top: 500, width: 288, height: 50 }; // 6 visible tiles, 48px slots
  it('rounds to the nearest insertion slot, 0 through count', () => {
    expect(rackSlot(rack, { x: 100, y: 520 }, 6)).toBe(0);
    expect(rackSlot(rack, { x: 175, y: 520 }, 6)).toBe(2);
    expect(rackSlot(rack, { x: 388, y: 520 }, 6)).toBe(6);
  });
  it('answers null when the point is not near the tray', () => {
    expect(rackSlot(rack, { x: 200, y: 300 }, 6)).toBeNull();
    expect(rackSlot(rack, { x: 500, y: 520 }, 6)).toBeNull();
  });
});

describe('dropAction', () => {
  const fromRack: DragSource = { kind: 'rack', index: 2, tile: 'A' };
  const fromBoard: DragSource = { kind: 'board', pos: 112, tile: 'B' };
  const staged: Placement[] = [{ pos: 112, tile: 'B' }];

  it('rack tile onto an empty cell places it', () => {
    expect(dropAction(fromRack, 113, null, emptyBoard, staged)).toEqual({ kind: 'place', rackIndex: 2, pos: 113 });
  });
  it('rack tile onto an occupied or staged cell is a no-op', () => {
    const board = [...emptyBoard];
    board[50] = { letter: 'Q', isBlank: false };
    expect(dropAction(fromRack, 50, null, board, staged)).toEqual({ kind: 'none' });
    expect(dropAction(fromRack, 112, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
  it('staged tile onto another empty cell moves it; its own cell is a no-op', () => {
    expect(dropAction(fromBoard, 113, null, emptyBoard, staged)).toEqual({ kind: 'moveStaged', from: 112, pos: 113 });
    expect(dropAction(fromBoard, 112, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
  it('rack tile dropped at a tray slot reorders the rack', () => {
    expect(dropAction(fromRack, null, 5, emptyBoard, staged)).toEqual({ kind: 'reorderRack', from: 2, slot: 5 });
  });
  it('staged tile dropped at a tray slot recalls it there; off everything recalls to the end', () => {
    expect(dropAction(fromBoard, null, 3, emptyBoard, staged)).toEqual({ kind: 'recallAt', from: 112, slot: 3 });
    expect(dropAction(fromBoard, null, null, emptyBoard, staged)).toEqual({ kind: 'recallAt', from: 112, slot: null });
  });
  it('rack tile dropped off everything is a no-op — it snaps back', () => {
    expect(dropAction(fromRack, null, null, emptyBoard, staged)).toEqual({ kind: 'none' });
  });
});

describe('moveTile', () => {
  it('moves an item to an insertion slot counted with the item removed', () => {
    expect(moveTile(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'C', 'A', 'D']);
    expect(moveTile(['A', 'B', 'C', 'D'], 3, 0)).toEqual(['D', 'A', 'B', 'C']);
    expect(moveTile(['A', 'B', 'C', 'D'], 1, 9)).toEqual(['A', 'C', 'D', 'B']);
  });
});
