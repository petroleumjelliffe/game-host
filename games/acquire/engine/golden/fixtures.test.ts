import { describe, it, expect } from 'vitest';
import { buildFixture } from './fixtures';
import { getStartupSize } from '../gameHelpers';

describe('buildFixture', () => {
  it('paints authored chains onto the board and marks them founded', () => {
    const state = buildFixture({
      players: [{ name: 'Alex' }, { name: 'Sam' }],
      chains: [{ id: 'Messla', coords: ['B1', 'B2', 'B3'] }],
    });
    expect(getStartupSize(state, 'Messla')).toBe(3);
    expect(state.board['B2']).toEqual({ placed: true, startupId: 'Messla' });
    expect(state.startups['Messla']!.isFounded).toBe(true);
  });

  it('places loners as owned by nobody', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }], loners: ['E5'] });
    expect(state.board['E5']).toEqual({ placed: true });
    expect(state.board['E5'].startupId).toBeUndefined();
  });

  it('gives players ids p1..pN, plus authored cash, hand and shares', () => {
    const state = buildFixture({
      players: [
        { name: 'Alex', cash: 4200, hand: ['C6'], shares: { Messla: 4 } },
        { name: 'Sam' },
      ],
      chains: [{ id: 'Messla', coords: ['B1', 'B2'] }],
    });
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.players[0]).toMatchObject({ cash: 4200, hand: ['C6'], portfolio: { Messla: 4 } });
    expect(state.players[1]!.cash).toBe(6000);
    expect(state.players[1]!.emoji.length).toBeGreaterThan(0);
  });

  it('draws authored shares out of the pool so totals stay consistent', () => {
    const state = buildFixture({
      players: [
        { name: 'Alex', shares: { Messla: 4 } },
        { name: 'Sam', shares: { Messla: 2 } },
      ],
      chains: [{ id: 'Messla', coords: ['B1', 'B2'] }],
    });
    expect(state.startups['Messla']!.availableShares).toBe(25 - 6);
  });

  it('defaults to stage play, player 1, and an empty bag unless authored', () => {
    const state = buildFixture({ players: [{ name: 'Alex' }] });
    expect(state.stage).toBe('play');
    expect(state.turnIndex).toBe(0);
    expect(state.bag).toEqual([]);
    expect(state.log).toEqual([]);
    expect(state.nextStepId).toBe(1);
  });

  it('rejects a chain painted over an already-occupied square', () => {
    expect(() =>
      buildFixture({
        players: [{ name: 'Alex' }],
        chains: [
          { id: 'Messla', coords: ['B1'] },
          { id: 'ZuckFace', coords: ['B1'] },
        ],
      }),
    ).toThrow(/B1/);
  });

  it('rejects handing out more shares than a startup has', () => {
    expect(() =>
      buildFixture({
        players: [{ name: 'Alex', shares: { Messla: 26 } }],
        chains: [{ id: 'Messla', coords: ['B1'] }],
      }),
    ).toThrow(/Messla/);
  });
});
