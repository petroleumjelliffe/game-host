/**
 * Small builders for tests: hand-constructed states for edge cases (a
 * near-empty bag, a mid-game board) rather than replaying long games.
 */
import type { GameState, PlayerState, Square } from './gameTypes.js';
import type { Letter, Tile } from './constants.js';
import { BOARD_SQUARES, isLetter, isTile } from './constants.js';
import { parseCoord, posOf, rowOf, colOf } from './board.js';
import { createDictionary, type Dictionary } from './dictionaryCore.js';
import type { Placement } from './intents.js';
import type { Axis } from './placement.js';

export function emptyBoard(): Square[] {
  return Array.from({ length: BOARD_SQUARES }, () => null);
}

/** 'HAT_' → ['H', 'A', 'T', '_'], validated. */
export function tiles(s: string): Tile[] {
  return [...s].map((ch) => {
    if (!isTile(ch)) throw new Error(`"${ch}" is not a tile`);
    return ch;
  });
}

export function makePlayer(overrides?: Partial<PlayerState>): PlayerState {
  return {
    id: 'p1',
    name: 'Alice',
    rack: tiles('ABCDEFG'),
    score: 0,
    ...overrides,
  };
}

/**
 * A minimal two-player mid-game state. Board empty, a modest bag, racks of
 * seven — override whatever the test needs. Not created through
 * `createInitialGame`, so racks, bag and board are exactly what the test says.
 */
export function makeState(overrides?: Partial<GameState>): GameState {
  return {
    seed: 'test-seed',
    stage: 'playing',
    players: [
      makePlayer({ id: 'p1', name: 'Alice', rack: tiles('ABCDEFG') }),
      makePlayer({ id: 'p2', name: 'Bob', rack: tiles('HIJKLMN') }),
    ],
    turnIndex: 0,
    board: emptyBoard(),
    bag: tiles('AEIOULNRSTDG'),
    scorelessTurns: 0,
    moveCount: 0,
    log: [],
    ...overrides,
  };
}

/**
 * Lay an existing word on a board, as already-committed tiles. `start` is an
 * "H8"-style coordinate; lowercase letters in `word` mark blanks (an 'o'
 * places { letter: 'O', isBlank: true }).
 */
export function setBoardWord(board: Square[], start: string, axis: Axis, word: string): void {
  const startPos = parseCoord(start);
  const row = rowOf(startPos);
  const col = colOf(startPos);
  [...word].forEach((ch, i) => {
    const upper = ch.toUpperCase();
    if (!isLetter(upper)) throw new Error(`"${ch}" is not a letter`);
    const pos = axis === 'row' ? posOf(row, col + i) : posOf(row + i, col);
    board[pos] = { letter: upper, isBlank: ch !== upper };
  });
}

/** Placement at an "H8"-style coordinate. */
export function place(coord: string, tile: Tile, as?: Letter): Placement {
  const placement: Placement = { pos: parseCoord(coord), tile };
  if (as !== undefined) placement.as = as;
  return placement;
}

/**
 * Placements laying `word` from `start` along `axis`, skipping positions in
 * `skip` (existing tiles the word reads through). Lowercase letters place a
 * blank declared as that letter.
 */
export function placeWord(start: string, axis: Axis, word: string, skip: readonly string[] = []): Placement[] {
  const startPos = parseCoord(start);
  const row = rowOf(startPos);
  const col = colOf(startPos);
  const skipPositions = new Set(skip.map(parseCoord));
  const placements: Placement[] = [];
  [...word].forEach((ch, i) => {
    const pos = axis === 'row' ? posOf(row, col + i) : posOf(row + i, col);
    if (skipPositions.has(pos)) return;
    const upper = ch.toUpperCase();
    if (!isLetter(upper)) throw new Error(`"${ch}" is not a letter`);
    if (ch === upper) placements.push({ pos, tile: upper });
    else placements.push({ pos, tile: '_', as: upper });
  });
  return placements;
}

export function fixtureDict(...words: string[]): Dictionary {
  return createDictionary(words);
}
