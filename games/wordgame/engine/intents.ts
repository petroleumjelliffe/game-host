/**
 * The single server-authoritative vocabulary of player actions, and
 * `applyIntent`, the one reducer. Pure by contract: an illegal intent throws
 * `IllegalIntentError` leaving the input untouched; a legal one returns a new
 * state (structuredClone, then mutate the clone — Acquire's pattern).
 */
import type { Dictionary } from './dictionaryCore.js';
import type { FinalAdjustment, GameState, MoveRecord, PlayerState } from './gameTypes.js';
import type { Letter, Tile } from './constants.js';
import {
  BLANK,
  RACK_SIZE,
  TILE_VALUES,
  isLetter,
  isTile,
} from './constants.js';
import { coordName, isBoardPos } from './board.js';
import { getCurrentActor } from './actor.js';
import { validatePlacement } from './placement.js';
import { findFormedWords, type ResolvedPlacement } from './words.js';
import { scorePlay } from './score.js';
import { seededShuffle } from './rng.js';
import { reject } from './errors.js';

export { IllegalIntentError } from './errors.js';
export type { IllegalIntentCode } from './errors.js';

export interface Placement {
  pos: number;
  tile: Tile;
  /** The declared letter — required iff `tile === '_'`; ignored on letters. */
  as?: Letter;
}

export type Intent =
  | { type: 'play'; playerId: string; placements: Placement[] }
  | { type: 'exchange'; playerId: string; tiles: Tile[] }
  | { type: 'pass'; playerId: string };

/** Six consecutive scoreless turns (passes, exchanges, 0-point plays) end the game. */
export const SCORELESS_LIMIT = 6;

/** An exchange is only legal while the bag could refill a full rack. */
export const EXCHANGE_MINIMUM_BAG = 7;

function requireTurn(state: GameState, playerId: string): PlayerState {
  if (state.stage === 'over') reject('gameOver', 'the game is over');
  if (getCurrentActor(state) !== playerId) reject('notYourTurn');
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined) reject('notYourTurn', `unknown player ${playerId}`);
  return player;
}

/** Every needed tile must be in the rack, counting duplicates. */
function requireInRack(rack: readonly Tile[], needed: readonly Tile[]): void {
  const counts = new Map<Tile, number>();
  for (const tile of rack) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  for (const tile of needed) {
    const available = counts.get(tile) ?? 0;
    if (available === 0) {
      reject('notInRack', `${tile === BLANK ? 'a blank' : `the tile ${tile}`} is not in your rack`);
    }
    counts.set(tile, available - 1);
  }
}

function removeFromRack(rack: Tile[], tiles: readonly Tile[]): void {
  for (const tile of tiles) {
    const index = rack.indexOf(tile);
    if (index === -1) reject('notInRack', `the tile ${tile} is not in your rack`);
    rack.splice(index, 1);
  }
}

function refillRack(state: GameState, player: PlayerState): void {
  while (player.rack.length < RACK_SIZE) {
    const tile = state.bag.shift();
    if (tile === undefined) break;
    player.rack.push(tile);
  }
}

function rackValueOf(player: PlayerState): number {
  return player.rack.reduce((sum, tile) => sum + TILE_VALUES[tile], 0);
}

/**
 * End the game. Every player's remaining rack value comes off their score;
 * the player who played out (if any — nobody on the six-scoreless ending)
 * additionally gains the sum of all opponents' rack values. `turnIndex`
 * stays where it was — `getCurrentActor` answers null via the stage.
 */
function endGame(state: GameState, playedOutId: string | null): void {
  state.stage = 'over';
  const adjustments: FinalAdjustment[] = state.players.map((player) => ({
    playerId: player.id,
    rackValue: rackValueOf(player),
    playedOutBonus: 0,
  }));
  for (const adjustment of adjustments) {
    const player = state.players.find((p) => p.id === adjustment.playerId);
    if (player !== undefined) player.score -= adjustment.rackValue;
  }
  if (playedOutId !== null) {
    const bonus = adjustments
      .filter((a) => a.playerId !== playedOutId)
      .reduce((sum, a) => sum + a.rackValue, 0);
    const adjustment = adjustments.find((a) => a.playerId === playedOutId);
    const player = state.players.find((p) => p.id === playedOutId);
    if (adjustment !== undefined && player !== undefined) {
      adjustment.playedOutBonus = bonus;
      player.score += bonus;
    }
  }
  const top = Math.max(...state.players.map((p) => p.score));
  state.final = {
    adjustments,
    winnerIds: state.players.filter((p) => p.score === top).map((p) => p.id),
  };
}

function advanceTurn(state: GameState): void {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
}

/** The shared tail of pass and exchange: scoreless bookkeeping, end check, rotation. */
function concludeScorelessTurn(state: GameState): void {
  state.scorelessTurns += 1;
  state.moveCount += 1;
  if (state.scorelessTurns >= SCORELESS_LIMIT) endGame(state, null);
  else advanceTurn(state);
}

function doPlay(state: GameState, intent: Extract<Intent, { type: 'play' }>, dict: Dictionary): void {
  const player = requireTurn(state, intent.playerId);
  const { placements } = intent;

  // Shape first: things that make the intent malformed rather than merely
  // illegal on this board.
  if (placements.length === 0) reject('badIntent', 'a play must place at least one tile');
  for (const placement of placements) {
    if (!isBoardPos(placement.pos)) {
      reject('badIntent', `position ${placement.pos} is not on the board`);
    }
    if (!isTile(placement.tile)) {
      reject('badIntent', `"${String(placement.tile)}" is not a tile`);
    }
    if (placement.tile === BLANK && !isLetter(placement.as)) {
      reject('badIntent', 'a blank must declare the letter it stands for');
    }
  }

  // Board-rule shape: duplicates and occupied squares.
  const positions = placements.map((p) => p.pos);
  if (new Set(positions).size !== positions.length) {
    reject('badPlacement', 'two tiles cannot share a square');
  }
  for (const pos of positions) {
    if ((state.board[pos] ?? null) !== null) {
      reject('badPlacement', `${coordName(pos)} is already occupied`);
    }
  }

  requireInRack(player.rack, placements.map((p) => p.tile));

  const isFirstMove = state.board.every((square) => square === null);
  const line = validatePlacement(state.board, positions, isFirstMove);

  const resolved: ResolvedPlacement[] = placements.map((p) => {
    // Literal '_' rather than BLANK: BLANK is typed Tile, which would keep
    // TypeScript from narrowing `p.tile` to Letter in the other branch.
    if (p.tile === '_') {
      // The badIntent pass above already guaranteed `as` is a Letter; the
      // recheck is for the type system and rejects identically if ever hit.
      if (!isLetter(p.as)) reject('badIntent', 'a blank must declare the letter it stands for');
      return { pos: p.pos, letter: p.as, isBlank: true };
    }
    return { pos: p.pos, letter: p.tile, isBlank: false };
  });

  const formed = findFormedWords(state.board, resolved, line.axis);
  if (formed.length === 0) {
    // Unreachable given connectivity rules (a connected or first play always
    // forms a word of length >= 2), but a formed-nothing play must not score.
    reject('badPlacement', 'the play forms no word');
  }
  const invalid = formed.filter((w) => !dict.has(w.word)).map((w) => w.word);
  if (invalid.length > 0) {
    reject('invalidWord', `not in the dictionary: ${invalid.join(', ')}`, invalid);
  }

  const { wordScores, total, bingo } = scorePlay(formed, placements.length);

  for (const placement of resolved) {
    state.board[placement.pos] = { letter: placement.letter, isBlank: placement.isBlank };
  }
  removeFromRack(player.rack, placements.map((p) => p.tile));
  refillRack(state, player);
  player.score += total;

  const record: MoveRecord = {
    playerId: player.id,
    kind: 'play',
    words: wordScores,
    score: total,
    tilesPlayed: placements.length,
    bingo,
  };
  state.log.push(record);

  state.scorelessTurns = total > 0 ? 0 : state.scorelessTurns + 1;
  state.moveCount += 1;

  if (player.rack.length === 0 && state.bag.length === 0) {
    // Playing out with an empty bag ends the game immediately after this play.
    endGame(state, player.id);
  } else if (state.scorelessTurns >= SCORELESS_LIMIT) {
    endGame(state, null);
  } else {
    advanceTurn(state);
  }
}

function doExchange(state: GameState, intent: Extract<Intent, { type: 'exchange' }>): void {
  const player = requireTurn(state, intent.playerId);
  const { tiles } = intent;

  if (tiles.length === 0) reject('badIntent', 'an exchange must name at least one tile');
  for (const tile of tiles) {
    if (!isTile(tile)) reject('badIntent', `"${String(tile)}" is not a tile`);
  }
  requireInRack(player.rack, tiles);
  if (state.bag.length < EXCHANGE_MINIMUM_BAG) {
    reject('exchangeBlocked', `exchanging needs at least ${EXCHANGE_MINIMUM_BAG} tiles in the bag`);
  }

  // Draw the replacements FIRST, then return the exchanged tiles and
  // reshuffle from (seed, moveCount) — the exchanged tiles must not be
  // drawable as their own replacements, and the bag order must stay a pure
  // function of the seed and the intent history.
  removeFromRack(player.rack, tiles);
  const drawn = state.bag.splice(0, tiles.length);
  player.rack.push(...drawn);
  state.bag.push(...tiles);
  state.bag = seededShuffle(state.bag, `${state.seed}:${state.moveCount}`);

  state.log.push({
    playerId: player.id,
    kind: 'exchange',
    score: 0,
    tilesPlayed: tiles.length,
  });
  concludeScorelessTurn(state);
}

function doPass(state: GameState, intent: Extract<Intent, { type: 'pass' }>): void {
  const player = requireTurn(state, intent.playerId);
  state.log.push({ playerId: player.id, kind: 'pass', score: 0 });
  concludeScorelessTurn(state);
}

/**
 * The one entry point for player actions. Clones the incoming state, then
 * delegates to the (mutating) handlers above. Throws `IllegalIntentError`
 * and leaves the caller's state untouched if the intent is not legal.
 */
export function applyIntent(state: GameState, intent: Intent, dict: Dictionary): GameState {
  const next = structuredClone(state);
  switch (intent.type) {
    case 'play': doPlay(next, intent, dict); break;
    case 'exchange': doExchange(next, intent); break;
    case 'pass': doPass(next, intent); break;
    default: reject('badIntent', `no handler for ${(intent as Intent).type}`);
  }
  return next;
}
