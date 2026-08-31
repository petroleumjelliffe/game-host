// session/view.test.ts
// The redaction, unit-level. The wire-level twin is server/wire.test.ts;
// this one pins the function itself, including the structural claim that a
// view has nowhere to put a secret.

import { viewFor } from './view.js';
import { twoPlayerState } from '../server/testState.js';

test('the viewer sees their own rack and only counts of everyone else', () => {
  const state = twoPlayerState();
  const view = viewFor(state, 'p1');
  const [me, them] = view.players;
  expect(me?.rack).toEqual(['C', 'A', 'T', 'S', 'E', 'R', 'B']);
  expect(me?.rackCount).toBe(7);
  expect(them?.rack).toBeNull();
  expect(them?.rackCount).toBe(7);
});

test('a spectator sees no rack at all', () => {
  const view = viewFor(twoPlayerState(), null);
  expect(view.players.every((p) => p.rack === null)).toBe(true);
});

test('the bag and the seed are not representable, not merely blanked', () => {
  const view = viewFor(twoPlayerState(), 'p1');
  expect(view.bagCount).toBe(10);
  expect('bag' in view).toBe(false);
  expect('seed' in view).toBe(false);
});

test('mutating a view never reaches the state it came from', () => {
  const state = twoPlayerState();
  const view = viewFor(state, 'p1');
  view.players[0]?.rack?.push('Z');
  view.board[0] = { letter: 'Z', isBlank: false };
  expect(state.players[0]?.rack).toHaveLength(7);
  expect(state.board[0]).toBeNull();
});

test('the current player and final scoring ride the view', () => {
  const state = twoPlayerState();
  expect(viewFor(state, 'p1').currentPlayerId).toBe('p1');
  const over: typeof state = {
    ...state,
    stage: 'over',
    final: {
      adjustments: [
        { playerId: 'p1', rackValue: 3, playedOutBonus: 9 },
        { playerId: 'p2', rackValue: 9, playedOutBonus: 0 },
      ],
      winnerIds: ['p1'],
    },
  };
  const view = viewFor(over, 'p2');
  expect(view.currentPlayerId).toBeNull();
  expect(view.final?.winnerIds).toEqual(['p1']);
});
