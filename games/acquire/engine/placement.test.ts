import { describe, it, expect } from 'vitest';
import { previewPlacement, isDeadTile, getDeadTilesInHand } from './placement';
import { setupGameWithStartups, createTestGameState } from './testHelpers';

describe('previewPlacement', () => {
  it('reports an isolated tile with no neighbours', () => {
    const state = createTestGameState();
    const p = previewPlacement(state, 'E5');
    expect(p.legal).toBe(true);
    expect(p.kind).toBe('isolated');
    expect(p.touchingIds).toEqual([]);
    expect(p.loneAdj).toEqual([]);
  });

  it('reports a founding placement next to an unclaimed tile', () => {
    const state = createTestGameState();
    state.board['E5'] = { placed: true };
    const p = previewPlacement(state, 'E6');
    expect(p.kind).toBe('found');
    expect(p.loneAdj).toEqual(['E5']);
  });

  it('reports growth and the resulting price move', () => {
    // Messla (tier 0) spans B1..B5 → size 5, price 500; +1 tile → 6, price 600
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5'], tier: 0 },
    ]);
    const p = previewPlacement(state, 'B6');
    expect(p.kind).toBe('grow');
    expect(p.touchingIds).toEqual(['Messla']);
    expect(p.prices['Messla']).toEqual({ size: 5, price: 500, nextSize: 6, nextPrice: 600 });
  });

  it('names the survivor and the absorbed chain on a merge', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'], tier: 0 }, // size 6
      { id: 'ZuckFace', tiles: ['D1', 'D2', 'D3'], tier: 1 }, // size 3
    ]);
    // C1 is adjacent to B1 and D1 → placing it merges the two chains
    const p = previewPlacement(state, 'C1');
    expect(p.kind).toBe('merge');
    expect(p.survivorId).toBe('Messla');
    expect(p.absorbedIds).toEqual(['ZuckFace']);
    expect(p.tiedSurvivorIds).toBeUndefined();
    expect(p.prices['Messla']!.nextSize).toBe(10); // 6 + 3 + the placed tile
    expect(p.prices['ZuckFace']!.nextSize).toBe(0);
  });

  it('flags a tie for survivor rather than picking one', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4'], tier: 0 },
      { id: 'ZuckFace', tiles: ['D1', 'D2', 'D3', 'D4'], tier: 1 },
    ]);
    const p = previewPlacement(state, 'C1');
    expect(p.kind).toBe('merge');
    expect(p.survivorId).toBeUndefined();
    expect(p.tiedSurvivorIds).toEqual(['Messla', 'ZuckFace']);
    // Combined size is deterministic (4 + 4 + the placed tile = 9) even
    // though which chain survives is not — both tied candidates get a
    // price entry for "if this one wins".
    expect(p.prices['Messla']).toEqual({ size: 4, price: 400, nextSize: 9, nextPrice: 600 });
    expect(p.prices['ZuckFace']).toEqual({ size: 4, price: 500, nextSize: 9, nextPrice: 700 });
  });

  it('blocks a tile that would merge two safe chains, and calls it dead', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'], tier: 0 },
      { id: 'ZuckFace', tiles: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'], tier: 1 },
    ]);
    const p = previewPlacement(state, 'C1');
    expect(p.legal).toBe(false);
    expect(p.block).toBe('mergesSafeChains');
    expect(isDeadTile(state, 'C1')).toBe(true);
  });

  it('blocks a founding placement when all seven brands are on the board — but not as dead', () => {
    const state = setupGameWithStartups([
      { id: 'Gobble', tiles: 2, tier: 2 }, { id: 'Scrapple', tiles: 2, tier: 2 },
      { id: 'PaperfulPost', tiles: 2, tier: 0 }, { id: 'CamCrooned', tiles: 2, tier: 1 },
      { id: 'Messla', tiles: 2, tier: 0 }, { id: 'ZuckFace', tiles: 2, tier: 1 },
      { id: 'WrecksonMobil', tiles: 2, tier: 1 },
    ]);
    state.board['I11'] = { placed: true };
    const p = previewPlacement(state, 'I12');
    expect(p.legal).toBe(false);
    expect(p.block).toBe('noBrandAvailable');
    expect(isDeadTile(state, 'I12')).toBe(false); // recoverable — a merger can free a brand
  });

  it('rejects an occupied square and a tile not in hand', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5'], tier: 0 },
    ]);
    expect(previewPlacement(state, 'B1').block).toBe('occupied');
    state.players[0]!.hand = ['E5'];
    expect(previewPlacement(state, 'E6', state.players[0]!.id).block).toBe('notInHand');
  });

  it('lists only the dead tiles in a hand', () => {
    const state = setupGameWithStartups([
      { id: 'Messla', tiles: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'], tier: 0 },
      { id: 'ZuckFace', tiles: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'], tier: 1 },
    ]);
    state.players[0]!.hand = ['C1', 'G6'];
    expect(getDeadTilesInHand(state, state.players[0]!.id)).toEqual(['C1']);
  });
});
