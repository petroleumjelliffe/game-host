import type { Letter, Tile } from './constants.js';
import { BOARD_SQUARES, isLetter, isTile } from './constants.js';

/**
 * A tile as it sits on the board. A blank declares a letter on placement and
 * stays that letter for the rest of the game; `isBlank` is what keeps its
 * score at zero forever after.
 */
export interface PlacedTile {
  letter: Letter;
  isBlank: boolean;
}

export type Square = PlacedTile | null;

export interface PlayerState {
  id: string;
  name: string;
  rack: Tile[];
  score: number;
}

export interface WordScore {
  word: string;
  score: number;
}

export interface MoveRecord {
  playerId: string;
  kind: 'play' | 'exchange' | 'pass';
  words?: WordScore[];
  score: number;
  /** play: tiles placed; exchange: tiles exchanged. */
  tilesPlayed?: number;
  bingo?: boolean;
  /** Epoch ms, stamped by the server at commit — never by the engine, which
   * must stay deterministic under a seed. Absent on saves from before
   * 2026-08-31. */
  at?: number;
  /** For plays: the board positions placed, ascending — what the client
   * highlights as the last word. Stamped beside `at`. */
  positions?: number[];
}

export interface FinalAdjustment {
  playerId: string;
  /** Sum of the player's remaining tile values, already deducted from their score. */
  rackValue: number;
  /** For the player who played out: the sum of everyone else's rackValue, already added. */
  playedOutBonus: number;
}

export interface GameState {
  seed: string;
  stage: 'playing' | 'over';
  /** Already in randomized turn order — turnIndex walks this array. */
  players: PlayerState[];
  turnIndex: number;
  /** 225 squares, row-major. */
  board: Square[];
  bag: Tile[];
  /** Consecutive passes, exchanges and 0-point plays. Six in a row ends the game. */
  scorelessTurns: number;
  /** Increments on every applied intent. */
  moveCount: number;
  log: MoveRecord[];
  final?: { adjustments: FinalAdjustment[]; winnerIds: string[] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isSquare(v: unknown): boolean {
  if (v === null) return true;
  return isRecord(v) && isLetter(v['letter']) && typeof v['isBlank'] === 'boolean';
}

function isPlayerState(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    Array.isArray(v['rack']) &&
    v['rack'].every(isTile) &&
    typeof v['score'] === 'number'
  );
}

/**
 * Structural guard for a saved or received state. Deep enough to catch a
 * truncated board, a corrupt tile, or a malformed player — deliberately not
 * exhaustive over log entries, which are display history rather than rules
 * input.
 */
export function isGameState(v: unknown): v is GameState {
  if (!isRecord(v)) return false;
  if (typeof v['seed'] !== 'string') return false;
  if (v['stage'] !== 'playing' && v['stage'] !== 'over') return false;
  if (!Array.isArray(v['players']) || v['players'].length === 0 || !v['players'].every(isPlayerState)) return false;
  if (typeof v['turnIndex'] !== 'number') return false;
  if (!Array.isArray(v['board']) || v['board'].length !== BOARD_SQUARES || !v['board'].every(isSquare)) return false;
  if (!Array.isArray(v['bag']) || !v['bag'].every(isTile)) return false;
  if (typeof v['scorelessTurns'] !== 'number') return false;
  if (typeof v['moveCount'] !== 'number') return false;
  if (!Array.isArray(v['log']) || !v['log'].every(isRecord)) return false;
  const final = v['final'];
  if (final !== undefined) {
    if (!isRecord(final)) return false;
    if (!Array.isArray(final['adjustments']) || !final['adjustments'].every(isRecord)) return false;
    if (!Array.isArray(final['winnerIds']) || !final['winnerIds'].every((id) => typeof id === 'string')) return false;
  }
  return true;
}
