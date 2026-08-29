// server/wire.test.ts
// The game over real sockets: seats, moves, rejections — and the privacy
// rule as a wire-level invariant, because a projection test that never
// leaves the process cannot catch a send site that skips it.

import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { closeSockets } from '@game-host/host/close.js';
import { BASE_PATH } from '../basePath.js';
import { createDictionary } from '../engine/dictionary.js';
import { CENTER } from '../engine/constants.js';
import { PROTOCOL_VERSION, type StateMessage } from '../session/protocol.js';
import { createGameRoom } from './room.js';
import { createServer, type ServerHandle } from './index.js';
import { seat, twoPlayerState } from './testState.js';

const DICT = createDictionary(['CAT', 'CATS', 'DOG', 'AB']);

let handle: ServerHandle;
let url: string;
let open: Socket[] = [];

beforeEach(async () => {
  handle = createServer({ dictionary: DICT });
  await new Promise<void>((resolve) => handle.httpServer.listen(0, resolve));
  url = `http://localhost:${(handle.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of open) socket.disconnect();
  open = [];
  closeSockets(handle.io);
  await new Promise<void>((resolve) => handle.httpServer.close(() => resolve()));
});

function client(): Promise<Socket> {
  const socket = connect(url, { path: `${BASE_PATH}/socket.io`, transports: ['websocket'] });
  open.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function next<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${event}'`)), timeoutMs);
    socket.once(event, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

/** A known mid-game room with fixed racks, adopted the way a restore seats one. */
function adoptRoom(): void {
  handle.rooms.adopt(
    createGameRoom(
      'TESTRM',
      [seat('p1', 'Ada', 'token-1', true), seat('p2', 'Ben', 'token-2')],
      DICT,
      twoPlayerState(),
    ),
  );
}

async function joinAs(playerId: string, token: string): Promise<{ socket: Socket; state: StateMessage }> {
  const socket = await client();
  const resumed = next<StateMessage>(socket, 'state');
  socket.emit('joinRoom', { roomId: 'TESTRM', playerId, token, protocolVersion: PROTOCOL_VERSION });
  return { socket, state: await resumed };
}

test('a rejoin hands back your own rack and nobody else\'s', async () => {
  adoptRoom();
  const { state } = await joinAs('p1', 'token-1');
  expect(state.reason).toBe('resume');
  const me = state.view.players.find((p) => p.id === 'p1');
  const them = state.view.players.find((p) => p.id === 'p2');
  expect(me?.rack).toEqual(['C', 'A', 'T', 'S', 'E', 'R', 'B']);
  expect(them?.rack).toBeNull();
  expect(them?.rackCount).toBe(7);
  expect(state.view.bagCount).toBe(10);
});

test('a legal play commits to the whole table, each seat redacted for itself', async () => {
  adoptRoom();
  const ada = await joinAs('p1', 'token-1');
  const ben = await joinAs('p2', 'token-2');

  const adaCommit = next<StateMessage>(ada.socket, 'state');
  const benCommit = next<StateMessage>(ben.socket, 'state');
  // CAT through the centre: C=3 A=1 T=1, doubled by the centre square = 10.
  ada.socket.emit('move', {
    type: 'play',
    placements: [
      { pos: CENTER - 1, tile: 'C' },
      { pos: CENTER, tile: 'A' },
      { pos: CENTER + 1, tile: 'T' },
    ],
  });
  const [toAda, toBen] = await Promise.all([adaCommit, benCommit]);

  expect(toAda.reason).toBe('commit');
  expect(toAda.view.players.find((p) => p.id === 'p1')?.score).toBe(10);
  expect(toAda.view.log[0]?.words).toEqual([{ word: 'CAT', score: 10 }]);
  expect(toAda.view.currentPlayerId).toBe('p2');
  expect(toAda.view.board[CENTER]).toEqual({ letter: 'A', isBlank: false });
  // Ada drew back up to 7 from the bag's front (E, E, A).
  expect(toAda.view.players.find((p) => p.id === 'p1')?.rack).toEqual([
    'S', 'E', 'R', 'B', 'E', 'E', 'A',
  ]);
  expect(toAda.view.bagCount).toBe(7);

  // Ben sees the same public facts and none of Ada's rack.
  expect(toBen.view.players.find((p) => p.id === 'p1')?.rack).toBeNull();
  expect(toBen.view.players.find((p) => p.id === 'p2')?.rack).toEqual([
    'D', 'O', 'G', 'X', 'Q', 'U', 'I',
  ]);
  expect(toBen.view.board[CENTER - 1]).toEqual({ letter: 'C', isBlank: false });
});

test('nothing in any wire message names another player\'s tiles', async () => {
  adoptRoom();
  const ben = await joinAs('p2', 'token-2');
  // Ada's fixed rack contains a B; Ben's does not, and no B is on the board
  // or in the log — so a B anywhere in Ben's message is a leak by
  // construction.
  const raw = JSON.stringify(ben.state);
  expect(raw).not.toContain('"B"');
});

test('a word not in the dictionary is rejected, offending words named, state unmoved', async () => {
  adoptRoom();
  const ada = await joinAs('p1', 'token-1');
  const rejected = next<{ code: string; words?: string[] }>(ada.socket, 'rejected');
  ada.socket.emit('move', {
    type: 'play',
    placements: [
      { pos: CENTER, tile: 'T' },
      { pos: CENTER + 1, tile: 'A' },
      { pos: CENTER + 2, tile: 'C' },
    ],
  });
  const answer = await rejected;
  expect(answer.code).toBe('invalidWord');
  expect(answer.words).toEqual(['TAC']);
  // The rejection changed nothing: a fresh rejoin sees the untouched game.
  const again = await joinAs('p1', 'token-1');
  expect(again.state.view.moveCount).toBe(0);
  expect(again.state.view.board[CENTER]).toBeNull();
});

test('moving out of turn is rejected', async () => {
  adoptRoom();
  const ben = await joinAs('p2', 'token-2');
  const rejected = next<{ code: string }>(ben.socket, 'rejected');
  ben.socket.emit('move', { type: 'pass' });
  expect((await rejected).code).toBe('notYourTurn');
});

test('an exchange with fewer than seven tiles in the bag is refused', async () => {
  adoptRoom(); // the fixture bag holds 10, so drain it below 7 first
  const ada = await joinAs('p1', 'token-1');
  const commit = next<StateMessage>(ada.socket, 'state');
  ada.socket.emit('move', {
    type: 'play',
    placements: [
      { pos: CENTER, tile: 'C' },
      { pos: CENTER + 1, tile: 'A' },
      { pos: CENTER + 2, tile: 'T' },
      { pos: CENTER + 3, tile: 'S' },
    ],
  });
  expect((await commit).view.bagCount).toBe(6);
  const ben = await joinAs('p2', 'token-2');
  const rejected = next<{ code: string }>(ben.socket, 'rejected');
  ben.socket.emit('move', { type: 'exchange', tiles: ['Q'] });
  expect((await rejected).code).toBe('exchangeBlocked');
});

test('a malformed move payload is refused before it reaches the engine', async () => {
  adoptRoom();
  const ada = await joinAs('p1', 'token-1');
  const rejected = next<{ code: string }>(ada.socket, 'rejected');
  ada.socket.emit('move', { type: 'play', placements: [{ pos: 9999, tile: 'C' }] });
  expect((await rejected).code).toBe('badMove');
});
