// server/summaries.test.ts
// The room list an entry screen without its own lobby is drawn from: one
// real socket game gets its own row, a wrong token and a missing room come
// back the same shape, and nothing racks-shaped rides along for anyone.

import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { closeSockets } from '@game-host/host/close.js';
import { BASE_PATH } from '../basePath.js';
import { createDictionary } from '../engine/dictionary.js';
import { MAX_PLAYERS } from '../engine/constants.js';
import { PROTOCOL_VERSION, type StateMessage } from '../session/protocol.js';
import { createServer, type ServerHandle } from './index.js';

const DICT = createDictionary(['CAT']);

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

async function fetchSummaries(rooms: { roomId: string; playerId: string; token: string }[]): Promise<{
  summaries: unknown[];
}> {
  const res = await fetch(`${url}${BASE_PATH}/api/summaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rooms }),
  });
  return (await res.json()) as { summaries: unknown[] };
}

test('summarizes a held seat and refuses a bad token identically to a missing room', async () => {
  const ada = await client();
  const adaJoined = next<{ roomId: string; playerId: string; token: string }>(ada, 'joined');
  ada.emit('createRoom', { name: 'Ada', protocolVersion: PROTOCOL_VERSION });
  const adaSeat = await adaJoined;

  const ben = await client();
  const benJoined = next<{ roomId: string; playerId: string; token: string }>(ben, 'joined');
  ben.emit('joinRoom', { roomId: adaSeat.roomId, name: 'Ben', protocolVersion: PROTOCOL_VERSION });
  await benJoined;

  // Begin, then one committed move — a pass, so the test needs no knowledge
  // of the (randomly dealt) racks, same idiom as recovery.test.ts.
  const begun = next<StateMessage>(ada, 'state');
  ada.emit('beginGame');
  const opening = await begun;
  const moverSocket = opening.view.currentPlayerId === adaSeat.playerId ? ada : ben;
  const passed = next<StateMessage>(ada, 'state');
  moverSocket.emit('move', { type: 'pass' });
  await passed;

  const { roomId, playerId, token } = adaSeat;
  const body = await fetchSummaries([
    { roomId, playerId, token },
    { roomId, playerId, token: 'wrong' },
    { roomId: 'ZZZZ', playerId: 'p1', token: 'x' },
  ]);

  expect(body.summaries).toHaveLength(3);
  expect(body.summaries[0]).toMatchObject({
    known: true,
    lifecycle: 'playing',
    capacity: MAX_PLAYERS,
    yourTurn: expect.any(Boolean),
  });
  const known = body.summaries[0] as { players: object[]; lastMove: { kind: string } | null };
  expect(known.players.every((p) => !('rack' in p))).toBe(true);
  expect(known.lastMove).toMatchObject({ kind: 'pass' });
  expect(body.summaries[1]).toEqual({ roomId, known: false });
  expect(body.summaries[2]).toEqual({ roomId: 'ZZZZ', known: false });
});

test('a lobby-stage room summarizes with no game state yet', async () => {
  const ada = await client();
  const adaJoined = next<{ roomId: string; playerId: string; token: string }>(ada, 'joined');
  ada.emit('createRoom', { name: 'Ada', protocolVersion: PROTOCOL_VERSION });
  const { roomId, playerId, token } = await adaJoined;

  const body = await fetchSummaries([{ roomId, playerId, token }]);
  expect(body.summaries).toEqual([{
    roomId,
    known: true,
    lifecycle: 'lobby',
    capacity: MAX_PLAYERS,
    players: [{ name: 'Ada', score: null, isHost: true, isYou: true }],
    yourTurn: false,
    currentPlayerName: null,
    lastMove: null,
    winnerNames: null,
  }]);
});

test('a malformed body is refused rather than probed', async () => {
  const res = await fetch(`${url}${BASE_PATH}/api/summaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notRooms: true }),
  });
  expect(res.status).toBe(400);
});
