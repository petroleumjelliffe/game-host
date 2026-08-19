import { describe, it, expect } from 'vitest';
import { getEndCondition, finalScore } from './endGame';
import { setupGameWithStartups, giveShares } from './testHelpers';
import { PLAYER_EMOJI } from './startups';

describe('getEndCondition', () => {
  it('is not met mid-game', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 8, tier: 0 }]);
    expect(getEndCondition(state)).toEqual({ met: false, reasons: [] });
  });

  it('is met when a chain reaches 41', () => {
    const state = setupGameWithStartups([{ id: 'Gobble', tiles: 41, tier: 2 }]);
    // A lone chain at size 41 is also trivially "all founded chains safe"
    // (41 >= SAFE_SIZE) -- both conditions legitimately hold at once, per
    // the task's own resolution: "reasons is an array."
    expect(getEndCondition(state)).toEqual({
      met: true,
      reasons: [
        { kind: 'size41', startupId: 'Gobble', size: 41 },
        { kind: 'allSafe', startupIds: ['Gobble'] },
      ],
    });
  });

  it('is met when every founded chain is safe', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: 12, tier: 0 },
      { id: 'ZuckFace', tiles: 11, tier: 1 },
    ]);
    expect(getEndCondition(state)).toEqual({
      met: true,
      reasons: [{ kind: 'allSafe', startupIds: ['Messla', 'ZuckFace'] }],
    });
  });

  it('is not met when one founded chain is still unsafe', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: 12, tier: 0 },
      { id: 'ZuckFace', tiles: 10, tier: 1 },
    ]);
    expect(getEndCondition(state).met).toBe(false);
  });

  it('is not met when nothing has been founded', () => {
    const state = setupGameWithStartups([]);
    expect(getEndCondition(state).met).toBe(false);
  });

  // Direct pin for G15's fixture position (engine/golden/endgame.ts): a lone
  // Messla chain at size 5, tier 0 — well below SAFE_SIZE (11) and nowhere
  // near END_SIZE (41). G15 only proves declareEnd's guard exists by
  // watching it reject; that guard is only deterministic because
  // getEndCondition currently satisfies `met === (reasons.length > 0)`. This
  // asserts getEndCondition's actual return value for that exact position,
  // so the pin does not depend on a downstream `reason.kind` crash if a
  // future refactor ever returns `met: false` with a populated `reasons`.
  it('is not met for G15\'s fixture position (size 5, tier 0)', () => {
    const state = setupGameWithStartups([{ id: 'Messla', tiles: 5, tier: 0 }]);
    expect(getEndCondition(state)).toEqual({ met: false, reasons: [] });
  });
});

describe('finalScore', () => {
  // Mirrors the fixture structure in
  // docs/superpowers/specs/2026-07-30-final-scoring-overlay-design.md, but the
  // prices/bonus amounts below are derived from the engine's real tiers via
  // getSharePriceAtSize, NOT copied from that doc:
  //   Gobble   tier 2, size 41 -> $1,200  (doc assumed $1,000)
  //   Messla   tier 0, size 8  -> $600    (doc assumed $600, matches)
  //   ZuckFace tier 1, size 5  -> $600    (doc assumed $400)
  function scoredGame() {
    const state = setupGameWithStartups([
      { id: 'Gobble', tiles: 41, tier: 2 },
      { id: 'Messla', tiles: 8, tier: 0 },
      { id: 'ZuckFace', tiles: 5, tier: 1 },
    ]);
    // setupGameWithStartups only ever produces the 2-player Alice/Bob game
    // (createTestGameState is fixed to those names); the design fixture
    // needs a third player, so add one the same way createInitialGame would.
    state.players.push({
      id: 'p3',
      name: 'Jordan',
      emoji: PLAYER_EMOJI[2]!,
      cash: 6000,
      hand: [],
      portfolio: {},
    });
    const [alex, sam, jordan] = state.players;
    alex!.cash = 8600;
    sam!.cash = 12000;
    jordan!.cash = 3100;
    giveShares(state, alex!.id, { Gobble: 6 });
    giveShares(state, sam!.id, { Gobble: 3 });
    giveShares(state, jordan!.id, { Gobble: 1 });
    giveShares(state, alex!.id, { Messla: 4 });
    giveShares(state, sam!.id, { Messla: 7 });
    giveShares(state, jordan!.id, { Messla: 4 });
    giveShares(state, jordan!.id, { ZuckFace: 3 });
    return state;
  }

  it('reports only the chains standing on the board', () => {
    const report = finalScore(scoredGame());
    expect(report.chains.map((c) => c.id)).toEqual(['Gobble', 'Messla', 'ZuckFace']);
  });

  it('carries every player with cash and emoji', () => {
    const report = finalScore(scoredGame());
    expect(report.players.map((p) => p.cash)).toEqual([8600, 12000, 3100]);
    expect(report.players.every((p) => typeof p.emoji === 'string' && p.emoji.length > 0)).toBe(true);
  });

  it('resolves bonuses per chain, including the tie and the sole holder', () => {
    const state = scoredGame();
    const [alex, sam, jordan] = state.players;
    const report = finalScore(state);
    const at = (chainId: string, playerId: string) =>
      report.bonuses.find((b) => b.chainId === chainId && b.playerId === playerId);

    // Gobble: price $1,200 -> majority $12,000 / minority $6,000
    expect(at('Gobble', alex!.id)).toMatchObject({ type: 'majority', amount: 12000 });
    expect(at('Gobble', sam!.id)).toMatchObject({ type: 'minority', amount: 6000 });
    expect(at('Gobble', jordan!.id)).toBeUndefined();

    // Messla: price $600, tied minority (alex/jordan @ 4 shares each) ->
    // majority $6,000, minority pot $3,000 split two ways -> $1,500 each
    expect(at('Messla', sam!.id)).toMatchObject({ type: 'majority', amount: 6000 });
    expect(at('Messla', alex!.id)).toMatchObject({ type: 'minority', amount: 1500 });
    expect(at('Messla', jordan!.id)).toMatchObject({ type: 'minority', amount: 1500 });

    // ZuckFace: price $600, sole holder -> combined bonus $9,000
    expect(at('ZuckFace', jordan!.id)).toMatchObject({ type: 'both', amount: 9000 });
  });

  it('does not bank bonuses into cash', () => {
    const state = scoredGame();
    finalScore(state);
    expect(state.players.map((p) => p.cash)).toEqual([8600, 12000, 3100]);
  });

  it('reports the end reason when one is met', () => {
    const report = finalScore(scoredGame());
    expect(report.reason).toEqual({ kind: 'size41', startupId: 'Gobble', size: 41 });
  });
});
