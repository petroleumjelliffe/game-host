import type { GameState } from './gameTypes.js';

/**
 * Whose input the rules are waiting on. Turn order is a fixed rotation, so
 * this is `players[turnIndex]` — null once the game is over, which is what
 * lets sessions and servers gate arriving intents with one question.
 */
export function getCurrentActor(state: GameState): string | null {
  if (state.stage === 'over') return null;
  return state.players[state.turnIndex]?.id ?? null;
}
