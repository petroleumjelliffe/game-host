// server/testState.ts
// A known mid-game state for wire tests: fixed racks, fixed bag, empty
// board, p1 to move. Built as a literal so tests assert against numbers a
// human computed, not against whatever the shuffle dealt.

import type { SeatHolder } from '@game-host/lobby/server/rooms.js';
import { BOARD_SQUARES } from '../engine/constants.js';
import type { GameState } from '../engine/gameTypes.js';

export function seat(id: string, name: string, token: string, isHost = false): SeatHolder {
  return { id, name, token, isHost, connected: false };
}

export function twoPlayerState(): GameState {
  return {
    seed: 'test-seed',
    stage: 'playing',
    players: [
      { id: 'p1', name: 'Ada', rack: ['C', 'A', 'T', 'S', 'E', 'R', 'B'], score: 0 },
      { id: 'p2', name: 'Ben', rack: ['D', 'O', 'G', 'X', 'Q', 'U', 'I'], score: 0 },
    ],
    turnIndex: 0,
    board: Array.from({ length: BOARD_SQUARES }, () => null),
    bag: ['E', 'E', 'A', 'O', 'I', 'N', 'R', 'T', 'L', 'S'],
    scorelessTurns: 0,
    moveCount: 0,
    log: [],
  };
}
