/**
 * Game creation. Everything random — the bag order and the seating order —
 * comes from the seed, so the same seed and player list always produce the
 * identical opening state.
 */
import type { GameState, PlayerState } from './gameTypes.js';
import type { Tile } from './constants.js';
import {
  ALL_TILES,
  BOARD_SQUARES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RACK_SIZE,
  TILE_DISTRIBUTION,
} from './constants.js';
import { seededShuffle } from './rng.js';

export function createInitialGame(
  seed: string,
  players: { id: string; name: string }[],
): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RangeError(
      `player count must be ${MIN_PLAYERS}..${MAX_PLAYERS}, got ${players.length}`,
    );
  }

  const fullBag: Tile[] = [];
  for (const tile of ALL_TILES) {
    for (let i = 0; i < TILE_DISTRIBUTION[tile]; i++) fullBag.push(tile);
  }
  const bag = seededShuffle(fullBag, `${seed}:bag`);

  // Seating is shuffled from the seed too — a distinct sub-seed so the two
  // shuffles cannot correlate.
  const seated = seededShuffle(players, `${seed}:order`);
  const playerStates: PlayerState[] = seated.map((p) => ({
    id: p.id,
    name: p.name,
    rack: bag.splice(0, RACK_SIZE),
    score: 0,
  }));

  return {
    seed,
    stage: 'playing',
    players: playerStates,
    turnIndex: 0,
    board: Array.from({ length: BOARD_SQUARES }, () => null),
    bag,
    scorelessTurns: 0,
    moveCount: 0,
    log: [],
  };
}
