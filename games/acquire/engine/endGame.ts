import type { GameState, StartupId } from './gameTypes';
import { getStartupSize } from './gameHelpers';
import { SAFE_SIZE, END_SIZE, isStartupId } from './startups';
import { getSharePrice } from './gameLogic';
import { computeChainBonuses } from './bonuses';

export type EndReason =
  | { kind: 'size41'; startupId: StartupId; size: number }
  | { kind: 'allSafe'; startupIds: StartupId[] };

export interface EndCondition {
  met: boolean;
  reasons: EndReason[];
}

/** Chains that are founded and currently standing on the board (size > 0). */
function foundedChains(state: GameState): { id: StartupId; size: number }[] {
  // `Startup.id` is declared `string` (see the `todo` in gameTypes.ts), but
  // every founded startup's id is always one of the 7 `StartupId` literals —
  // `isStartupId` narrows it for real instead of asserting it away.
  const result: { id: StartupId; size: number }[] = [];
  for (const s of Object.values(state.startups)) {
    if (!s.isFounded || !isStartupId(s.id)) continue;
    const size = getStartupSize(state, s.id);
    if (size > 0) result.push({ id: s.id, size });
  }
  return result;
}

/**
 * A pure query: whether an end condition currently holds, and which one(s).
 * Never ends the game by itself — declaring the end is a separate intent
 * that a later task adds, since a met condition can be declined.
 */
export function getEndCondition(state: GameState): EndCondition {
  const chains = foundedChains(state);
  if (chains.length === 0) return { met: false, reasons: [] };

  const reasons: EndReason[] = [];
  for (const c of chains) {
    if (c.size >= END_SIZE) {
      reasons.push({ kind: 'size41', startupId: c.id, size: c.size });
    }
  }
  if (chains.every((c) => c.size >= SAFE_SIZE)) {
    reasons.push({ kind: 'allSafe', startupIds: chains.map((c) => c.id) });
  }
  return { met: reasons.length > 0, reasons };
}

export interface FinalScoreReport {
  reason: EndReason | null;
  players: { id: string; name: string; emoji: string; cash: number }[];
  chains: { id: StartupId; size: number; price: number }[];
  holdings: Record<string, Record<string, number>>;
  bonuses: {
    chainId: StartupId;
    playerId: string;
    type: 'majority' | 'minority' | 'both';
    amount: number;
  }[];
}

/**
 * Builds the end-of-game report consumed by finalScoring() in
 * prototype/components.js. Pure: never mutates state, never banks bonuses
 * into cash. Sorting into total order and formatting (e.g. em-dashes for
 * empty cells) are the view's job.
 */
export function finalScore(state: GameState): FinalScoreReport {
  const chains = foundedChains(state).map((c) => ({
    id: c.id,
    size: c.size,
    price: getSharePrice(state, c.id),
  }));

  const holdings: FinalScoreReport['holdings'] = {};
  for (const p of state.players) {
    const playerHoldings: Record<string, number> = {};
    for (const c of chains) {
      const qty = p.portfolio[c.id] ?? 0;
      if (qty > 0) playerHoldings[c.id] = qty;
    }
    holdings[p.id] = playerHoldings;
  }

  const bonuses: FinalScoreReport['bonuses'] = [];
  for (const c of chains) {
    const perChain = computeChainBonuses(
      c.id,
      c.price,
      state.players.map((p) => ({
        playerId: p.id,
        playerName: p.name,
        shares: p.portfolio[c.id] ?? 0,
      })),
    );
    for (const b of perChain) {
      bonuses.push({ chainId: c.id, playerId: b.playerId, type: b.type, amount: b.amount });
    }
  }

  return {
    reason: getEndCondition(state).reasons[0] ?? null,
    players: state.players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, cash: p.cash })),
    chains,
    holdings,
    bonuses,
  };
}
