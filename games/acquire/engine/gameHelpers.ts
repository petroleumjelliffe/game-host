import { GameState } from './gameTypes';

// Utility helpers for Project Saffold
//----------------------------------------------------

export type Row = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
export const ROWS: Row[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
export type Col = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export const COLS: Col[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/**
 * The 108 board squares, spelled out rather than left as `` `${Row}${number}` ``.
 *
 * A finite union makes `Record<Coord, TileCell>` a record with 108 known keys
 * instead of an index signature, so `board[coord]` is a `TileCell` under
 * `noUncheckedIndexedAccess` — which is the truth: the board is dense from
 * `createEmptyBoard` onward, and `getAdjacentCoords` is bounds-checked, so no
 * caller can reach a square that does not exist.
 */
export type Coord = `${Row}${Col}`;

//----------------------------------------------------
// Coordinate helpers
//----------------------------------------------------

export function coord(r: Row, c: number): Coord {
  return `${r}${c}` as Coord;
}

export function parseCoord(c: Coord): [Row, number] {
  const row = c[0] as Row;
  const col = Number(c.slice(1));
  return [row, col];
}

export function generateAllCoords(): Coord[] {
  const list: Coord[] = [];
  for (const r of ROWS) {
    for (const c of COLS) list.push(coord(r, c));
  }
  return list;
}

//----------------------------------------------------
// Comparison & shuffling
//----------------------------------------------------

export function compareTiles(a: Coord, b: Coord): number {
  const [ra, ca] = parseCoord(a);
  const [rb, cb] = parseCoord(b);
  const rowDiff = ROWS.indexOf(ra) - ROWS.indexOf(rb);
  return rowDiff !== 0 ? rowDiff : ca - cb;
}

export function shuffleSeeded<T>(array: T[], seed: string): T[] {
  let s = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

//----------------------------------------------------
// Adjacency helpers
//----------------------------------------------------

export function getAdjacentCoords(c: Coord): Coord[] {
  const [r, col] = parseCoord(c);
  const rIndex = ROWS.indexOf(r);
  const adj: Coord[] = [];
  if (rIndex > 0) adj.push(coord(ROWS[rIndex - 1]!, col)); // north
  if (rIndex < ROWS.length - 1) adj.push(coord(ROWS[rIndex + 1]!, col)); // south
  if (col > 1) adj.push(coord(r, col - 1)); // west
  if (col < 12) adj.push(coord(r, col + 1)); // east
  return adj;
}

//----------------------------------------------------
// Flood fill to find connected unclaimed tiles
//----------------------------------------------------
/**
 * Collect all contiguous unclaimed (unbranded) tiles starting from a seed.
 * This helps when determining new startup clusters.
 */
export function floodFillUnclaimed(startCoords: Coord[], board: Record<Coord, { placed: boolean; startupId?: string }>): Coord[] {
  const visited = new Set<Coord>();
  const stack = [...startCoords];
  while (stack.length) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const cell = board[cur];
    if (!cell?.placed || cell.startupId) continue;
    for (const adj of getAdjacentCoords(cur)) {
      const n = board[adj];
      if (n?.placed && !n.startupId) stack.push(adj);
    }
  }
  return [...visited];
}

/**
 * Convenience: compute all coords belonging to a startup (derived view).
 */
export function getTilesForStartup(board: Record<Coord, { placed: boolean; startupId?: string }>, id: string): Coord[] {
  return Object.entries(board)
    .filter(([_, cell]) => cell.startupId === id)
    .map(([coord]) => coord as Coord);
}

export function getStartupSize(state:GameState, id: string): number {
  return getTilesForStartup(state.board, id).length;
}



/**
 * The seat whose turn it is.
 *
 * `turnIndex` is only ever set from `players.length` arithmetic, so the seat
 * always exists; this exists so that fact is stated once rather than asserted
 * at every call site. Throwing beats the `undefined.hand` TypeError the same
 * corruption used to produce.
 */
export function turnPlayer(state: GameState): GameState["players"][number] {
  const player = state.players[state.turnIndex];
  if (!player) {
    throw new Error(`turnIndex ${state.turnIndex} is not a seat (${state.players.length} players)`);
  }
  return player;
}
