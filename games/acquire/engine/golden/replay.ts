import type { GameState } from '../gameTypes';
import type { GoldenGame } from './types';
import { applyIntent } from '../intents';
import { buildFixture } from './fixtures';

/**
 * Threads a golden game's intents through `applyIntent` and returns every
 * intermediate state: index 0 is the built fixture, index i+1 the state after
 * `game.steps[i]`.
 *
 * The asserting equivalent is `runGoldenGame` in ./runner, which imports vitest
 * and therefore cannot be reached from app code. This module must stay free of
 * test-framework imports — the component catalog bundles it into the browser.
 *
 * A step declaring `expectError` is expected to be rejected; its state entry is
 * the unchanged prior state, so indices stay aligned with `game.steps`. The
 * rejection is not asserted here; ./runner owns that.
 */
export function replayGoldenGame(game: GoldenGame): GameState[] {
  let state = buildFixture(game.setup);
  const states: GameState[] = [state];

  for (const step of game.steps) {
    if (step.expectError) {
      try {
        applyIntent(state, step.intent);
      } catch {
        // expected; the state is unchanged by contract
      }
    } else {
      state = applyIntent(state, step.intent);
    }
    states.push(state);
  }

  return states;
}
