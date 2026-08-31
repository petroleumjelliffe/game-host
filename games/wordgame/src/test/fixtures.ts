// Hand-built GameView literals for component tests — no engine replay, no
// dictionary, just the shapes the wire really carries.

import { BOARD_SQUARES } from '../../engine/constants';
import type { GameView, PlayerView, Square } from '../../session/protocol';

export function emptyBoard(): Square[] {
  return Array.from({ length: BOARD_SQUARES }, () => null);
}

export function player(overrides: Partial<PlayerView> & { id: string }): PlayerView {
  return {
    name: overrides.id,
    score: 0,
    rackCount: 7,
    rack: null,
    ...overrides,
  };
}

/** Two seats, `me` to move holding a known rack, opponent redacted. */
export function makeView(overrides: Partial<GameView> = {}): GameView {
  return {
    stage: 'playing',
    players: [
      player({ id: 'me', name: 'Alice', rack: ['C', 'A', 'T', 'S', 'D', 'O', '_'] }),
      player({ id: 'opp', name: 'Bob', rackCount: 7, rack: null }),
    ],
    turnIndex: 0,
    currentPlayerId: 'me',
    board: emptyBoard(),
    bagCount: 72,
    scorelessTurns: 0,
    moveCount: 0,
    log: [],
    ...overrides,
  };
}
