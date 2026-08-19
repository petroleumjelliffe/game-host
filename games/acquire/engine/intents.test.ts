import { describe, it, expect } from 'vitest';
import { applyIntent, IllegalIntentError } from './intents';
import { createTestGameState, giveShares, setupGameWithStartups } from './testHelpers';
import { buildFixture } from './golden/fixtures';
import { createInitialGame } from './gameInit';
import { generateAllCoords, compareTiles } from './gameHelpers';
import { ALL_GOLDEN_GAMES } from './golden';
import { replayGoldenGame } from './golden/replay';
import type { GameState, StartupId } from './gameTypes';
import type { Coord, Row } from './gameHelpers';

function playing(state: GameState = createTestGameState()): GameState {
  state.stage = 'play';
  state.turnIndex = 0;
  return state;
}

/** Runs `fn`, asserts it threw an IllegalIntentError, and returns the code. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(IllegalIntentError);
    return (e as IllegalIntentError).code;
  }
  throw new Error('expected applyIntent to throw, but it returned');
}

/**
 * Messla (6 tiles, row B) and ZuckFace (3 tiles, row D). C1 is adjacent to
 * B1 and D1, so placing it merges the two — Messla survives on size.
 */
function mergeFixture(): GameState {
  return playing(setupGameWithStartups([
    { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], tier: 0 },
    { id: 'ZuckFace', tiles: ['D1', 'D2', 'D3'], tier: 1 },
  ]));
}

/**
 * Three chains all touching C1 (its only neighbours are B1, D1 and C2), laid
 * out so that no two chains touch each other:
 *   Messla   A1 A2 A3 B1   (4)   ┐ tied on size
 *   ZuckFace D1 E1 E2 E3   (4)   ┘
 *   Gobble   C2 C3         (2)   — absorbed either way
 */
function tiedMergeFixture(): GameState {
  return playing(setupGameWithStartups([
    { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'B1'], tier: 0 },
    { id: 'ZuckFace', tiles: ['D1', 'E1', 'E2', 'E3'], tier: 1 },
    { id: 'Gobble', tiles: ['C2', 'C3'], tier: 2 },
  ]));
}

describe('applyIntent', () => {
  it('does not mutate the state it is given', () => {
    const state = playing();
    state.players[0]!.hand = ['E5'];
    const before = JSON.stringify(state);

    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E5' });

    expect(JSON.stringify(state)).toBe(before);
    expect(next).not.toBe(state);
    expect(next.board['E5'].placed).toBe(true);
  });

  it('rejects an intent from a player whose turn it is not', () => {
    const state = playing();
    state.players[1]!.hand = ['E5'];
    expect(codeOf(() =>
      applyIntent(state, { type: 'placeTile', playerId: state.players[1]!.id, coord: 'E5' }),
    )).toBe('notYourTurn');
  });

  it('rejects an intent in the wrong stage', () => {
    const state = playing();
    state.stage = 'buy';
    state.players[0]!.hand = ['E5'];
    expect(codeOf(() =>
      applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E5' }),
    )).toBe('wrongStage');
  });

  it('rejects a tile that is not in hand', () => {
    const state = playing();
    state.players[0]!.hand = ['E5'];
    expect(codeOf(() =>
      applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'H8' }),
    )).toBe('tileNotInHand');
  });

  it('sends an isolated placement straight to buy and logs it', () => {
    const state = playing();
    state.players[0]!.hand = ['E5', 'A1'];

    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E5' });

    expect(next.stage).toBe('buy');
    expect(next.players[0]!.hand).toEqual(['A1']);
    expect(next.log.at(-1)).toMatchObject({ phase: 'Placed a tile', playerId: state.players[0]!.id });
  });

  describe('the founding step and the placement that led to it', () => {
    /** A lone tile with a hand tile beside it: placing founds a startup. */
    function aboutToFound() {
      const state = playing();
      state.board['E5'] = { placed: true };
      state.players[0]!.hand = ['E6'];
      return state;
    }

    it('rewrites the placement to name what it founded', () => {
      const placed = applyIntent(aboutToFound(), {
        type: 'placeTile', playerId: 'p1', coord: 'E6',
      });
      // While the game is asking, the entry asks.
      expect(placed.log.at(-1)!.detail.map((t) => ('text' in t ? t.text : ''))).toContain(
        ' — choose a startup to found',
      );

      const founded = applyIntent(placed, {
        type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla',
      });
      const placement = founded.log.find((e) => e.phase === 'Placed a tile')!;

      expect(placement.detail.some((t) => t.kind === 'brand' && t.startupId === 'Messla')).toBe(true);
      expect(placement.detail.some((t) => 'text' in t && /choose/.test(t.text ?? ''))).toBe(false);
    });

    it('records the founder share, not the tile again', () => {
      const placed = applyIntent(aboutToFound(), {
        type: 'placeTile', playerId: 'p1', coord: 'E6',
      });
      const founded = applyIntent(placed, {
        type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla',
      });

      const entry = founded.log.at(-1)!;
      expect(entry.phase).toBe('Founded a startup');
      // A typed payload, so the panel can render the certificate itself — the
      // token vocabulary is text, tiles, brands and cash, and a share is none
      // of those.
      expect(entry.payload).toEqual({ kind: 'founding', startupId: 'Messla', shares: 1 });
      // The tile is on the placement above; repeating it here said nothing new.
      expect(entry.detail.some((t) => t.kind === 'tile')).toBe(false);
    });
  });

  it('says where the tile went and nothing else', () => {
    // A placement that neither grows a chain, founds one nor merges used to
    // log "E5 (isolated)". The word is jargon for "nothing happened", on an
    // entry whose whole content is already the coordinate — and every other
    // branch of this log says what the placement *did*, which is the thing
    // worth a sentence.
    const state = playing();
    state.players[0]!.hand = ['E5', 'A1'];

    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E5' });

    expect(next.log.at(-1)!.detail).toEqual([{ kind: 'tile', coord: 'E5' }]);
  });

  it('opens the founding choice, then founds the brand and grants the free share', () => {
    const state = playing();
    state.board['E5'] = { placed: true };
    state.players[0]!.hand = ['E6'];

    const placed = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E6' });
    expect(placed.stage).toBe('foundStartup');

    const founded = applyIntent(placed, {
      type: 'chooseFoundingBrand', playerId: state.players[0]!.id, startupId: 'Messla',
    });

    expect(founded.stage).toBe('buy');
    expect(founded.startups['Messla']!.isFounded).toBe(true);
    expect(founded.players[0]!.portfolio['Messla']).toBe(1);
    expect(founded.startups['Messla']!.availableShares).toBe(24);
    expect(founded.board['E5'].startupId).toBe('Messla');
    expect(founded.board['E6'].startupId).toBe('Messla');
  });

  it('grows an existing chain into buy, absorbing any lone tiles it reaches', () => {
    const state = playing(setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3'], tier: 0 },
    ]));
    state.board['C2'] = { placed: true }; // lone unclaimed tile
    state.players[0]!.hand = ['C1'];       // adjacent to B1 (Messla) and to C2

    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'C1' });

    expect(next.stage).toBe('buy');
    expect(next.board['C1'].startupId).toBe('Messla');
    expect(next.board['C2'].startupId).toBe('Messla');
    expect(next.players[0]!.hand).toEqual([]);
  });

  it('rejects founding with a brand already on the board', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    state.stage = 'foundStartup';
    state.turnIndex = 0;
    state.pendingFoundTile = 'H8';

    expect(codeOf(() =>
      applyIntent(state, { type: 'chooseFoundingBrand', playerId: state.players[0]!.id, startupId: 'Messla' }),
    )).toBe('brandUnavailable');
  });

  it('pays merger bonuses on the merge transition without a payout stage', () => {
    const state = mergeFixture();
    const alex = state.players[0]!;
    alex.hand = ['C1'];
    alex.cash = 0;
    giveShares(state, alex.id, { ZuckFace: 3 }); // sole holder of the absorbed chain
    // The merge path mutates startups, portfolio, cash and mergerContext — the
    // isolated-placement test above touches none of those, so this is what
    // would catch a partial clone that shares them by reference.
    const before = JSON.stringify(state);

    const next = applyIntent(state, { type: 'placeTile', playerId: alex.id, coord: 'C1' });

    expect(JSON.stringify(state)).toBe(before);
    expect(next.stage).toBe('mergerLiquidation');
    // ZuckFace at 3 tiles, tier 1 → price 400; sole holder → 400 × 15
    expect(next.players[0]!.cash).toBe(6000);
    expect(next.log.some((e) => e.phase === 'Merger payout')).toBe(true);
  });

  it('goes straight to buy after a merge nobody held shares in', () => {
    const state = mergeFixture();
    state.players[0]!.hand = ['C1'];

    const next = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'C1' });

    expect(next.stage).toBe('buy');
    expect(next.startups['ZuckFace']!.isFounded).toBe(false);
  });

  it('asks for a survivor when the merge is tied, and rejects a non-tied pick', () => {
    const state = tiedMergeFixture();
    state.players[0]!.hand = ['C1'];

    const placed = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'C1' });
    expect(placed.stage).toBe('chooseSurvivor');
    expect(placed.pendingTiedStartups).toEqual(['Messla', 'ZuckFace']);

    expect(codeOf(() =>
      applyIntent(placed, { type: 'chooseSurvivor', playerId: state.players[0]!.id, startupId: 'Gobble' }),
    )).toBe('notATiedSurvivor');

    const merged = applyIntent(placed, {
      type: 'chooseSurvivor', playerId: state.players[0]!.id, startupId: 'Messla',
    });

    expect(merged.stage).toBe('buy'); // nobody held absorbed shares
    expect(merged.startups['ZuckFace']!.isFounded).toBe(false);
    expect(merged.board['D1'].startupId).toBe('Messla');
    // the non-tied smaller chain is absorbed too
    expect(merged.board['C2'].startupId).toBe('Messla');
  });

  it('rejects a survivor pick whose pending merger data is incomplete', () => {
    // `pendingTiedStartups` alone is not enough: completeSurvivorSelection also
    // needs the tile and the touching-chain list, and merely no-ops without
    // them. That must surface as a rejection, never as a no-op "success".
    for (const missing of ['pendingMergerTile', 'pendingMergerStartups'] as const) {
      const state = tiedMergeFixture();
      state.players[0]!.hand = ['C1'];
      const placed = applyIntent(state, {
        type: 'placeTile', playerId: state.players[0]!.id, coord: 'C1',
      });
      expect(placed.stage).toBe('chooseSurvivor');
      delete placed[missing];

      expect(codeOf(() => applyIntent(placed, {
        type: 'chooseSurvivor', playerId: state.players[0]!.id, startupId: 'Messla',
      }))).toBe('illegalPlacement');
    }
  });

  it('rejects a genuinely unknown intent type', () => {
    const state = playing();
    expect(codeOf(() => applyIntent(state, { type: 'nope' } as never))).toBe('unknownIntent');
  });
});

describe('applyIntent — liquidate', () => {
  /**
   * Reuses `mergeFixture`'s geometry (Messla B1-B6 tier 0, ZuckFace D1-D3
   * tier 1; C1 merges them, Messla survives on size). Gives alex and sam
   * ZuckFace shares before the merge, then commits the merge via placeTile
   * so the resulting mergerLiquidation state is real, not hand-built.
   */
  function merged() {
    const state = mergeFixture();
    const alex = state.players[0]!;
    const sam = state.players[1]!;
    alex.hand = ['C1'];
    alex.cash = 0;
    sam.cash = 0;
    giveShares(state, alex.id, { ZuckFace: 4 });
    giveShares(state, sam.id, { ZuckFace: 2 });
    const next = applyIntent(state, { type: 'placeTile', playerId: alex.id, coord: 'C1' });
    return { state: next, alex, sam };
  }

  it('queues every holder of the absorbed chain in seat order', () => {
    const { state, alex, sam } = merged();
    expect(state.stage).toBe('mergerLiquidation');
    expect(state.mergerContext!.shareholderQueue).toEqual([alex.id, sam.id]);
    expect(state.mergerContext!.currentShareholderIndex).toBe(0);
  });

  it('sells at the absorbed price, trades two-for-one and keeps the rest', () => {
    const { state, alex } = merged();
    const cashBefore = state.players[0]!.cash;
    // ZuckFace 3 tiles, tier 1 → $400
    const next = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 2, keep: 1,
    });
    expect(next.players[0]!.cash).toBe(cashBefore + 400);
    expect(next.players[0]!.portfolio['ZuckFace']).toBe(1);
    expect(next.players[0]!.portfolio['Messla']).toBe(1); // 2 traded → 1 survivor share
    expect(next.mergerContext!.currentShareholderIndex).toBe(1);
    expect(next.stage).toBe('mergerLiquidation');
  });

  it('returns to buy once the queue is exhausted', () => {
    const { state, alex, sam } = merged();
    const a = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 4, trade: 0, keep: 0,
    });
    const b = applyIntent(a, {
      type: 'liquidate', playerId: sam.id, startupId: 'ZuckFace', sell: 0, trade: 2, keep: 0,
    });
    expect(b.stage).toBe('buy');
  });

  it('rejects counts that do not add up to the holding', () => {
    const { state, alex } = merged();
    expect(codeOf(() => applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 1, keep: 1,
    }))).toBe('shareCountMismatch');
  });

  it('rejects an odd trade count', () => {
    const { state, alex } = merged();
    expect(codeOf(() => applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 0, trade: 3, keep: 1,
    }))).toBe('oddTradeCount');
  });

  it('rejects a trade the survivor pool cannot cover', () => {
    const { state, alex } = merged();
    state.startups['Messla']!.availableShares = 1;
    expect(codeOf(() => applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 0, trade: 4, keep: 0,
    }))).toBe('notEnoughShares');
  });

  it('rejects a liquidation from a player who is not at the head of the queue', () => {
    const { state, sam } = merged();
    expect(codeOf(() => applyIntent(state, {
      type: 'liquidate', playerId: sam.id, startupId: 'ZuckFace', sell: 2, trade: 0, keep: 0,
    }))).toBe('notYourTurn');
  });

  it('leaves state byte-identical when a liquidate is rejected mid-flight, in the middle of a two-holder queue', () => {
    // `merged()` queues both alex and sam as ZuckFace holders. A rejected
    // intent must not disturb the queue it was rejected out of — asserted
    // here on the *unresolved* two-holder queue itself, not only on a
    // final, fully-drained state the way the existing queue tests do.
    const { state, alex } = merged();
    expect(state.mergerContext!.shareholderQueue).toEqual([alex.id, expect.any(String)]);
    const before = JSON.stringify(state);

    expect(codeOf(() => applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 1, keep: 1,
    }))).toBe('shareCountMismatch');

    expect(JSON.stringify(state)).toBe(before);
  });

  it('logs what was done with the shares', () => {
    const { state, alex } = merged();
    const next = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 2, trade: 2, keep: 0,
    });
    expect(next.log.at(-1)).toMatchObject({ phase: 'Liquidated shares', playerId: alex.id });
  });

  // Regression coverage for a review finding: advanceToNextAbsorbedStartup
  // used to zero every player's portfolio for the absorbed chain once its
  // shareholder queue emptied, silently destroying `keep` choices (no cash,
  // no survivor share, share just gone). Kept shares must survive past the
  // chain's full liquidation, exactly like the already-correct legacy
  // completeLiquidation path (see gameLogic.test.ts "Bug Fix #3").
  it('preserves a kept share after the whole queue has resolved, and reflects it in the pool', () => {
    const { state, alex, sam } = merged();
    const afterAlex = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 2, keep: 1,
    });
    const afterSam = applyIntent(afterAlex, {
      type: 'liquidate', playerId: sam.id, startupId: 'ZuckFace', sell: 0, trade: 2, keep: 0,
    });

    expect(afterSam.stage).toBe('buy');
    // alex's kept ZuckFace share must still be there — not wiped by the
    // end-of-chain cleanup that fires once sam (the last queued holder) resolves.
    expect(afterSam.players[0]!.portfolio['ZuckFace']).toBe(1);
    // ZuckFace's pool reclaims everything except the 1 share still held —
    // NOT a full reset to totalShares (25), which would double-issue it.
    expect(afterSam.startups['ZuckFace']!.availableShares).toBe(
      afterSam.startups['ZuckFace']!.totalShares - 1,
    );
  });

  // Seed-independent regression for the share-conservation bug Task 5's
  // random-play harness found: `completePlayerMergerLiquidation` used to
  // remove absorbed shares from a player's portfolio without crediting
  // `startups[absorbedId].availableShares`, so `held + available ===
  // totalShares` broke BETWEEN queued liquidations and only reconciled once
  // the last shareholder resolved (`advanceToNextAbsorbedStartup`'s own
  // cleanup, gameLogic.ts ~line 739). The test above only checks
  // `availableShares` after sam (the last holder) has also resolved — which
  // is exactly why it wouldn't have caught this. This one checks
  // conservation with sam still queued behind alex, i.e. genuinely mid-flight.
  it('conserves ZuckFace shares (held + available === total) between two queued liquidations, not only after the whole queue resolves', () => {
    const { state, alex, sam } = merged();
    expect(state.mergerContext!.shareholderQueue).toEqual([alex.id, sam.id]);

    // Alex, the head of the queue, sells out; sam is still queued behind him.
    const afterAlex = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 4, trade: 0, keep: 0,
    });

    expect(afterAlex.stage).toBe('mergerLiquidation'); // sam hasn't gone yet
    expect(afterAlex.mergerContext!.currentShareholderIndex).toBe(1);

    const zuckFace = afterAlex.startups['ZuckFace'];
    const totalHeld = afterAlex.players.reduce(
      (sum, p) => sum + (p.portfolio['ZuckFace'] ?? 0), 0,
    );
    expect(totalHeld + zuckFace!.availableShares).toBe(zuckFace!.totalShares);
  });

  // Regression coverage for the `trade` unit mismatch between the intent
  // (absorbed shares surrendered) and completePlayerMergerLiquidation's
  // `trade` param (survivor shares gained): a bug that passed intent.trade
  // straight through would debit the survivor pool by 2x too much.
  it('debits the survivor pool by the shares gained, not the shares surrendered', () => {
    const { state, alex } = merged();
    const survivorBefore = state.startups['Messla']!.availableShares;

    const next = applyIntent(state, {
      type: 'liquidate', playerId: alex.id, startupId: 'ZuckFace', sell: 1, trade: 2, keep: 1,
    });

    // 2 ZuckFace shares traded two-for-one → exactly 1 Messla share gained.
    expect(next.startups['Messla']!.availableShares).toBe(survivorBefore - 1);
  });
});

describe('applyIntent — buy, end turn, trade-in, declare end', () => {
  /**
   * Messla (3 tiles, tier 0 → $300/share) and ZuckFace (2 tiles, tier 1 →
   * $300/share). No adjacency is needed here: nothing in this fixture places
   * a tile, so the auto-assigned coords from `tiles: <count>` are fine.
   */
  function buying(): GameState {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: 3, tier: 0 },
      { id: 'ZuckFace', tiles: 2, tier: 1 },
    ]);
    state.stage = 'buy';
    state.turnIndex = 0;
    state.currentBuyCount = 0;
    state.players[0]!.cash = 1000;
    state.players[0]!.hand = ['H8'];
    return state;
  }

  /**
   * Two safe (≥11 tile) chains both touching C1: Messla along row B
   * (B1-B11) and ZuckFace along row D (D1-D11). C1's only neighbours are
   * B1, D1 and C2, so C1 would merge two safe chains — a permanently dead
   * tile. Explicit coords, per INTERFACE-FACTS: auto-assigned counts give
   * no adjacency guarantee.
   */
  function deadTileFixture(): GameState {
    const row = (r: string): Coord[] => Array.from({ length: 11 }, (_, i) => `${r}${i + 1}` as Coord);
    return setupGameWithStartups([
      { id: 'Messla', tiles: row('B'), tier: 0 },
      { id: 'ZuckFace', tiles: row('D'), tier: 1 },
    ]);
  }

  it('buys shares, charging cash and drawing down the pool', () => {
    const state = buying();
    const next = applyIntent(state, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'Messla'] });
    expect(next.players[0]!.cash).toBe(1000 - 600);
    expect(next.players[0]!.portfolio['Messla']).toBe(2);
    expect(next.startups['Messla']!.availableShares).toBe(23);
    expect(next.currentBuyCount).toBe(2);
    expect(next.stage).toBe('buy');
    expect(next.log.at(-1)).toMatchObject({ phase: 'Bought shares' });
  });

  it('buys a basket spanning two different startups in one call', () => {
    const state = buying();
    const next = applyIntent(state, {
      type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'ZuckFace'],
    });
    // Messla 3 tiles tier 0, ZuckFace 2 tiles tier 1 — see `buying()`'s own
    // comment for the $300 + $300 derivation via getSharePrice.
    expect(next.players[0]!.cash).toBe(1000 - 600);
    expect(next.players[0]!.portfolio['Messla']).toBe(1);
    expect(next.players[0]!.portfolio['ZuckFace']).toBe(1);
    expect(next.startups['Messla']!.availableShares).toBe(24);
    expect(next.startups['ZuckFace']!.availableShares).toBe(24);
    expect(next.currentBuyCount).toBe(2);
  });

  it('rejects a malformed pick — a negative number standing in for a StartupId — as brandUnavailable, not shareCountMismatch', () => {
    // `picks` is `StartupId[]`: there is no numeric "count" field for a
    // negative value to land in, so the only way a negative number enters
    // this intent at all is a malformed element cast past the type system,
    // the way a badly-serialized client payload might arrive. `doBuyShares`
    // looks it up as `state.startups[id]`, which simply misses (no such
    // key) — the same path an unrecognized real-looking id would take — so
    // this is `brandUnavailable`, not `shareCountMismatch`. Verified by
    // running this exact call against the live engine (see task-7-report.md).
    const state = buying();
    const before = JSON.stringify(state);
    expect(codeOf(() => applyIntent(state, {
      type: 'buyShares',
      playerId: state.players[0]!.id,
      // The malformed element (a number where a StartupId belongs) is the
      // point of the test, hence the cast.
      picks: [-1] as unknown as StartupId[],
    }))).toBe('brandUnavailable');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('caps the turn at three shares across calls', () => {
    const state = buying();
    const one = applyIntent(state, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'Messla'] });
    expect(() =>
      applyIntent(one, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'Messla'] }),
    ).toThrow(IllegalIntentError);
    try {
      applyIntent(one, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'Messla'] });
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('tooManyPicks');
    }
  });

  it('rejects a basket the player cannot afford, buying nothing', () => {
    const state = buying();
    state.players[0]!.cash = 500;
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla', 'ZuckFace'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('notEnoughCash');
    }
    // nothing charged
    expect(state.players[0]!.cash).toBe(500);
  });

  it('rejects buying an unfounded brand or one with an empty pool', () => {
    const state = buying();
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Gobble'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('brandUnavailable');
    }

    state.startups['Messla']!.availableShares = 0;
    try {
      applyIntent(state, { type: 'buyShares', playerId: state.players[0]!.id, picks: ['Messla'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('notEnoughShares');
    }
  });

  it('ends the turn: refills the hand, resets the buy count, advances the player', () => {
    const state = buying();
    state.bag = ['A9', 'A10', 'A11', 'A12', 'B9', 'B10'];
    state.players[0]!.hand = ['H8'];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0]!.id });
    expect(next.players[0]!.hand).toHaveLength(6);
    expect(next.currentBuyCount).toBe(0);
    expect(next.turnIndex).toBe(1);
    expect(next.stage).toBe('play');
    expect(next.log.some((e) => e.phase === 'Drew tiles')).toBe(true);
  });

  it('does not refill past what the bag holds', () => {
    const state = buying();
    state.bag = ['A9'];
    state.players[0]!.hand = ['H8'];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0]!.id });
    expect(next.players[0]!.hand).toHaveLength(2);
    expect(next.bag).toEqual([]);
  });

  it('allows ending the turn from play only when no tile is playable', () => {
    const state = deadTileFixture();
    state.stage = 'play';
    state.turnIndex = 0;
    state.players[0]!.hand = ['C1']; // the only tile, and it is dead
    state.bag = [];
    const next = applyIntent(state, { type: 'endTurn', playerId: state.players[0]!.id });
    expect(next.turnIndex).toBe(1);

    const playable = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    playable.stage = 'play';
    playable.turnIndex = 0;
    playable.players[0]!.hand = ['H8']; // far from the auto-assigned Messla tiles — isolated, legal
    try {
      applyIntent(playable, { type: 'endTurn', playerId: playable.players[0]!.id });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('wrongStage');
    }
  });

  it('trades in dead tiles and leaves the turn running', () => {
    const state = deadTileFixture();
    state.stage = 'play';
    state.turnIndex = 0;
    state.players[0]!.hand = ['C1', 'G6'];
    state.bag = ['I12'];
    const next = applyIntent(state, { type: 'tradeInDeadTiles', playerId: state.players[0]!.id, coords: ['C1'] });
    expect(next.stage).toBe('play');
    expect(next.players[0]!.hand).toEqual(['G6', 'I12']);
    expect(next.bag).toEqual([]);
    expect(next.log.at(-1)).toMatchObject({ phase: 'Traded a tile' });
  });

  it('deduplicates a repeated coord so trading in one dead tile only ever surrenders and draws one', () => {
    const state = deadTileFixture();
    state.stage = 'play';
    state.turnIndex = 0;
    state.players[0]!.hand = ['C1', 'G6'];
    state.bag = ['I12', 'H1'];
    const next = applyIntent(state, {
      type: 'tradeInDeadTiles',
      playerId: state.players[0]!.id,
      coords: ['C1', 'C1'],
    });
    // Exactly one tile surrendered from the hand, exactly one replacement drawn.
    expect(next.players[0]!.hand).toEqual(['G6', 'I12']);
    // The bag drops by exactly one.
    expect(next.bag).toEqual(['H1']);
    // Exactly one 'Traded a tile' log entry pushed.
    expect(next.log.filter((e) => e.phase === 'Traded a tile')).toHaveLength(1);
  });

  it('refuses to trade in a tile that is merely awkward', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 3, tier: 0 }]);
    state.stage = 'play';
    state.turnIndex = 0;
    state.players[0]!.hand = ['H8'];
    try {
      applyIntent(state, { type: 'tradeInDeadTiles', playerId: state.players[0]!.id, coords: ['H8'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('notADeadTile');
    }
  });

  it('declares the end only when the condition is met', () => {
    const notYet = buying();
    try {
      applyIntent(notYet, { type: 'declareEnd', playerId: notYet.players[0]!.id });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as IllegalIntentError).code).toBe('endNotAvailable');
    }

    const over = setupGameWithStartups([{ id: 'Gobble', tiles: 41, tier: 2 }]);
    over.stage = 'buy';
    over.turnIndex = 0;
    const ended = applyIntent(over, { type: 'declareEnd', playerId: over.players[0]!.id });
    expect(ended.stage).toBe('end');
    expect(ended.log.at(-1)).toMatchObject({ phase: 'Game over' });
  });

  // Regression for hazard 2: gameLogic's `foundStartup` and
  // `advanceToNextAbsorbedStartup` set stage = 'buy' without touching
  // `currentBuyCount` — they rely on it already being 0, an invariant that
  // only holds if *every* path out of a turn resets it. This drives two
  // full turns through applyIntent only: player 1 spends 2 of their 3 buys
  // and ends the turn; player 2 then founds a brand fresh. If endTurn didn't
  // reset currentBuyCount, player 2 would inherit player 1's leftover count
  // and be capped at 1 share instead of 3.
  it('lets a player who founds a brand buy a full three, unaffected by the previous player using up buys', () => {
    const state = setupGameWithStartups([{ id: 'Gobble', tiles: 3, tier: 0 }]);
    state.stage = 'play';
    state.turnIndex = 0;
    state.players[0]!.hand = ['E5'];
    state.players[1]!.hand = ['H6'];
    state.board['H5'] = { placed: true }; // lone unclaimed tile for player 2 to found against

    const placed1 = applyIntent(state, { type: 'placeTile', playerId: state.players[0]!.id, coord: 'E5' });
    expect(placed1.stage).toBe('buy');

    const bought1 = applyIntent(placed1, {
      type: 'buyShares', playerId: state.players[0]!.id, picks: ['Gobble', 'Gobble'],
    });
    expect(bought1.currentBuyCount).toBe(2);

    const ended1 = applyIntent(bought1, { type: 'endTurn', playerId: state.players[0]!.id });
    expect(ended1.turnIndex).toBe(1);
    expect(ended1.stage).toBe('play');

    const placed2 = applyIntent(ended1, { type: 'placeTile', playerId: state.players[1]!.id, coord: 'H6' });
    expect(placed2.stage).toBe('foundStartup');

    const founded2 = applyIntent(placed2, {
      type: 'chooseFoundingBrand', playerId: state.players[1]!.id, startupId: 'Messla',
    });
    expect(founded2.stage).toBe('buy');
    expect(founded2.currentBuyCount).toBe(0); // must not carry over player 1's count

    const bought2 = applyIntent(founded2, {
      type: 'buyShares', playerId: state.players[1]!.id, picks: ['Messla', 'Messla', 'Messla'],
    });
    expect(bought2.currentBuyCount).toBe(3);
    expect(bought2.players[1]!.portfolio['Messla']).toBe(4); // 1 founding share + 3 bought
  });
});

describe('discard pile', () => {
  const row = (letter: Row, n: number): Coord[] =>
    Array.from({ length: n }, (_, i) => `${letter}${i + 1}` as Coord);

  it('records a traded-in dead tile, keeping all 108 tiles accounted for', () => {
    // Two safe chains with a single gap between them: C6 can never be played.
    // Account for all 108 tiles: chains (22) + hands (2) + named bag coord (1) + remaining (83)
    const allCoords = new Set(generateAllCoords());
    const used = new Set([
      ...row('B', 11),
      ...row('D', 11),
      'C6', 'G6', 'I12',
    ]);
    const remaining = Array.from(allCoords).filter((c) => !used.has(c));

    const state = buildFixture({
      players: [{ name: 'Alex', hand: ['C6', 'G6'] }, { name: 'Sam' }],
      chains: [
        { id: 'Messla', coords: row('B', 11) },
        { id: 'ZuckFace', coords: row('D', 11) },
      ],
      bag: ['I12', ...remaining],
    });

    const next = applyIntent(state, { type: 'tradeInDeadTiles', playerId: 'p1', coords: ['C6'] });

    expect(next.discarded).toEqual(['C6']);

    const placed = Object.values(next.board).filter((c) => c.placed).length;
    const inHands = next.players.reduce((n, p) => n + p.hand.length, 0);
    expect(placed + inHands + next.bag.length + next.discarded.length).toBe(108);
  });

  it('starts empty on a new game', () => {
    expect(createInitialGame('seed-1', ['Alex', 'Sam']).discarded).toEqual([]);
  });
});

describe('drawTurnOrderTile', () => {
  /** Every seat draws, in order, leaving the game at the position play starts from. */
  const drawAll = (state: GameState): GameState =>
    state.players.reduce(
      (s, p) => applyIntent(s, { type: 'drawTurnOrderTile', playerId: p.id }),
      state,
    );

  it('stays in the draw until the last seat has drawn', () => {
    const state = createInitialGame('open-1', ['Alex', 'Sam', 'Jo']);
    expect(state.stage).toBe('draw');

    const afterOne = applyIntent(state, { type: 'drawTurnOrderTile', playerId: 'p1' });
    expect(afterOne.stage).toBe('draw');
    expect(afterOne.turnOrderDraws).toHaveLength(1);

    const afterTwo = applyIntent(afterOne, { type: 'drawTurnOrderTile', playerId: 'p2' });
    expect(afterTwo.stage).toBe('draw');

    const afterThree = applyIntent(afterTwo, { type: 'drawTurnOrderTile', playerId: 'p3' });
    expect(afterThree.stage).toBe('play');
    expect(afterThree.turnOrderDraws).toHaveLength(3);
  });

  it('turns a fresh game into a playable position once everyone has drawn', () => {
    const next = drawAll(createInitialGame('open-1', ['Alex', 'Sam', 'Jo']));

    expect(next.stage).toBe('play');
    // One starting tile per player, placed and unclaimed.
    const placed = Object.entries(next.board).filter(([, c]) => c.placed);
    expect(placed).toHaveLength(3);
    expect(placed.every(([, c]) => c.startupId === undefined)).toBe(true);
  });

  /**
   * The owner's sequencing, which is tabletop Acquire's: the draw to go first
   * pulls from the *entire* bag, and only then are hands drawn from what is
   * left — the bag minus the tiles now on the board. Hands dealt at init made
   * the twelve dealt tiles undrawable for turn order, which is the procedure
   * backwards.
   */
  it('draws for turn order from the whole bag — no hands are dealt yet', () => {
    const state = createInitialGame('open-7', ['Alex', 'Sam', 'Jo']);

    expect(state.bag).toHaveLength(108);
    for (const p of state.players) expect(p.hand).toEqual([]);
  });

  it('deals hands round-robin in seat order once the last draw lands', () => {
    const state = createInitialGame('open-7', ['Alex', 'Sam', 'Jo']);
    const bag = [...state.bag];

    const next = drawAll(state);

    // The three turn-order tiles came off the top of the bag; the deal starts
    // at bag[3], one tile per seat per round — consecutive positions go to
    // different players, which is what keeps the odds even across the table.
    for (let i = 0; i < 3; i++) {
      expect(next.players[i]!.hand).toEqual(
        [0, 1, 2, 3, 4, 5].map((round) => bag[3 + i + round * 3]),
      );
    }
    expect(next.bag).toEqual(bag.slice(3 + 18));
  });

  it('takes the starting tiles out of the bag rather than returning them', () => {
    const state = createInitialGame('open-1', ['Alex', 'Sam', 'Jo']);
    const before = state.bag.length;
    const next = drawAll(state);

    // Three turn-order tiles to the board, then six per hand off the top of
    // what remained — the legacy opening pushed drawn tiles back onto the
    // bag, which is the double-count this test exists to keep dead.
    expect(next.bag).toHaveLength(before - 3 - 18);
    const placedCoords = Object.entries(next.board)
      .filter(([, c]) => c.placed)
      .map(([coord]) => coord);
    for (const coord of placedCoords) expect(next.bag).not.toContain(coord);
  });

  it('preserves tile conservation at every step of the opening, not just the end', () => {
    let state = createInitialGame('open-2', ['Alex', 'Sam', 'Jo']);
    const total = (s: GameState) =>
      Object.values(s.board).filter((c) => c.placed).length
      + s.players.reduce((n, p) => n + p.hand.length, 0)
      + s.bag.length + s.discarded.length;

    expect(total(state)).toBe(108);
    for (const p of state.players) {
      state = applyIntent(state, { type: 'drawTurnOrderTile', playerId: p.id });
      // Checked after *each* draw: the legacy opening pushed drawn tiles back
      // onto the bag, counting them twice, and a total taken only at the end
      // can be right while an intermediate state is not.
      expect(total(state)).toBe(108);
    }
  });

  it('gives the turn to whoever drew the highest coordinate', () => {
    // Highest letter, then highest number — so I12 beats A1. `compareTiles`
    // orders row-then-column ascending, which makes the winner the last entry.
    // This game reverses tabletop Acquire deliberately; see doDrawTurnOrderTile.
    const state = createInitialGame('open-3', ['Alex', 'Sam', 'Jo']);
    const drawnInOrder = state.bag.slice(0, 3);
    const highest = [...drawnInOrder].sort(compareTiles).at(-1)!;
    const expectedIndex = drawnInOrder.indexOf(highest);

    const next = drawAll(state);
    expect(next.turnIndex).toBe(expectedIndex);
    // And the record agrees with the outcome: the winner is the seat whose own
    // recorded draw is the highest tile.
    const winner = [...next.turnOrderDraws!].sort((a, b) => compareTiles(a.tile, b.tile)).at(-1)!;
    expect(next.players[next.turnIndex]!.id).toBe(winner.playerId);
  });

  it('narrates each draw as its own step, and announces the winner at the end', () => {
    const state = createInitialGame('open-4', ['Alex', 'Sam']);

    const afterOne = applyIntent(state, { type: 'drawTurnOrderTile', playerId: 'p1' });
    // Its own step, attributed to the drawer. Not cosmetic: `pushLog` is what
    // advances `nextStepId`, and the segment machinery is built on step ids —
    // a silent draw left the undo range and the server's commit boundary with
    // nothing to move past.
    expect(afterOne.log.map((e) => e.phase)).toEqual(['Drew for turn order']);
    expect(afterOne.log.at(-1)!.playerId).toBe('p1');
    // Nobody plays first yet — the order is unknown until the last tile lands.
    expect(afterOne.log.map((e) => e.phase)).not.toContain('Turn order');

    const next = applyIntent(afterOne, { type: 'drawTurnOrderTile', playerId: 'p2' });
    expect(next.log.map((e) => e.phase))
      .toEqual(['Drew for turn order', 'Drew for turn order', 'Turn order']);
    // Unattributed on purpose. `stepsOf` prefixes an entry with its player,
    // and renders "You" for the viewer's own — so an attributed "Turn order"
    // reads as "YOU TURN ORDER". It is a fact about the table, not a move
    // anyone made, so the winner is named in the detail instead.
    expect(next.log.at(-1)!.playerId).toBeUndefined();
    const detail = next.log.at(-1)!.detail.map((t) => ('text' in t ? t.text : '')).join('');
    expect(detail).toContain(next.players[next.turnIndex]!.name);
    expect(detail).toContain('plays first');
  });

  it('is rejected once the game is under way', () => {
    const started = drawAll(createInitialGame('open-5', ['Alex', 'Sam']));
    expect(() => applyIntent(started, { type: 'drawTurnOrderTile', playerId: 'p1' }))
      .toThrow(IllegalIntentError);
  });

  it('is rejected from any seat but the one whose draw it is', () => {
    const state = createInitialGame('open-6', ['Alex', 'Sam', 'Jo']);
    // Seat two cannot jump the queue...
    expect(() => applyIntent(state, { type: 'drawTurnOrderTile', playerId: 'p2' }))
      .toThrow(IllegalIntentError);

    // ...and seat one cannot draw twice.
    const afterOne = applyIntent(state, { type: 'drawTurnOrderTile', playerId: 'p1' });
    expect(() => applyIntent(afterOne, { type: 'drawTurnOrderTile', playerId: 'p1' }))
      .toThrow(IllegalIntentError);
  });
});

describe('merger payout payload', () => {
  it('emits one payout entry carrying every bonus', () => {
    // Reuse the two-way merger fixture from the golden games so the payout is real.
    const g2 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G2')!;
    const states = replayGoldenGame(g2);
    const withPayout = states.find((s) => s.log.some((e) => e.phase === 'Merger payout'))!;

    const entries = withPayout.log.filter((e) => e.phase === 'Merger payout');
    expect(entries).toHaveLength(1);

    const payload = entries[0]!.payload;
    expect(payload?.kind).toBe('payout');
    if (payload?.kind !== 'payout') throw new Error('expected a payout payload');
    expect(payload.bonuses.length).toBeGreaterThan(1);
    for (const b of payload.bonuses) {
      expect(typeof b.playerName).toBe('string');
      expect(['majority', 'minority', 'both']).toContain(b.type);
      expect(b.amount).toBeGreaterThan(0);
    }
  });
});

describe('the turn-order draw and the undo indicator', () => {
  it('does not mark a starting tile as the player last placement', () => {
    // `lastPlacedTile` means "the tile placed this turn, still undoable": the
    // board draws it with a selection ring and keeps it clickable so it can be
    // taken back. A turn-order tile is neither — marking it made the opening
    // board show a phantom undoable tile that rejected the click it invited.
    let state = createInitialGame('open-7', ['Alex', 'Sam', 'Jo']);
    for (const p of state.players) {
      state = applyIntent(state, { type: 'drawTurnOrderTile', playerId: p.id });
      // Checked after every draw, not only at the end: a draw that set the
      // field would be visible mid-draw and could still be cleared by the time
      // the last tile lands.
      expect(state.players.every((pl) => pl.lastPlacedTile === undefined)).toBe(true);
    }
  });
});
