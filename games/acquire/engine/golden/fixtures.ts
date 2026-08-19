import type { Coord, GameState, Player, Startup } from '../gameTypes';
import type { FixtureSpec } from './types';
import { createEmptyBoard } from '../gameInit';
import { AVAILABLE_STARTUPS, PLAYER_EMOJI } from '../startups';

/**
 * Builds a `GameState` directly from authored data — no turns are played.
 * Some golden games need boards (a 40-tile chain, a pre-merger layout) that
 * cannot be reached by running intents in a test, so fixtures paint the
 * board and hand out shares/cash by hand instead.
 *
 * Two invariants a wrong fixture would silently violate, breaking every
 * golden game built on top of it:
 *  - no coord is painted twice (chains and loners share one occupancy check)
 *  - `availableShares + Σ holdings === totalShares` for every startup, i.e.
 *    authored player shares are drawn out of the pool, never conjured
 */
export function buildFixture(spec: FixtureSpec): GameState {
  const board = createEmptyBoard();

  const startups: Record<string, Startup> = Object.fromEntries(
    AVAILABLE_STARTUPS.map((cfg) => [
      cfg.id,
      {
        id: cfg.id,
        ticker: cfg.ticker,
        tiles: [],
        foundingTile: null,
        tier: cfg.tier,
        totalShares: 25,
        availableShares: 25,
        isFounded: false,
      } as Startup,
    ]),
  );

  const claim = (c: Coord, startupId?: string) => {
    if (board[c]?.placed) throw new Error(`fixture places two tiles on ${c}`);
    board[c] = startupId === undefined ? { placed: true } : { placed: true, startupId };
  };

  for (const chain of spec.chains ?? []) {
    if (chain.coords.length === 0) continue;
    const startup = startups[chain.id];
    if (!startup) throw new Error(`fixture references unknown startup ${chain.id}`);
    for (const c of chain.coords) claim(c, chain.id);
    startup.isFounded = true;
    startup.foundingTile = chain.coords[0]!; // non-empty, checked above
  }

  for (const c of spec.loners ?? []) claim(c);

  const players: Player[] = spec.players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    emoji: PLAYER_EMOJI[i % PLAYER_EMOJI.length]!, // wrapped index into a non-empty list
    cash: p.cash ?? 6000,
    hand: [...(p.hand ?? [])],
    portfolio: {},
  }));

  spec.players.forEach((p, i) => {
    const player = players[i]!; // `players` was mapped from `spec.players`
    for (const [startupId, qty] of Object.entries(p.shares ?? {})) {
      const startup = startups[startupId];
      if (!startup) throw new Error(`fixture gives shares in unknown startup ${startupId}`);
      if (qty > startup.availableShares) {
        throw new Error(
          `fixture over-allocates ${startupId}: only ${startup.availableShares} left, wanted ${qty}`,
        );
      }
      startup.availableShares -= qty;
      player.portfolio[startupId] = (player.portfolio[startupId] ?? 0) + qty;
    }
  });

  return {
    seed: 'golden-fixture',
    stage: spec.stage ?? 'play',
    players,
    turnIndex: spec.currentPlayerIndex ?? 0,
    board,
    bag: [...(spec.bag ?? [])],
    discarded: [],
    log: [],
    nextStepId: 1,
    startups,
    currentBuyCount: 0,
  };
}
