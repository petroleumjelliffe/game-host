// server/recovery.test.ts
// Kill a server, boot a second one on the same store, get the game back —
// the P0 for a game whose turns are days apart. Also the eviction policy,
// which is this game's own (60 days live, 30 finished) rather than
// Acquire's 7.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { closeSockets } from '@game-host/host/close.js';
import { BASE_PATH } from '../basePath.js';
import { createDictionary } from '../engine/dictionary.js';
import { PROTOCOL_VERSION, type StateMessage } from '../session/protocol.js';
import { createServer, type ServerHandle } from './index.js';
import { createFileStore, type SavedRoom } from './store.js';
import {
  ACTIVE_MAX_AGE_MS,
  FINISHED_MAX_AGE_MS,
  createRoomRegistry,
} from './rooms.js';
import { twoPlayerState } from './testState.js';

const DICT = createDictionary(['CAT']);

let dir: string;
let handles: ServerHandle[] = [];
let open: Socket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wordgame-recovery-'));
});

afterEach(async () => {
  for (const socket of open) socket.disconnect();
  open = [];
  for (const handle of handles) {
    await handle.game.close();
    await new Promise<void>((resolve) => handle.httpServer.close(() => resolve()));
  }
  handles = [];
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function boot(): Promise<{ handle: ServerHandle; url: string }> {
  const handle = createServer({ store: createFileStore(dir), dictionary: DICT });
  handles.push(handle);
  await new Promise<void>((resolve) => handle.httpServer.listen(0, resolve));
  return { handle, url: `http://localhost:${(handle.httpServer.address() as AddressInfo).port}` };
}

function client(url: string): Promise<Socket> {
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

test('a mid-game room survives a restart, tokens and all', async () => {
  const first = await boot();
  const ada = await client(first.url);
  const joined = next<{ roomId: string; playerId: string; token: string }>(ada, 'joined');
  ada.emit('createRoom', { name: 'Ada', protocolVersion: PROTOCOL_VERSION });
  const adaSeat = await joined;

  const ben = await client(first.url);
  const benJoined = next<{ roomId: string; playerId: string; token: string }>(ben, 'joined');
  ben.emit('joinRoom', { roomId: adaSeat.roomId, name: 'Ben', protocolVersion: PROTOCOL_VERSION });
  const benSeat = await benJoined;

  // Begin, then one real move. A pass is always legal, so the test needs no
  // knowledge of the (randomly dealt, deliberately unknown) racks.
  const begun = next<StateMessage>(ada, 'state');
  ada.emit('beginGame');
  const opening = await begun;
  expect(opening.view.moveCount).toBe(0);
  const firstMover = opening.view.currentPlayerId;
  const moverSocket = firstMover === adaSeat.playerId ? ada : ben;
  const passed = next<StateMessage>(ada, 'state');
  moverSocket.emit('move', { type: 'pass' });
  expect((await passed).view.moveCount).toBe(1);

  // Stop the process, keep the disk. game.close() drains saves and closes
  // the sockets; the HTTP server is ours to close, as in production.
  const roomId = adaSeat.roomId;
  const stopping = handles[0];
  handles = [];
  await stopping?.game.close();
  await new Promise<void>((resolve) => stopping?.httpServer.close(() => resolve()));
  ada.disconnect();
  ben.disconnect();

  const second = await boot();
  expect(await second.handle.rooms.restore()).toBe(1);
  const back = await client(second.url);
  const resumed = next<StateMessage>(back, 'state');
  back.emit('joinRoom', {
    roomId,
    playerId: benSeat.playerId,
    token: benSeat.token,
    protocolVersion: PROTOCOL_VERSION,
  });
  const state = await resumed;
  expect(state.reason).toBe('resume');
  expect(state.view.moveCount).toBe(1);
  expect(state.view.log[0]?.kind).toBe('pass');
  // And the restored view is still redacted: only Ben's own rack came back.
  expect(state.view.players.find((p) => p.id === benSeat.playerId)?.rack).toHaveLength(7);
  expect(
    state.view.players.filter((p) => p.id !== benSeat.playerId).every((p) => p.rack === null),
  ).toBe(true);
});

test('eviction: finished rooms age out at 30 days, live ones at 60', async () => {
  const store = createFileStore(dir);
  const now = Date.now();
  const record = (roomId: string, savedAt: number, over: boolean): SavedRoom => {
    const state = twoPlayerState();
    if (over) state.stage = 'over';
    return {
      roomId,
      version: 1,
      protocolVersion: PROTOCOL_VERSION,
      savedAt,
      players: [
        { id: 'p1', name: 'Ada', token: 't1', isHost: true, connected: false },
        { id: 'p2', name: 'Ben', token: 't2', isHost: false, connected: false },
      ],
      state,
    };
  };
  await store.save(record('LIVEOK', now - ACTIVE_MAX_AGE_MS + 60_000, false));
  await store.save(record('LIVOLD', now - ACTIVE_MAX_AGE_MS - 60_000, false));
  await store.save(record('OVEROK', now - FINISHED_MAX_AGE_MS + 60_000, true));
  await store.save(record('OVROLD', now - FINISHED_MAX_AGE_MS - 60_000, true));
  await store.settled();

  const rooms = createRoomRegistry(store, DICT);
  expect(await rooms.restore(now)).toBe(2);
  expect(rooms.get('LIVEOK')).toBeDefined();
  expect(rooms.get('OVEROK')).toBeDefined();
  expect(rooms.get('LIVOLD')).toBeUndefined();
  expect(rooms.get('OVROLD')).toBeUndefined();
  // A 40-day-old live game — Acquire's policy would have evicted it at 7
  // days — is exactly the multi-day case this game exists for.
  expect(ACTIVE_MAX_AGE_MS).toBeGreaterThan(39 * 24 * 60 * 60 * 1000);
});
