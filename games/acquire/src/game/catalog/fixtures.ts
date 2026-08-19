import { ALL_GOLDEN_GAMES, replayGoldenGame } from '../../../engine/golden';
import type { GameState } from '../../../engine/gameTypes';

/**
 * Catalog states come from the engine wherever a golden game covers them.
 *
 * This is not a formality. `prototype/states.html` prices Gobble at $1000 for a
 * 41-tile chain where `getSharePriceAtSize` says $1200, and that same wrong
 * figure reached two Phase 0 task briefs. Replaying a golden game makes the
 * whole class of error impossible: the numbers come from `applyIntent`.
 *
 * Imports the `engine/golden` barrel, never `engine/golden/runner` — the runner
 * imports vitest and would pull the test framework into the browser bundle.
 * `npm run check:bundle` is the guard.
 */

/** Replays are cached: the catalog asks for many states out of few games. */
const REPLAYS = new Map<string, GameState[]>();

function statesFor(gameId: string): GameState[] {
  const cached = REPLAYS.get(gameId);
  if (cached) return cached;

  const game = ALL_GOLDEN_GAMES.find((g) => g.id === gameId);
  if (!game) {
    throw new Error(
      `No golden game ${gameId}. Known games: ${ALL_GOLDEN_GAMES.map((g) => g.id).join(', ')}`,
    );
  }

  const states = replayGoldenGame(game);
  REPLAYS.set(gameId, states);
  return states;
}

/**
 * The state after `stepIndex` intents of `gameId`: index 0 is the built
 * fixture, index i+1 the state after `game.steps[i]`.
 */
export function goldenState(gameId: string, stepIndex: number): GameState {
  const states = statesFor(gameId);
  const state = states[stepIndex];
  if (!state) {
    throw new Error(
      `Golden game ${gameId} has no step ${stepIndex} — it has ${states.length} states (0..${states.length - 1}).`,
    );
  }
  return state;
}

export function goldenTitle(gameId: string): string {
  const game = ALL_GOLDEN_GAMES.find((g) => g.id === gameId);
  if (!game) throw new Error(`No golden game ${gameId}.`);
  return game.title;
}

/**
 * Where a catalog state came from.
 *
 * The golden games were authored as *rules* tests, not visual ones, so some
 * catalog states have no golden game behind them and never will — empty
 * staging, the atom vocabulary, a zero-count stack. Those are `authored`, and
 * the union is discriminated so the catalog can label them visibly: nobody
 * should be able to mistake an authored fixture for engine-verified truth.
 */
export type CatalogFixture =
  | { source: 'golden'; gameId: string; stepIndex: number; state: GameState }
  | { source: 'authored'; note: string };

export function fromGolden(gameId: string, stepIndex: number): CatalogFixture {
  return { source: 'golden', gameId, stepIndex, state: goldenState(gameId, stepIndex) };
}

export function authored(note: string): CatalogFixture {
  return { source: 'authored', note };
}
