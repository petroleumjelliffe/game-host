import type { GameState, Startup, Player, TileCell } from "./gameTypes";
import { generateAllCoords, shuffleSeeded, Coord } from "./gameHelpers";
import { AVAILABLE_STARTUPS, PLAYER_EMOJI, HAND_SIZE } from "./startups";

/**
 * Deal starting hands: round-robin from the bag, one tile per seat per round,
 * so consecutive bag positions go to different players and the odds stay even
 * across the table however the shuffle fell.
 *
 * Called from `doDrawTurnOrderTile` when the last draw lands — not from
 * `createInitialGame` — because the turn-order draw pulls from the *entire*
 * bag and hands come from what is left, the bag minus the tiles now on the
 * board (owner sequencing, which is tabletop Acquire's). Dealing at init made
 * the dealt tiles undrawable for turn order, which is that procedure
 * backwards.
 */
export function dealStartingHands(state: GameState): void {
  let dealt = 0;
  while (dealt < HAND_SIZE) {
    let anyDealtThisRound = false;
    for (const p of state.players) {
      if (p.hand.length >= HAND_SIZE) continue;
      const tile = state.bag.shift();
      if (!tile) break;
      p.hand.push(tile);
      anyDealtThisRound = true;
    }
    if (!anyDealtThisRound) break;
    dealt += 1;
  }
}

export function createEmptyBoard(): Record<Coord, TileCell> {
  const b: Record<string, TileCell> = {};
  for (const c of generateAllCoords()) b[c] = { placed: false };
  return b as Record<Coord, TileCell>;
}
export function createInitialGame(seed: string, names: string[]): GameState {
  const bag = shuffleSeeded(generateAllCoords(), seed);
  const board = createEmptyBoard();
  const players: Player[] = names.map((n, i) => ({
    id: `p${i + 1}`,
    name: n,
    emoji: PLAYER_EMOJI[i % PLAYER_EMOJI.length]!, // wrapped index into a non-empty list
    cash: 6000,
    hand: [],
    portfolio: {},
  }));
  const startups: Record<string, Startup> = Object.fromEntries(
    AVAILABLE_STARTUPS.map((s) => [
      s.id,
      {
        ...s,
        tiles: [],
        foundingTile: null,
        totalShares: 25,
        availableShares: 25,
        isFounded: false,
      },
    ])
  );

  // No hands yet — the turn-order draw comes first and pulls from this whole
  // bag. `dealStartingHands` runs when the last draw lands.
  return {
    seed,
    stage: "draw",
    players,
    turnIndex: 0,
    board,
    bag,
    discarded: [],
    startups,
    log: [],
    nextStepId: 1,
    // availableStartups: AVAILABLE_STARTUPS.map((s) => s.id), //list of ids
  };
}
