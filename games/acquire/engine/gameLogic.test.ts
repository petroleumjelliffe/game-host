import { describe, it, expect, beforeEach } from 'vitest';
import {
  prepareMergerPayout,
  handleLiquidationChoice,
  completeLiquidation,
  getSharePrice,
} from './gameLogic';
import { GameState } from './gameTypes';
import {
  createTestGameState,
  setupGameWithStartups,
  giveShares,
  getStartupSize,
} from './testHelpers';
import { createInitialGame } from './gameInit';
import { roundBonus } from './bonuses';
import type { Coord } from './gameHelpers';

/**
 * Like setupGameWithStartups, but with three players instead of the default
 * two — needed to exercise a tied-minority scenario (one clear majority
 * holder plus two runners-up tied beneath them).
 */
function setupThreePlayerGameWithStartups(
  startups: Array<{ id: string; tiles: Coord[]; tier?: 0 | 1 | 2 }>
): GameState {
  const state = createInitialGame('test-seed', ['Alice', 'Bob', 'Cara']);
  startups.forEach(({ id, tiles, tier = 1 }) => {
    const startup = state.startups[id]!;
    startup.isFounded = true;
    startup.tier = tier;
    startup.foundingTile = tiles[0]!;
    tiles.forEach((coord) => {
      state.board[coord] = { placed: true, startupId: id };
    });
  });
  return state;
}

describe('Merger Logic - Critical Bug Fixes', () => {
  describe('Bug Fix #1: Majority/Minority Bonuses Use Pre-Merger Prices', () => {
    it('should calculate bonuses using share price before tiles are reassigned', () => {
      // Setup: Create a game with two startups of different sizes
      const state = setupGameWithStartups([
        {
          id: 'Messla',
          tiles: ['A1', 'A2', 'A3', 'A4', 'A5'], // 5 tiles - smaller
          tier: 1,
        },
        {
          id: 'CamCrooned',
          tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'], // 7 tiles - larger (survivor)
          tier: 1,
        },
      ]);

      // Give shares to players
      giveShares(state, state.players[0]!.id, { Messla: 5 }); // Majority holder
      giveShares(state, state.players[1]!.id, { Messla: 3 }); // Minority holder

      // Capture pre-merger price (5 tiles, tier 1)
      const preMergerPrice = getSharePrice(state, 'Messla');
      expect(preMergerPrice).toBeGreaterThan(0);

      // Capture pre-merger size
      const preMergerSize = getStartupSize(state, 'Messla');
      expect(preMergerSize).toBe(5);

      // Create pre-merger prices map (this is what the fix does)
      const absorbedPrices = {
        Messla: preMergerPrice,
      };

      // Execute merger payout with pre-merger prices
      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Verify bonuses were calculated with correct price
      const bonuses = state.pendingBonuses;

      expect(bonuses).toBeDefined();
      if (!bonuses) throw new Error('expected pendingBonuses to be set');
      expect(bonuses.length).toBeGreaterThan(0);

      // Majority bonus should be 10x the pre-merger price
      const majorityBonus = bonuses.find((b) => b.type === 'majority');
      expect(majorityBonus?.amount).toBe(preMergerPrice * 10);

      // Minority bonus should be 5x the pre-merger price
      const minorityBonus = bonuses.find((b) => b.type === 'minority');
      expect(minorityBonus?.amount).toBe(preMergerPrice * 5);
    });

    it('should store pre-merger prices in merger context', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3'], tier: 0 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4'], tier: 1 },
      ]);

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      expect(state.mergerContext?.absorbedPrices).toBeDefined();
      expect(state.mergerContext?.absorbedPrices['Messla']).toBe(
        preMergerPrice
      );
    });
  });

  describe('Bug Fix #2: Liquidation Sale Prices Use Pre-Merger Prices', () => {
    it('should sell shares at pre-merger price during liquidation', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4'], tier: 1 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4', 'B5'], tier: 1 },
      ]);

      const player = state.players[0]!;
      const startingCash = 5000;
      player.cash = startingCash;

      // Give player shares
      giveShares(state, player.id, { Messla: 3 });

      // Capture pre-merger price
      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      // Setup merger context
      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Player chooses to sell all shares
      handleLiquidationChoice(state, player.id, 'Messla', 'CamCrooned', 'sell');

      // Verify cash increased by correct amount
      const expectedCash = startingCash + preMergerPrice * 3;
      expect(player.cash).toBe(expectedCash);

      // Verify shares removed from portfolio
      expect(player.portfolio['Messla']).toBe(0);
    });

    it('should not sell at zero price after tiles are reassigned', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4', 'A5'], tier: 1 }, // 5 tiles, tier 1
        { id: 'CamCrooned', tiles: ['B1', 'B2'], tier: 0 }, // 2 tiles, tier 0
      ]);

      const player = state.players[0]!;
      player.cash = 1000;
      giveShares(state, player.id, { Messla: 3 });

      const preMergerPrice = getSharePrice(state, 'Messla');
      expect(preMergerPrice).toBeGreaterThan(0);

      const absorbedPrices = { Messla: preMergerPrice };
      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Simulate tiles already reassigned (this was the bug)
      state.board['A1'].startupId = 'CamCrooned';
      state.board['A2'].startupId = 'CamCrooned';
      state.board['A3'].startupId = 'CamCrooned';
      state.board['A4'].startupId = 'CamCrooned';
      state.board['A5'].startupId = 'CamCrooned';

      // Price from getSharePrice would now be 0 (no tiles)
      const postMergerPrice = getSharePrice(state, 'Messla');
      // Price calculation has a minimum, won't be exactly 0
      expect(postMergerPrice).toBeLessThan(preMergerPrice);

      // But liquidation should use stored pre-merger price
      const cashBefore = player.cash;
      handleLiquidationChoice(state, player.id, 'Messla', 'CamCrooned', 'sell');

      // Should have received pre-merger price, not zero
      expect(player.cash).toBe(cashBefore + preMergerPrice * 3);
    });
  });

  describe('Bug Fix #3: Held Shares Are Preserved After Merger', () => {
    it('should keep held shares in player portfolio after liquidation', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3'], tier: 1 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4'], tier: 1 },
      ]);

      const player = state.players[0]!;
      giveShares(state, player.id, { Messla: 5 });

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Player chooses to hold all shares
      handleLiquidationChoice(state, player.id, 'Messla', 'CamCrooned', 'hold');

      // Complete liquidation for this absorbed startup
      completeLiquidation(state, 'Messla');

      // Held shares should still be in portfolio
      expect(player.portfolio['Messla']).toBe(5);
    });

    it('should calculate availableShares accounting for held shares', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4', 'A5'], tier: 1 }, // 5 tiles, tier 1
        { id: 'CamCrooned', tiles: ['B1', 'B2'], tier: 0 },
      ]);

      const player1 = state.players[0]!;
      const player2 = state.players[1]!;

      giveShares(state, player1.id, { Messla: 3 });
      giveShares(state, player2.id, { Messla: 2 });

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Both players hold all their shares
      handleLiquidationChoice(state, player1.id, 'Messla', 'CamCrooned', 'hold');
      handleLiquidationChoice(state, player2.id, 'Messla', 'CamCrooned', 'hold');

      const startup = state.startups['Messla']!;
      const initialAvailable = startup.availableShares;

      completeLiquidation(state, 'Messla');

      // 5 shares are held, so availableShares should be totalShares - 5
      const expectedAvailable = startup.totalShares - 5;
      expect(startup.availableShares).toBe(expectedAvailable);

      // Players should still have their shares
      expect(player1.portfolio['Messla']).toBe(3);
      expect(player2.portfolio['Messla']).toBe(2);
    });

    it('should not clear player portfolios when completing liquidation', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1'], tier: 0 },
        { id: 'PaperfulPost', tiles: ['C1'], tier: 0 },
        { id: 'CamCrooned', tiles: ['B1', 'B2'], tier: 0 },
      ]);

      const player = state.players[0]!;

      // Player has shares in multiple startups
      giveShares(state, player.id, {
        Messla: 3,
        PaperfulPost: 2,
        CamCrooned: 1,
      });

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);
      handleLiquidationChoice(state, player.id, 'Messla', 'CamCrooned', 'hold');

      completeLiquidation(state, 'Messla');

      // Messla shares should be preserved
      expect(player.portfolio['Messla']).toBe(3);

      // Other startup shares should be unaffected
      expect(player.portfolio['PaperfulPost']).toBe(2);
      expect(player.portfolio['CamCrooned']).toBe(1);
    });
  });

  describe('Integration: Full Merger Flow', () => {
    it('should handle complete merger with correct prices and preserved shares', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4'], tier: 1 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4', 'B5'], tier: 1 },
      ]);

      const player1 = state.players[0]!;
      const player2 = state.players[1]!;

      player1.cash = 5000;
      player2.cash = 3000;

      giveShares(state, player1.id, { Messla: 6, CamCrooned: 2 }); // Majority
      giveShares(state, player2.id, { Messla: 4, CamCrooned: 1 }); // Minority

      // Capture pre-merger state
      const preMergerPrice = getSharePrice(state, 'Messla');
      const preMergerSize = getStartupSize(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      // Execute merger
      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      // Verify bonuses
      const bonuses = state.pendingBonuses ?? [];
      const p1Bonus = bonuses.find(
        (b) => b.playerId === player1.id && b.type === 'majority'
      );
      const p2Bonus = bonuses.find(
        (b) => b.playerId === player2.id && b.type === 'minority'
      );

      if (!p1Bonus) throw new Error('expected a majority bonus for player1');
      if (!p2Bonus) throw new Error('expected a minority bonus for player2');
      expect(p1Bonus.amount).toBe(preMergerPrice * 10);
      expect(p2Bonus.amount).toBe(preMergerPrice * 5);

      // Player 1: Trades all shares (2:1)
      handleLiquidationChoice(state, player1.id, 'Messla', 'CamCrooned', 'trade');

      // Player 2: Holds all shares
      handleLiquidationChoice(state, player2.id, 'Messla', 'CamCrooned', 'hold');

      // Complete liquidation
      completeLiquidation(state, 'Messla');

      // Verify player 1 portfolio
      expect(player1.portfolio['Messla']).toBe(0); // Traded all shares
      expect(player1.portfolio['CamCrooned']).toBe(5); // Original 2 + 3 from trade

      // Verify player 2 portfolio
      expect(player2.portfolio['Messla']).toBe(4); // Held all shares
      expect(player2.cash).toBe(3000); // Didn't sell, cash unchanged

      // Verify Messla state
      const techCo = state.startups['Messla']!;
      expect(techCo.isFounded).toBe(false);
      expect(techCo.availableShares).toBe(techCo.totalShares - 4); // 4 shares held by player2
    });
  });

  describe('Phase 0: Typed bonuses on the production payout path', () => {
    // Regression coverage for the two bugs this task fixes, exercised through
    // prepareMergerPayout itself (not just the pure computeChainBonuses unit
    // tests in bonuses.test.ts) — so a revert of the production wiring would
    // be caught here.

    it('pays a sole holder the combined majority+minority bonus (bug: previously majority only, minority silently dropped)', () => {
      const state = setupGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4', 'A5'], tier: 1 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'], tier: 1 },
      ]);

      const soleHolder = state.players[0];
      giveShares(state, soleHolder!.id, { Messla: 5 }); // only shareholder of Messla

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      const bonuses = state.pendingBonuses ?? [];
      expect(bonuses).toHaveLength(1);
      expect(bonuses[0]).toMatchObject({
        playerId: soleHolder!.id,
        type: 'both',
        amount: preMergerPrice * 15,
      });
    });

    it('splits a tied minority bonus between the tied runner-up holders (bug: previously each got the full bonus)', () => {
      const state = setupThreePlayerGameWithStartups([
        { id: 'Messla', tiles: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], tier: 1 },
        { id: 'CamCrooned', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'], tier: 1 },
      ]);

      const [p1, p2, p3] = state.players;
      giveShares(state, p1!.id, { Messla: 7 }); // clear majority
      giveShares(state, p2!.id, { Messla: 4 }); // tied minority
      giveShares(state, p3!.id, { Messla: 4 }); // tied minority

      const preMergerPrice = getSharePrice(state, 'Messla');
      const absorbedPrices = { Messla: preMergerPrice };

      prepareMergerPayout(state, 'CamCrooned', ['Messla'], absorbedPrices);

      const bonuses = state.pendingBonuses ?? [];
      const majorityBonus = bonuses.find((b) => b.playerId === p1!.id);
      const p2Bonus = bonuses.find((b) => b.playerId === p2!.id);
      const p3Bonus = bonuses.find((b) => b.playerId === p3!.id);

      expect(majorityBonus).toMatchObject({
        type: 'majority',
        amount: preMergerPrice * 10,
      });

      const expectedMinorityEach = roundBonus((preMergerPrice * 5) / 2);
      expect(p2Bonus).toMatchObject({ type: 'minority', amount: expectedMinorityEach });
      expect(p3Bonus).toMatchObject({ type: 'minority', amount: expectedMinorityEach });
    });
  });
});
