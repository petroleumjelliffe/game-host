import type { GameState } from './gameTypes';

/**
 * Whose input the rules are waiting on.
 *
 * This is the seam Phase 2a's whole interaction model hangs off: when this id
 * changes, a segment closes — the pass-the-device curtain rises, the undo range
 * resets, and snapshots before the boundary are pruned. It lives in `engine/`
 * rather than `src/` because Phase 3's server needs the same answer to decide
 * whether an arriving intent came from the player it was waiting for.
 *
 * The stages below are the ones `applyIntent` actually produces.
 * `setup`, `dealHands`, `mergerPayout`, `liquidation` and `liquidationPrompt`
 * exist in the `Stage` union but only the legacy `gameLogic` path (used by
 * `src/Game.tsx`, deleted in Phase 3b) reaches them; they fall through to the
 * active player so a legacy state renders rather than crashes.
 */
export function getCurrentActor(state: GameState): string | null {
  if (state.stage === 'end') return null;

  // The opening draw is taken one player at a time, in seat order, and the
  // number of draws recorded so far is the cursor. Because this function is
  // the segment seam, this single line is what makes the draw behave like any
  // other move: the curtain rises between draws, each draw is its own commit
  // on the server, and the toast names whoever the table is waiting on.
  if (state.stage === 'draw') {
    return state.players[state.turnOrderDraws?.length ?? 0]?.id ?? null;
  }

  if (state.stage === 'mergerLiquidation') {
    const ctx = state.mergerContext;
    if (!ctx) return null;
    return ctx.shareholderQueue[ctx.currentShareholderIndex] ?? null;
  }

  return state.players[state.turnIndex]?.id ?? null;
}
