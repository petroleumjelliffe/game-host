// The 15×15 board. CSS grid, aspect-square cells, no fixed pixel sizes —
// 15 cells across a 360px phone is 24px each, so type scales with the cell
// via clamp() and the value digit is tiny by design.

import { CENTER, PREMIUMS, TILE_VALUES, type Premium } from '../../engine/constants';
import type { Placement, Square } from '../../session/protocol';

export interface BoardProps {
  board: Square[];
  /** Tiles staged this turn, drawn highlighted on their squares. */
  staged: Placement[];
  onCellTap(pos: number): void;
}

const PREMIUM_CLASS: Record<Premium, string> = {
  DL: 'bg-sky-200 text-sky-800',
  TL: 'bg-blue-400 text-blue-900',
  DW: 'bg-rose-200 text-rose-800',
  TW: 'bg-red-400 text-red-950',
};

const PREMIUM_LABEL: Record<Premium, string> = { DL: 'DL', TL: 'TL', DW: 'DW', TW: 'TW' };

interface TileFaceProps {
  letter: string;
  isBlank: boolean;
  staged?: boolean;
}

/** A tile drawn in a cell: letter plus a small point value; blanks are
 * lowercase with a 0, which keeps them visibly distinct at 24px. */
function TileFace({ letter, isBlank, staged = false }: TileFaceProps) {
  const value = isBlank ? 0 : TILE_VALUES[letter as keyof typeof TILE_VALUES] ?? 0;
  return (
    <span
      className={`relative flex h-full w-full items-center justify-center rounded-sm font-bold ${
        staged ? 'bg-yellow-200 ring-2 ring-yellow-500' : 'bg-amber-100'
      } ${isBlank ? 'text-amber-600' : 'text-amber-950'}`}
    >
      <span style={{ fontSize: 'clamp(9px, 3.2vw, 18px)', lineHeight: 1 }}>
        {isBlank ? letter.toLowerCase() : letter}
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

export function Board({ board, staged, onCellTap }: BoardProps) {
  const stagedAt = new Map(staged.map((p) => [p.pos, p]));

  return (
    <div
      data-testid="board"
      className="mx-auto grid w-full max-w-[600px] gap-px rounded bg-emerald-900 p-px"
      style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}
    >
      {board.map((square, pos) => {
        const premium = PREMIUMS[pos] ?? null;
        const stagedHere = stagedAt.get(pos);
        return (
          <button
            key={pos}
            type="button"
            data-testid={`cell-${pos}`}
            data-premium={premium ?? undefined}
            data-staged={stagedHere !== undefined ? '' : undefined}
            data-blank={square?.isBlank || stagedHere?.tile === '_' ? '' : undefined}
            onClick={() => { onCellTap(pos); }}
            className={`aspect-square p-0 ${
              premium !== null ? PREMIUM_CLASS[premium] : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {square !== null ? (
              <TileFace letter={square.letter} isBlank={square.isBlank} />
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
