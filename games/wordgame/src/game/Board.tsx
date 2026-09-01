// The 15×15 board. CSS grid, aspect-square cells, no fixed pixel sizes —
// 15 cells across a 360px phone is 24px each, so type scales with the cell
// via clamp() and the value digit is tiny by design.

import { CENTER, PREMIUMS, TILE_VALUES, type Premium } from '../../engine/constants';
import type { Placement, Square } from '../../session/protocol';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';

export interface BoardProps {
  board: Square[];
  /** Tiles staged this turn, drawn highlighted on their squares. */
  staged: Placement[];
  /** The last committed play's squares — drawn with the gold ring. */
  lastPositions?: number[];
  onCellTap(pos: number): void;
  /** Ref to the grid element — drop targeting measures this rect, which
   * already reflects any zoom transform. */
  gridRef?: Ref<HTMLDivElement>;
  /** Pointerdown on a staged tile begins a board→board / board→rack drag. */
  onStagedPointerDown?(pos: number, e: ReactPointerEvent<HTMLButtonElement>): void;
  /** The staged tile being dragged — its cell renders as if unstaged (the
   * ghost under the finger is its only representation). */
  hiddenPos?: number | null;
}

const PREMIUM_CLASS: Record<Premium, string> = {
  DL: 'bg-prem-2l text-prem-2l-ink',
  TL: 'bg-prem-3l text-white',
  DW: 'bg-prem-2w text-prem-2w-ink',
  TW: 'bg-prem-3w text-white',
};

// The design names premiums by their multiplier, not initials.
const PREMIUM_LABEL: Record<Premium, string> = { DL: '2L', TL: '3L', DW: '2W', TW: '3W' };

interface TileFaceProps {
  letter: string;
  isBlank: boolean;
  staged?: boolean;
  /** This tile is part of the last committed play — ringed gold. */
  last?: boolean;
}

/** A tile drawn in a cell: letter plus a small point value. A placed blank
 * reads like any other tile — CAPS, same ink — and only its 0 gives it
 * away (feedback 2026-09-01; the lowercase/faded look confused the table). */
function TileFace({ letter, isBlank, staged = false, last = false }: TileFaceProps) {
  const value = isBlank ? 0 : TILE_VALUES[letter as keyof typeof TILE_VALUES] ?? 0;
  const ring = staged
    ? 'inset 0 -2px 0 #d9bf8a, 0 0 0 2px #2563eb, 0 2px 6px rgba(37,99,235,.4)'
    : last
      ? 'inset 0 -2px 0 #d9bf8a, 0 1px 1px rgba(0,0,0,.18), 0 0 0 2px #e0a924'
      : 'inset 0 -2px 0 #d9bf8a, 0 1px 1px rgba(0,0,0,.18)';
  return (
    <span
      className={`relative flex h-full w-full items-center justify-center rounded font-tile font-bold bg-tile text-tile-ink ${
        staged ? 'z-10 wg-settle' : ''
      }`}
      style={{ boxShadow: ring }}
    >
      <span style={{ fontSize: 'clamp(9px, 3.2vw, 18px)', lineHeight: 1 }}>
        {letter.toUpperCase()}
      </span>
      <span
        className="absolute bottom-0 right-0.5"
        style={{ fontSize: 'clamp(5px, 1.6vw, 9px)', lineHeight: 1.4 }}
      >
        {value}
      </span>
    </span>
  );
}

export function Board({
  board, staged, lastPositions, onCellTap, gridRef, onStagedPointerDown, hiddenPos = null,
}: BoardProps) {
  const stagedAt = new Map(staged.filter((p) => p.pos !== hiddenPos).map((p) => [p.pos, p]));

  return (
    <div
      ref={gridRef}
      data-testid="board"
      className="mx-auto grid w-full gap-0.5 rounded-lg bg-board p-1"
      style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}
    >
      {board.map((square, pos) => {
        const premium = PREMIUMS[pos] ?? null;
        const stagedHere = stagedAt.get(pos);
        const isLast = lastPositions?.includes(pos) ?? false;
        return (
          <button
            key={pos}
            type="button"
            data-testid={`cell-${pos}`}
            data-premium={premium ?? undefined}
            data-staged={stagedHere !== undefined ? '' : undefined}
            data-last={isLast ? '' : undefined}
            data-blank={square?.isBlank || stagedHere?.tile === '_' ? '' : undefined}
            onClick={() => { onCellTap(pos); }}
            onPointerDown={stagedHere !== undefined && onStagedPointerDown !== undefined
              ? (e) => { onStagedPointerDown(pos, e); }
              : undefined}
            className={`aspect-square rounded-sm p-0 ${
              premium !== null ? PREMIUM_CLASS[premium] : 'bg-board-cell text-board-cell-ink'
            }`}
            style={stagedHere !== undefined && onStagedPointerDown !== undefined ? { touchAction: 'none' } : undefined}
          >
            {square !== null ? (
              <TileFace letter={square.letter} isBlank={square.isBlank} last={isLast} />
            ) : stagedHere !== undefined ? (
              <TileFace
                letter={stagedHere.tile === '_' ? stagedHere.as ?? '?' : stagedHere.tile}
                isBlank={stagedHere.tile === '_'}
                staged
              />
            ) : pos === CENTER ? (
              <span aria-hidden style={{ fontSize: 'clamp(9px, 3vw, 16px)' }}>★</span>
            ) : premium !== null ? (
              <span style={{ fontSize: 'clamp(6px, 2vw, 11px)' }}>{PREMIUM_LABEL[premium]}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
