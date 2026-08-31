// session/protocol.ts
// The game half of the wire. The lobby half (createRoom, joinRoom, roster,
// rejected) is @game-host/lobby's protocol; this file is only what happens
// after "the host pressed begin".
//
// Identity is never on the wire: a WireMove has no playerId — the server
// stamps the seat its socket binding proves, so impersonation is
// unrepresentable rather than merely rejected (Acquire's rule, kept).
//
// This game's wire is deliberately smaller than Acquire's: no drafts, no
// segments, no undo. A word game turn is one atomic move — the server
// validates it wholesale (dictionary included) and either commits or
// rejects, so `state` messages carry a per-player *view*, never raw state.

import type { Lifecycle } from '@game-host/lobby/protocol/protocol.js';
import type { Letter, Tile } from '../engine/constants.js';
import { isLetter, isTile } from '../engine/constants.js';
import type { Placement } from '../engine/intents.js';
import type { MoveRecord, Square } from '../engine/gameTypes.js';

export const PROTOCOL_VERSION = 1;

export const GAME_CLIENT_EVENTS = {
  move: 'move',
} as const;

export const GAME_SERVER_EVENTS = {
  state: 'state',
} as const;

/** A move as the client sends it — an Intent with the identity stripped. */
export type WireMove =
  | { type: 'play'; placements: Placement[] }
  | { type: 'exchange'; tiles: Tile[] }
  | { type: 'pass' };

const MAX_MOVE_TILES = 7;

function isPlacement(value: unknown): value is Placement {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  if (typeof p.pos !== 'number' || !Number.isInteger(p.pos) || p.pos < 0 || p.pos > 224) {
    return false;
  }
  if (!isTile(p.tile)) return false;
  if (p.as !== undefined && !isLetter(p.as)) return false;
  return true;
}

/**
 * Field-shape guard, run before dispatch: engine code dereferences fields
 * before validating them, and a synchronous throw inside a socket.io
 * listener would take the process down (same reasoning as Acquire's
 * isWireIntent).
 */
export function isWireMove(value: unknown): value is WireMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  switch (move.type) {
    case 'play':
      return (
        Array.isArray(move.placements) &&
        move.placements.length >= 1 &&
        move.placements.length <= MAX_MOVE_TILES &&
        move.placements.every(isPlacement)
      );
    case 'exchange':
      return (
        Array.isArray(move.tiles) &&
        move.tiles.length >= 1 &&
        move.tiles.length <= MAX_MOVE_TILES &&
        move.tiles.every(isTile)
      );
    case 'pass':
      return true;
    default:
      return false;
  }
}

/** One seat, as a given viewer is allowed to see it. */
export interface PlayerView {
  id: string;
  name: string;
  score: number;
  rackCount: number;
  /** The viewer's own tiles; null for everyone else's seat (and spectators). */
  rack: Tile[] | null;
}

/**
 * A game, as one player sees it. The board, scores and log are public at a
 * real table; racks, the bag's contents and the seed are not, and they are
 * absent from this type rather than blanked — a view cannot leak what it
 * cannot represent.
 */
export interface GameView {
  stage: 'playing' | 'over';
  players: PlayerView[];
  turnIndex: number;
  currentPlayerId: string | null;
  board: Square[];
  bagCount: number;
  scorelessTurns: number;
  moveCount: number;
  log: MoveRecord[];
  final?: {
    adjustments: { playerId: string; rackValue: number; playedOutBonus: number }[];
    winnerIds: string[];
  };
}

/** Why a state message arrived. `resume` re-seats a reconnecting player. */
export type StateReason = 'commit' | 'resume';

export interface StateMessage {
  view: GameView;
  reason: StateReason;
}

/** Rejection codes this game adds to the lobby's `rejected` channel. */
export interface MoveRejectedMessage {
  code: string;
  message: string;
  /** For dictionary rejections: the words that failed. */
  words?: string[];
}

export type { Letter, MoveRecord, Placement, Square, Tile };

/**
 * What the entry screen's game list is drawn from — one row per room a
 * player holds a seat in, built server-side by `server/summaries.ts` and
 * declared here because it is the game half of the wire, same as everything
 * else in this file.
 *
 * `known: false` covers both "no such room" and "your token doesn't match
 * this seat" with the same shape, so a client asking about a room it isn't
 * in learns nothing more than a client asking about one that never existed.
 */
export type RoomSummary =
  | { roomId: string; known: false }
  | {
      roomId: string;
      known: true;
      lifecycle: Lifecycle;
      capacity: number;
      players: { name: string; score: number | null; isHost: boolean; isYou: boolean }[];
      yourTurn: boolean;
      currentPlayerName: string | null;
      /** Last committed move, when playing/over and the log has one. */
      lastMove: {
        name: string;
        kind: MoveRecord['kind'];
        word: string | null;
        score: number;
        at: number | null;
      } | null;
      winnerNames: string[] | null;
    };
