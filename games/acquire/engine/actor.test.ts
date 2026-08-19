import { describe, it, expect } from 'vitest';
import { getCurrentActor } from './actor';
import { buildFixture } from './golden/fixtures';
import { createInitialGame } from './gameInit';

describe('getCurrentActor', () => {
  it('is seat one before anyone has drawn', () => {
    const state = createInitialGame('seed-a', ['Alex', 'Sam']);
    expect(state.stage).toBe('draw');
    expect(getCurrentActor(state)).toBe('p1');
  });

  /**
   * The draw takes a turn like any other move, so the actor has to move
   * through it — and because this function *is* the segment seam, that one
   * answer is what gives the draw its curtain, its hand-off and the server's
   * per-draw commit, with nothing else to invent.
   *
   * The cursor is the length of `turnOrderDraws`: seat N+1 draws next.
   */
  it('moves to the next seat as each player draws', () => {
    const state = createInitialGame('seed-a', ['Alex', 'Sam', 'Jordan']);

    state.turnOrderDraws = [{ playerId: 'p1', tile: 'B11' }];
    expect(getCurrentActor(state)).toBe('p2');

    state.turnOrderDraws = [
      { playerId: 'p1', tile: 'B11' },
      { playerId: 'p2', tile: 'H11' },
    ];
    expect(getCurrentActor(state)).toBe('p3');
  });

  it('is the active player during their own stages', () => {
    for (const stage of ['play', 'foundStartup', 'chooseSurvivor', 'buy'] as const) {
      const state = buildFixture({
        players: [{ name: 'Alex' }, { name: 'Sam' }],
        currentPlayerIndex: 1,
        stage,
      });
      expect(getCurrentActor(state)).toBe('p2');
    }
  });

  it('is the queued shareholder during liquidation, not the active player', () => {
    const state = buildFixture({
      players: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jo' }],
      currentPlayerIndex: 0,
      stage: 'mergerLiquidation',
    });
    state.mergerContext = {
      survivorId: 'Gobble',
      absorbedIds: ['Messla'],
      payoutQueue: [],
      currentChoiceIndex: 0,
      absorbedPrices: {},
      currentLiquidationIndex: 0,
      shareholderQueue: ['p2', 'p3'],
      currentShareholderIndex: 1,
    };
    expect(getCurrentActor(state)).toBe('p3');
  });

  it('is nobody once the game is over', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], stage: 'end' });
    expect(getCurrentActor(state)).toBeNull();
  });

  it('returns null rather than throwing when a liquidation queue is exhausted', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], stage: 'mergerLiquidation' });
    expect(getCurrentActor(state)).toBeNull();
  });
});
