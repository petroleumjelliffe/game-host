/**
 * The fixed facts of the game: the tile set, the board dimensions, the
 * premium-square layout, and the player limits. Everything here is data —
 * no game logic, no state, importable from client and server alike.
 */

export type Letter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

/** A tile as it lives in the bag or a rack. `'_'` is a blank. */
export type Tile = Letter | '_';

export const BLANK: Tile = '_';

/** Face value of each tile. Blanks are worth nothing, before and after they declare a letter. */
export const TILE_VALUES: Readonly<Record<Tile, number>> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  _: 0,
};

/** How many of each tile the bag starts with. Sums to 100 — tested. */
export const TILE_DISTRIBUTION: Readonly<Record<Tile, number>> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  _: 2,
};

/** Every distinct tile, letters then the blank — the iteration order for building the bag. */
export const ALL_TILES: readonly Tile[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '_',
];

export const BOARD_SIZE = 15;
export const BOARD_SQUARES = 225;
/** Row 7, column 7 — the square the first play must cover. It is a DW. */
export const CENTER = 112;

export type Premium = 'DL' | 'TL' | 'DW' | 'TW';

export const RACK_SIZE = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const BINGO_BONUS = 50;

/** Seat decorations for the lobby — the engine itself never reads these. */
export const PLAYER_EMOJI: readonly string[] = ['🦊', '🐙', '🦉', '🐸', '🦄', '🐝', '🐳', '🦁'];

export function isLetter(v: unknown): v is Letter {
  return typeof v === 'string' && v.length === 1 && v >= 'A' && v <= 'Z';
}

export function isTile(v: unknown): v is Tile {
  return v === BLANK || isLetter(v);
}

/**
 * Parse an "H8"-style coordinate into a board position. Column letter A–O is
 * col 0–14; row number 1–15 is row 0–14; pos = row * 15 + col. So A1 is the
 * top-left corner (pos 0) and H8 is the center (pos 112).
 *
 * Lives here rather than board.ts because the premium layout below is built
 * from these strings, and constants.ts must not import a module that imports
 * it back. board.ts re-exports it alongside the other coordinate helpers.
 */
export function parseCoord(coord: string): number {
  const match = /^([A-O])(1[0-5]|[1-9])$/.exec(coord);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`bad coordinate "${coord}" — expected column A–O then row 1–15, like "H8"`);
  }
  const col = match[1].charCodeAt(0) - 'A'.charCodeAt(0);
  const row = Number(match[2]) - 1;
  return row * BOARD_SIZE + col;
}

// The premium layout, as coordinate lists rather than a 225-cell literal:
// the lists are checkable against a printed board square by square, and the
// builder below turns them into the flat array the engine indexes.
const TW_COORDS = ['A1', 'A8', 'A15', 'H1', 'H15', 'O1', 'O8', 'O15'] as const;
const DW_COORDS = [
  'B2', 'C3', 'D4', 'E5', 'K11', 'L12', 'M13', 'N14',
  'B14', 'C13', 'D12', 'E11', 'K5', 'L4', 'M3', 'N2',
  'H8', // the center
] as const;
const TL_COORDS = [
  'B6', 'B10', 'F2', 'F6', 'F10', 'F14',
  'J2', 'J6', 'J10', 'J14', 'N6', 'N10',
] as const;
const DL_COORDS = [
  'A4', 'A12', 'C7', 'C9', 'D1', 'D8', 'D15',
  'G3', 'G7', 'G9', 'G13', 'H4', 'H12',
  'I3', 'I7', 'I9', 'I13', 'L1', 'L8', 'L15',
  'M7', 'M9', 'O4', 'O12',
] as const;

function buildPremiums(): ReadonlyArray<Premium | null> {
  const layout: (Premium | null)[] = Array.from({ length: BOARD_SQUARES }, () => null);
  const paint = (coords: readonly string[], premium: Premium): void => {
    for (const coord of coords) {
      const pos = parseCoord(coord);
      if (layout[pos] !== null) {
        throw new Error(`premium layout collision at ${coord}: ${String(layout[pos])} vs ${premium}`);
      }
      layout[pos] = premium;
    }
  };
  paint(TW_COORDS, 'TW');
  paint(DW_COORDS, 'DW');
  paint(TL_COORDS, 'TL');
  paint(DL_COORDS, 'DL');
  return layout;
}

/** Premium (or null) for every square, row-major, length 225. */
export const PREMIUMS: ReadonlyArray<Premium | null> = buildPremiums();
