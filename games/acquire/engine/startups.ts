import type { GameState, StartupId } from './gameTypes';
import { getStartupSize } from './gameHelpers';

export const SAFE_SIZE = 11;
export const END_SIZE = 41;

/**
 * Rule constants with more than one consumer. They live here, next to
 * SAFE_SIZE/END_SIZE, because every one of them used to be duplicated as a
 * literal across `intents.ts`, `gameInit.ts` and `gameLogic.ts` — the
 * validator's copy and the mutator's copy could drift apart silently.
 * Import them; never re-declare them.
 */
/** Shares a player may buy in one turn, cumulative across `buyShares` calls. */
export const MAX_BUYS_PER_TURN = 3;
/** Tiles a player holds at the start of their turn. */
export const HAND_SIZE = 6;
/** Absorbed shares handed in per survivor share gained in a merger trade. */
export const TRADE_RATIO = 2;
/** Non-empty by construction, and typed that way so `[0]` needs no assertion. */
export const SIZE_THRESHOLDS: readonly [number, ...number[]] = [2, 3, 4, 5, 6, 11, 21, 31, 41];
/**
 * Acquire seats 2–6. A game rule, so it lives with the rules — and
 * deliberately *not* `PLAYER_EMOJI.length`, which is a decoration list meant
 * to grow into a larger selectable set. Deriving the cap from it would mean
 * adding an emoji silently changed how many people can play.
 */
export const MAX_PLAYERS = 6;
/** Acquire needs two to start. The other half of the 2–6 range. */
export const MIN_PLAYERS = 2;
/** Decoration, not identity, and not a capacity. Assigned by seat index. */
export const PLAYER_EMOJI: readonly string[] = ['🦊', '🐢', '🦁', '🐙', '🦉', '🐝'];

export interface StartupConfig { id: StartupId; tier: 0 | 1 | 2; ticker: string }

export const AVAILABLE_STARTUPS: readonly StartupConfig[] = [
  { id: 'Gobble',        tier: 2, ticker: '$G'  },
  { id: 'Scrapple',      tier: 2, ticker: '$S'  },
  { id: 'PaperfulPost',  tier: 0, ticker: '$PP' },
  { id: 'CamCrooned',    tier: 1, ticker: '$C'  },
  { id: 'Messla',        tier: 0, ticker: '$M'  },
  { id: 'ZuckFace',      tier: 1, ticker: '$Z'  },
  { id: 'WrecksonMobil', tier: 1, ticker: '$W'  },
];

const STARTUP_ID_SET: ReadonlySet<string> = new Set(AVAILABLE_STARTUPS.map((s) => s.id));

/**
 * Narrowing guard for the many places `state.startups`/`TileCell.startupId`
 * hand back a plain `string` (that field's declared type — see the `todo`
 * on `Startup.id` in gameTypes.ts) where a `StartupId` is actually needed.
 * Prefer this over `as StartupId`: it is a real runtime check against the
 * fixed 7-startup set, not an unchecked assertion.
 */
export function isStartupId(id: string): id is StartupId {
  return STARTUP_ID_SET.has(id);
}

/** Base prices at each entry in SIZE_THRESHOLDS, for tier 0. Tier n adds n × 100. */
const TIER0_PRICES: readonly number[] = [200, 300, 400, 500, 600, 700, 800, 900, 1000];
// Parallel to SIZE_THRESHOLDS — same length, band-for-band — which is what
// makes the indexed reads below safe without a bounds check.

export function getSharePriceAtSize(tier: 0 | 1 | 2, size: number): number {
  if (size < SIZE_THRESHOLDS[0]) return 0;
  let band = 0;
  for (let i = 0; i < SIZE_THRESHOLDS.length; i++) {
    if (size >= SIZE_THRESHOLDS[i]!) band = i;
  }
  return TIER0_PRICES[band]! + tier * 100;
}

export function getNextSharePrice(state: GameState, startupId: StartupId): number | null {
  const startup = state.startups[startupId];
  if (!startup) return null;
  const size = getStartupSize(state, startupId);
  const now = getSharePriceAtSize(startup.tier, size);
  const then = getSharePriceAtSize(startup.tier, size + 1);
  return then > now ? then : null;
}
