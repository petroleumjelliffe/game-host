import type { CSSProperties } from 'react';
import { Tile } from './atoms/Tile';
import { isStartupId } from '../../engine/startups';
import { ROWS, COLS, coord as toCoord, type Coord } from '../../engine/gameHelpers';
import type { TileCell } from '../../engine/gameTypes';

/**
 * The 9×12 board, pure over a board fixture.
 *
 * Closed the five parity defects the legacy `src/components/Board.tsx` (deleted in Phase 3b)
 * carried: A1-style coordinates rather than `r-c`, an owner *initial* rather than a full name,
 * chain outlines, blocked/dead-tile treatment, and the coordinate staying reachable on a founded
 * tile.
 */
export interface BoardProps {
  board: Record<Coord, TileCell>;
  /** Placeable tiles in the current player's hand. */
  hand?: Coord[];
  /** The tile placed this turn — the one still undoable. */
  placed?: Coord | null;
  /** Coord → the owning player's initial, badged on the tile. */
  /** Sparse: only the tiles that carry a badge. */
  owners?: Partial<Record<Coord, string>>;
  /** Hand tiles whose placement would illegally merge two safe chains. */
  blocked?: Coord[];
  /** The one labelled cell per chain, showing the ticker. */
  hqTiles?: Coord[];
  /**
   * The newest tile on the board, by anyone — the one cell worth animating.
   *
   * A commit can carry a whole turn: a placement, a founding, three purchases.
   * Only one of those moved a tile, so this is what "what changed" means when
   * someone else's turn lands on your screen all at once.
   */
  landed?: Coord | null;
  /**
   * The one hand tile to light up — the one whose twin in the panel is being
   * pointed at. Only applies to a cell actually in `hand`, so a stale hover
   * after a placement paints nothing; and it changes only the paint — an
   * unhighlighted hand cell is still tappable.
   */
  highlight?: Coord | null;
  /**
   * Whether hand cells are painted as yours without being pointed at. Online
   * they are — it is your own screen, and the badge is how your tiles are
   * found on the board. Pass-and-play passes false (owner, hotseat pass —
   * and hotseat *only*): on a shared board six lit cells read as six
   * placements already made, so there a cell lights only via `highlight`.
   */
  autoHighlight?: boolean;
  onCellClick?: (c: Coord) => void;
}

/**
 * `container-type: inline-size` plus `cqi` label sizing is what makes one board
 * work from tablet to desktop: the text scales with the board itself, so no
 * breakpoint-specific font sizes are needed anywhere below.
 */
const GRID_VARS = {
  '--tile-label': '2.3cqi',
  '--tile-overlay': '4.6cqi',
} as CSSProperties;

export function Board({
  board,
  hand = [],
  placed = null,
  owners = {},
  blocked = [],
  hqTiles = [],
  landed = null,
  highlight = null,
  autoHighlight = true,
  onCellClick,
}: BoardProps) {
  return (
    // No row or column headers (owner, 2026-08-07): they spent a column and a
    // row of space repeating what every tile already carries — each cell is
    // labelled with its own A1-style coordinate — and helped nobody. The
    // aspect follows the grid: 12×9 cells now, not 13×10 tracks.
    <div
      data-board="grid"
      style={GRID_VARS}
      className="grid h-full max-w-full grid-cols-[repeat(12,1fr)] gap-[5px] rounded-xl bg-gray-200 p-2 aspect-[12/9] [container-type:inline-size]"
    >
      {ROWS.map((r) => (
        <RowCells
          key={r}
          row={r}
          board={board}
          hand={hand}
          placed={placed}
          owners={owners}
          blocked={blocked}
          hqTiles={hqTiles}
          landed={landed}
          highlight={highlight}
          autoHighlight={autoHighlight}
          onCellClick={onCellClick}
        />
      ))}
    </div>
  );
}

function RowCells({
  row,
  board,
  hand,
  placed,
  owners,
  blocked,
  hqTiles,
  landed,
  highlight,
  autoHighlight,
  onCellClick,
}: Required<Omit<BoardProps, 'onCellClick'>> & { row: (typeof ROWS)[number]; onCellClick?: (c: Coord) => void }) {
  return (
    <>
      {COLS.map((c) => {
        const id = toCoord(row, c);
        const cell: TileCell = board[id] ?? { placed: false };
        // `TileCell.startupId` is a plain string; narrow it through the
        // engine's guard rather than asserting it into a `StartupId`.
        const brand = cell.startupId != null && isStartupId(cell.startupId) ? cell.startupId : undefined;
        const founded = brand != null;
        const inHand = hand.includes(id) && !cell.placed;
        const isBlocked = inHand && blocked.includes(id);
        const owner = owners[id];

        // Whether this hand cell wears its paint: always on your own screen
        // (online), only while pointed at on a shared one (pass-and-play).
        const lit = inHand && (autoHighlight || highlight === id);
        const state = founded
          ? hqTiles.includes(id)
            ? 'founded'
            : 'chain'
          : cell.placed
            ? 'filled'
            : lit
              ? isBlocked
                ? 'blocked'
                : 'hand'
              : 'empty';

        // Only a live hand tile or the undoable placed tile is worth a click;
        // everything else stays out of the keyboard order rather than making
        // a caller tab through 108 dead cells.
        const clickable = (inHand && !isBlocked) || placed === id;

        // Keyed by the coordinate so the animation plays once, when this cell
        // becomes the newest placement — a class alone would re-run on every
        // render, and a class on every placed cell would animate the whole
        // board each time a commit arrives.
        const justLanded = landed === id && cell.placed;

        return (
          <div
            key={justLanded ? `${id}-landed` : id}
            data-landed={justLanded || undefined}
            className={justLanded ? 'relative tile-land' : 'relative'}
          >
            <Tile
              coord={id}
              state={state}
              brand={brand}
              selected={placed === id}
              fill
              onClick={clickable && onCellClick ? () => onCellClick(id) : undefined}
            />
            {owner && (
              <span className="pointer-events-none absolute right-px top-px z-[4] rounded-sm bg-white/85 px-0.5 py-px text-[8px] font-bold leading-none text-gray-900">
                {owner}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
