import { isGameState } from './gameTypes';
import { createInitialGame } from './init';
import { makeState } from './testHelpers';

describe('isGameState', () => {
  it('accepts a freshly created game', () => {
    const roster = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }];
    expect(isGameState(createInitialGame('seed', roster))).toBe(true);
  });

  it('accepts a hand-built state, with and without final scoring', () => {
    expect(isGameState(makeState())).toBe(true);
    expect(
      isGameState(
        makeState({
          stage: 'over',
          final: {
            adjustments: [{ playerId: 'p1', rackValue: 3, playedOutBonus: 0 }],
            winnerIds: ['p1'],
          },
        }),
      ),
    ).toBe(true);
  });

  it('accepts a state that survived JSON round-tripping', () => {
    const json: unknown = JSON.parse(JSON.stringify(makeState()));
    expect(isGameState(json)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isGameState(null)).toBe(false);
    expect(isGameState(undefined)).toBe(false);
    expect(isGameState('state')).toBe(false);
    expect(isGameState(42)).toBe(false);
    expect(isGameState({})).toBe(false);
  });

  it('rejects a truncated board', () => {
    const state = makeState();
    state.board.pop();
    expect(isGameState(state)).toBe(false);
  });

  it('rejects a corrupt square', () => {
    const good = makeState();
    const bad: unknown = JSON.parse(JSON.stringify(good));
    if (typeof bad === 'object' && bad !== null && 'board' in bad && Array.isArray(bad.board)) {
      bad.board[10] = { letter: '5', isBlank: false };
    }
    expect(isGameState(bad)).toBe(false);
  });

  it('rejects a bad tile in a rack or the bag', () => {
    const state1: unknown = JSON.parse(JSON.stringify(makeState()));
    if (typeof state1 === 'object' && state1 !== null && 'players' in state1 && Array.isArray(state1.players)) {
      const first: unknown = state1.players[0];
      if (typeof first === 'object' && first !== null && 'rack' in first && Array.isArray(first.rack)) {
        first.rack[0] = 'x';
      }
    }
    expect(isGameState(state1)).toBe(false);

    const state2: unknown = JSON.parse(JSON.stringify(makeState()));
    if (typeof state2 === 'object' && state2 !== null && 'bag' in state2 && Array.isArray(state2.bag)) {
      state2.bag[0] = 7;
    }
    expect(isGameState(state2)).toBe(false);
  });

  it('rejects a bad stage, missing players, or a non-array log', () => {
    expect(isGameState({ ...makeState(), stage: 'paused' })).toBe(false);
    expect(isGameState({ ...makeState(), players: [] })).toBe(false);
    expect(isGameState({ ...makeState(), log: 'nothing yet' })).toBe(false);
  });

  it('rejects a malformed final block', () => {
    expect(isGameState({ ...makeState(), final: { adjustments: 'none', winnerIds: [] } })).toBe(false);
    expect(isGameState({ ...makeState(), final: { adjustments: [], winnerIds: [1, 2] } })).toBe(false);
  });
});
