import type { GoldenGame } from './types';
import type { Coord, Row } from '../gameHelpers';

/**
 * Shared layout for all six games: `Messla` on row B, `ZuckFace` on row D,
 * `Gobble` on row F, and the merging tile on row C (between B and D) or row
 * E (between D and F). `C1` is adjacent to `B1`, `D1` and `C2` — confirmed
 * empirically against the live engine for every game below (see
 * task-12-report.md), not just read off `INTERFACE-FACTS.md`.
 */
const row = (letter: Row, n: number): Coord[] =>
  Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as Coord);

/**
 * G2: two-way merger — bigger chain survives, holders liquidate.
 */
const G2: GoldenGame = {
  id: 'G2',
  title: 'two-way merger — bigger chain survives, holders liquidate',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 4 } },
      // Sam's Messla holding is not narrative — it exists purely to pin
      // Messla's `availableShares` down to 1 (25 total − 24 held), so the
      // rejected-liquidation steps below can exercise `notEnoughShares`
      // against a real, non-zero survivor pool without disturbing Alex's
      // own liquidation two steps later (which needs exactly 1 available).
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 2, Messla: 24 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 6) },
      { id: 'ZuckFace', coords: row('D', 3) },   // tier 1, size 3 → $400
    ],
  },
  steps: [
    {
      name: 'Alex merges ZuckFace into Messla',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'mergerLiquidation',
        founded: { ZuckFace: false, Messla: true },
        chainSize: { Messla: 10, ZuckFace: 0 },
        // Alex majority 4 → $4,000; Sam minority 2 → $2,000
        cash: { p1: 4000, p2: 2000 },
        // A merging placement now records the played coord like every other
        // placement branch does ('Placed a tile'), then the merger itself.
        // Before that fix the log's account of a merger turn was "nothing
        // happened, then two chains merged somewhere". `doPlaceTile` settles
        // the merger payout synchronously in the same intent
        // (`settleMergerPayout` — see intents.ts), which is why the payout
        // entry lands in this step and not a later one. One entry covers the
        // whole payout, however many payees: it carries them as a payload.
        logPhases: ['Placed a tile', 'Merger', 'Merger payout'],
      },
    },
    {
      name: 'counts that do not add up to the 4 shares Alex holds are refused',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 1, trade: 1, keep: 1 },
      expectError: 'shareCountMismatch',
    },
    {
      name: 'an odd trade count is refused — shares trade two-for-one',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 0, trade: 3, keep: 1 },
      expectError: 'oddTradeCount',
    },
    {
      // Trading all 4 held shares asks for 2 survivor Messla shares, but
      // Sam's 24-share holding (see setup) has left only 1 available.
      name: 'trading for more survivor shares than Messla has available is refused',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 0, trade: 4, keep: 0 },
      expectError: 'notEnoughShares',
    },
    {
      name: 'Alex sells two and trades two',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 2, trade: 2, keep: 0 },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 4000 + 800 },
        shares: { p1: { ZuckFace: 0, Messla: 1 } },
        // `completePlayerMergerLiquidation` logs the trade and the sale as
        // two separate 'Liquidated shares' entries, not one (verified
        // against the live engine — task-12-report.md).
        logPhases: ['Liquidated shares', 'Liquidated shares'],
      },
    },
    {
      name: 'Sam sells out, which closes the merger',
      intent: { type: 'liquidate', playerId: 'p2', startupId: 'ZuckFace', sell: 2, trade: 0, keep: 0 },
      then: { stage: 'buy', cash: { p2: 2000 + 800 }, shares: { p2: { ZuckFace: 0 } } },
    },
  ],
  final: { chainSize: { Messla: 10 }, boardOwner: { D1: 'Messla', C1: 'Messla' } },
};

// The tied-minority bug: before Task 5, Sam and Jordan EACH received the full $3,000.
const G3: GoldenGame = {
  id: 'G3',
  title: 'tied minority — the minority bonus is split, not paid twice',
  setup: {
    players: [
      { name: 'Alex',   cash: 0, hand: ['C1'], shares: { ZuckFace: 7 } },
      { name: 'Sam',    cash: 0, shares: { ZuckFace: 4 } },
      { name: 'Jordan', cash: 0, shares: { ZuckFace: 4 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 5) },   // tier 1, size 5 → $600
    ],
  },
  steps: [
    {
      name: 'the merger pays $6,000 majority and splits $3,000 between the tied pair',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 6000, p2: 1500, p3: 1500 },
      },
    },
  ],
};

/**
 * G4: tied majority — both pots combined, split, rounded up to $100.
 */
const G4: GoldenGame = {
  id: 'G4',
  title: 'tied majority — both pots combined, split, rounded up to $100',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 5 } },
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 5 } },
      { name: 'Jordan', cash: 0, shares: { ZuckFace: 1 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 2) },   // tier 1, size 2 → $300
    ],
  },
  steps: [
    {
      name: '($3,000 + $1,500) / 2 = $2,250, rounded up to $2,300 each; Jordan gets nothing',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        // Three players still hold absorbed ZuckFace shares, so — like G5 —
        // the merger doesn't fall straight through to `buy`.
        stage: 'mergerLiquidation',
        cash: { p1: 2300, p2: 2300, p3: 0 },
        // Bonuses are paid in cash; nobody's shares have moved yet — the
        // absorbed holdings are exactly what the fixture handed out.
        shares: { p1: { ZuckFace: 5 }, p2: { ZuckFace: 5 }, p3: { ZuckFace: 1 } },
        hand: { p1: [] },
      },
    },
  ],
};

// The sole-holder bug: before Task 5, Alex received the majority bonus only.
//
// ZuckFace is tier 1 (AVAILABLE_STARTUPS in engine/startups.ts), and at the
// moment of the merge it stands at size 2 (row('D', 2)).
// getSharePriceAtSize(1, 2) walks SIZE_THRESHOLDS = [2,3,4,5,6,11,21,31,41],
// lands on band 0 (size 2 is the first threshold met), TIER0_PRICES[0] = 200,
// plus tier * 100 = 100, giving a share price of $300 — confirmed by calling
// the function directly: `getSharePriceAtSize(1, 2) === 300`.
// computeChainBonuses (engine/bonuses.ts) pays a sole holder both pots
// combined as ONE entry of type 'both': majorityPot (price * 10 = $3,000) +
// minorityPot (price * 5 = $1,500) = $4,500, not two separate entries that
// merely sum to the same number.
const G5: GoldenGame = {
  id: 'G5',
  title: 'sole holder — majority and minority paid together as one figure',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 3 } },
      { name: 'Sam',  cash: 0 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: row('D', 2) },   // tier 1, size 2 → $300
    ],
  },
  steps: [
    {
      name: 'Alex takes $3,000 + $1,500 = $4,500 as a single combined bonus',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        // Alex is still the sole holder of the absorbed ZuckFace shares, so
        // the merger doesn't fall straight through to `buy` — there's one
        // shareholder left to resolve (sell/trade/keep) before it does.
        stage: 'mergerLiquidation',
        cash: { p1: 4500, p2: 0 },
        // NOT pinned with `finalScoreBonuses` here — verified experimentally
        // that it cannot be: `mergeStartups` (engine/gameLogic.ts) sets
        // ZuckFace.isFounded = false synchronously, in the same `placeTile`
        // intent that computes this very bonus and before
        // `prepareMergerPayout` even runs. `finalScore()`'s bonus list is
        // scoped to `foundedChains(state)` (engine/endGame.ts), so a merged
        // chain's bonus is never visible through it, at any step, in this
        // game or any other — see task-6-report.md for the reproduction.
        // The $4,500 total is pinned via `cash` above; the "one entry, not
        // two summed entries" SHAPE this step's title promises is pinned
        // instead by `computeChainBonuses`'s own unit coverage in
        // engine/bonuses.test.ts, not by the golden catalogue.
      },
    },
  ],
};

/**
 * G6: absorbed chain with no shareholders — no payout, no liquidation.
 */
const G6: GoldenGame = {
  id: 'G6',
  title: 'absorbed chain with no shareholders — no payout, no liquidation',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'] },
      { name: 'Sam',  cash: 0 },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 6) },
      { id: 'ZuckFace', coords: row('D', 3) },
    ],
  },
  steps: [
    {
      name: 'the merger completes straight into the buying stage',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'buy',
        cash: { p1: 0, p2: 0 },
        founded: { ZuckFace: false },
        availableShares: { ZuckFace: 25 },
        // The placement records its coord first ('Placed a tile'), then the
        // merger. With no shareholders, `advanceToNextAbsorbedStartup`
        // auto-cleans ZuckFace ('Liquidated shares') and then closes the
        // merger ('Merger: Merger complete. Entering buy phase.') in the
        // same intent — so four entries, not two.
        logPhases: ['Placed a tile', 'Merger', 'Liquidated shares', 'Merger'],
      },
    },
    {
      // Messla is the survivor (still founded), now size 10 (6 + 3 + C1):
      // getSharePriceAtSize(0, 10) = 600. Alex's cash is still 0 — nobody
      // has bought or sold anything in this game — so any purchase is
      // refused, not silently free.
      name: 'Alex has no cash, so buying a share is refused rather than free',
      intent: { type: 'buyShares', playerId: 'p1', picks: ['Messla'] },
      expectError: 'notEnoughCash',
    },
  ],
};

/**
 * G7: three-way merger — one survivor, two absorbed, both paid out — then
 * carried through liquidating each absorbed chain in turn.
 *
 * `C1` touches `B1` (Messla), `D1` (Gobble) and `C2` (ZuckFace) — a genuine
 * three-way merge, confirmed by running it against the live engine.
 *
 * Liquidation ORDER: `previewPlacement` (engine/placement.ts) builds
 * `touchingIds` from `getAdjacentCoords(C1)`, which yields neighbours in a
 * fixed north/south/west/east order — for C1 that's [B1, D1, C2], i.e.
 * [Messla, Gobble, ZuckFace]. It then sorts descending by size (a stable
 * sort), so ties keep that relative order. Messla (8) sorts first; Gobble
 * and Gobble/ZuckFace are tied at size 2, so the pre-sort order [Gobble,
 * ZuckFace] survives — `absorbedIds` ends up `['Gobble', 'ZuckFace']`.
 * Confirmed against the live engine (`state.mergerContext.absorbedIds` after
 * the merge step below): Gobble is liquidated first even though ZuckFace
 * has the larger shareholder queue (2 holders vs Gobble's 1) — chain order
 * is decided by adjacency/size, never by shareholder count. This wasn't
 * surprising once traced, but it was previously unpinned: G6's shorter
 * absorbed-chain path never exercises the ordering between two absorbed
 * chains at all.
 *
 * Within each absorbed chain, `buildShareholderQueue` starts at
 * `state.turnIndex` and wraps — confirmed live: Gobble's queue is `['p1']`
 * (Sam holds none), and ZuckFace's queue is `['p1', 'p2']` (Alex first,
 * since turnIndex still points at him — the merger never advances whose
 * turn it is).
 */
const G7: GoldenGame = {
  id: 'G7',
  title: 'three-way merger — one survivor, two absorbed, both paid out',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { ZuckFace: 3, Gobble: 2 } },
      { name: 'Sam',  cash: 0, shares: { ZuckFace: 1 } },
    ],
    chains: [
      { id: 'Messla',   coords: row('B', 8) },
      { id: 'ZuckFace', coords: ['C2', 'C3'] },
      { id: 'Gobble',   coords: ['D1', 'D2'] },
    ],
  },
  steps: [
    {
      name: 'Messla survives; ZuckFace and Gobble are both absorbed and both pay out',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        founded: { Messla: true, ZuckFace: false, Gobble: false },
        chainSize: { Messla: 8 + 1 + 2 + 2 },
        stage: 'mergerLiquidation',
        // Gobble (tier 2, size 2 → $400): Alex is the sole holder of 2
        // shares → $4,000 + $2,000 = $6,000 combined.
        // ZuckFace (tier 1, size 2 → $300): Alex majority (3) → $3,000,
        // Sam minority (1) → $1,500.
        // Alex: $6,000 + $3,000 = $9,000. Sam: $1,500.
        cash: { p1: 9000, p2: 1500 },
      },
    },
    {
      // Only Alex holds Gobble, so this succeeding (rather than being
      // rejected `notYourTurn`) is itself proof Gobble is queued first.
      name: 'Gobble is liquidated first — Alex, its only shareholder, sells out at $400/share',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'Gobble', sell: 2, trade: 0, keep: 0 },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 9000 + 2 * 400 },
        shares: { p1: { Gobble: 0 } },
        availableShares: { Gobble: 25 },
        founded: { Gobble: false },
        // The sale itself, then `advanceToNextAbsorbedStartup`'s own
        // "Gobble has been liquidated" cleanup entry as the queue empties.
        logPhases: ['Liquidated shares', 'Liquidated shares'],
      },
    },
    {
      // Alex still acts before Sam on ZuckFace even though it's a *different*
      // absorbed chain — the per-chain queue restarts from the current
      // player (turnIndex), not from wherever Gobble's queue left off.
      name: 'ZuckFace is liquidated next — Alex again, ahead of Sam, at $300/share',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'ZuckFace', sell: 3, trade: 0, keep: 0 },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 9000 + 2 * 400 + 3 * 300 },
        shares: { p1: { ZuckFace: 0 } },
        availableShares: { ZuckFace: 24 },
        logPhases: ['Liquidated shares'],
      },
    },
    {
      name: 'Sam sells out, which closes the merger and returns both absorbed brands to the shelf',
      intent: { type: 'liquidate', playerId: 'p2', startupId: 'ZuckFace', sell: 1, trade: 0, keep: 0 },
      then: {
        stage: 'buy',
        currentPlayer: 'p1',
        cash: { p2: 1500 + 1 * 300 },
        shares: { p2: { ZuckFace: 0 } },
        availableShares: { Gobble: 25, ZuckFace: 25 },
        founded: { Gobble: false, ZuckFace: false },
        logPhases: ['Liquidated shares', 'Liquidated shares', 'Merger'],
      },
    },
  ],
  final: {
    stage: 'buy',
    currentPlayer: 'p1',
    // Both absorbed chains' tiles were repainted onto the survivor.
    chainSize: { Messla: 13, Gobble: 0, ZuckFace: 0 },
    founded: { Messla: true, Gobble: false, ZuckFace: false },
    boardOwner: { C1: 'Messla', D1: 'Messla', D2: 'Messla', C2: 'Messla', C3: 'Messla' },
    cash: { p1: 9000 + 2 * 400 + 3 * 300, p2: 1500 + 1 * 300 },
  },
};

/**
 * G13: tied merger — the placing player picks which equal-size chain lives.
 *
 * The only golden game that exercises the `chooseSurvivor` intent, and the
 * only one that reaches the tied branch of `handleTilePlacement`. Note this
 * is a different thing from G3/G4's "tied bonus": those are
 * `computeChainBonuses` cases with a single unambiguous survivor, decided
 * before any player is asked anything. Here two chains are the *same size*,
 * so the engine cannot pick a survivor itself — it parks on
 * `stage: 'chooseSurvivor'` and waits. Conflating the two is why this path
 * shipped with no golden coverage at all.
 *
 * Alex deliberately saves ZuckFace, the chain he holds nothing in, so the
 * assertions prove the *chosen* brand survives rather than merely agreeing
 * with whatever the untied path would have picked: Messla (which he holds
 * 4 of) is the one absorbed and liquidated.
 */
const G13: GoldenGame = {
  id: 'G13',
  title: 'tied merger — the placing player picks which equal-size chain lives',
  setup: {
    players: [
      { name: 'Alex', cash: 0, hand: ['C1'], shares: { Messla: 4 } },
      { name: 'Sam',  cash: 0, shares: { Messla: 2 } },
    ],
    chains: [
      { id: 'Messla',   coords: ['B1', 'B2', 'B3'] },  // tier 0, size 3 → $300
      { id: 'ZuckFace', coords: ['D1', 'D2', 'D3'] },  // same size — hence the tie
    ],
  },
  steps: [
    {
      name: 'C1 joins two equal-size chains, so the engine asks instead of deciding',
      intent: { type: 'placeTile', playerId: 'p1', coord: 'C1' },
      then: {
        stage: 'chooseSurvivor',
        // Nothing has merged yet: both chains are intact, C1 is on the board
        // but unowned, and no bonus has been paid.
        chainSize: { Messla: 3, ZuckFace: 3 },
        founded: { Messla: true, ZuckFace: true },
        boardOwner: { C1: null },
        cash: { p1: 0, p2: 0 },
        hand: { p1: [] },
        // The tied branch used to append nothing at all — the one
        // board-mutating placement outcome with no trace in the log.
        logPhases: ['Placed a tile'],
      },
    },
    {
      name: 'a brand that is not one of the tied pair is refused',
      intent: { type: 'chooseSurvivor', playerId: 'p1', startupId: 'Gobble' },
      expectError: 'notATiedSurvivor',
    },
    {
      name: 'Alex saves ZuckFace, so Messla is absorbed and pays out',
      intent: { type: 'chooseSurvivor', playerId: 'p1', startupId: 'ZuckFace' },
      then: {
        stage: 'mergerLiquidation',
        // 3 (ZuckFace) + 1 (C1) + 3 (absorbed Messla) = 7
        chainSize: { ZuckFace: 7, Messla: 0 },
        founded: { ZuckFace: true, Messla: false },
        boardOwner: { C1: 'ZuckFace', B1: 'ZuckFace', D1: 'ZuckFace' },
        // Messla at size 3, tier 0 → $300. Alex majority 4 → $3,000;
        // Sam minority 2 → $1,500.
        cash: { p1: 3000, p2: 1500 },
        logPhases: ['Merger', 'Merger payout'],
      },
    },
    {
      name: 'Alex sells two Messla and trades the other two for one ZuckFace',
      intent: { type: 'liquidate', playerId: 'p1', startupId: 'Messla', sell: 2, trade: 2, keep: 0 },
      then: {
        stage: 'mergerLiquidation',
        cash: { p1: 3000 + 2 * 300 },
        shares: { p1: { Messla: 0, ZuckFace: 1 } },
        availableShares: { ZuckFace: 24 },
        logPhases: ['Liquidated shares', 'Liquidated shares'],
      },
    },
    {
      name: 'Sam sells out, which closes the merger and returns Messla to the shelf',
      intent: { type: 'liquidate', playerId: 'p2', startupId: 'Messla', sell: 2, trade: 0, keep: 0 },
      then: {
        stage: 'buy',
        cash: { p2: 1500 + 2 * 300 },
        shares: { p2: { Messla: 0 } },
        // Messla is unfounded and its whole pool is available again.
        availableShares: { Messla: 25 },
      },
    },
  ],
  final: { stage: 'buy', currentPlayer: 'p1', chainSize: { ZuckFace: 7, Messla: 0 } },
};

export const MERGER_GAMES: GoldenGame[] = [G2, G3, G4, G5, G6, G7, G13];
