// server/socketHarness.ts
// Boots a real server on an ephemeral port and connects real socket.io
// clients to it. Nothing here is mocked: a fake transport cannot see a
// projection that is computed correctly and then broadcast unprojected,
// which is the defect this phase most needs to catch.

import { io as connect, type Socket } from 'socket.io-client';
import { BASE_PATH } from '../basePath.js';
import { createServer } from './index.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  PROTOCOL_VERSION,
  type StateMessage,
  type WireIntent,
} from '../session/protocol.js';
import {
  LOBBY_CLIENT_EVENTS,
  LOBBY_SERVER_EVENTS,
  type JoinedMessage,
  type RejectedMessage,
} from '../vendor/lobby/protocol/protocol.js';

/**
 * Where `createServer` mounts socket.io. The bare '/socket.io' default is
 * gone (see server/index.ts — sockets ride the same front-door route as
 * pages), so every test client must ask for the prefixed path. Exported for
 * the suites that open raw sockets outside `connectPlayer`.
 */
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;

export interface TestServer {
  port: number;
  rooms: ReturnType<typeof createServer>['rooms'];
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const { httpServer, io, rooms } = createServer();

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test server did not bind an ephemeral port');
  }

  return {
    port: address.port,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

/**
 * Waits for the server to finish handling one message on `socket`.
 *
 * The success path is deliberately silent, so there is nothing to await for
 * an accepted mid-segment intent. A round trip through an event the server
 * always answers orders our next assertion after the dispatch it follows —
 * and, on a socket other than the one that sent the triggering message,
 * orders it behind any earlier emit to *that* socket too, since socket.io
 * delivers one connection's messages in order. Exported so callers can
 * settle a bystander's channel (proving a leak didn't arrive, not merely
 * that it wasn't sent) without re-implementing this ordering primitive.
 */
export function settleSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not settle')), 4000);
    socket.timeout(3000).emit('ping-settle', (err?: Error) => {
      clearTimeout(timer);
      if (err) reject(new Error('server did not settle'));
      else resolve();
    });
  });
}

export interface TestClient {
  socket: Socket;
  playerId: string;
  /** Every state message this client received, oldest first. */
  states: StateMessage[];
  /** Every rejection this client received, oldest first. */
  rejections: RejectedMessage[];
  /** The most recent state, or undefined if none has arrived. */
  latest(): StateMessage | undefined;
  send(wire: WireIntent): Promise<void>;
  undo(stepId: number): Promise<void>;
  close(): void;
}

/**
 * Joins an existing room as `playerId`.
 *
 * `token` comes from the registry rather than the wire, because these tests
 * seat golden fixtures through `rooms.fromState` — there is deliberately no
 * socket event that installs a prepared state.
 */
export async function connectPlayer(
  port: number,
  roomId: string,
  name: string,
  playerId: string,
  token: string,
): Promise<TestClient> {
  const socket = connect(`http://localhost:${port}`, {
    transports: ['websocket'],
    path: SOCKET_PATH,
  });
  const states: StateMessage[] = [];
  const rejections: RejectedMessage[] = [];

  socket.on(GAME_SERVER_EVENTS.state, (m: StateMessage) => states.push(m));
  socket.on(LOBBY_SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} never connected`)), 4000);
    socket.on('connect', () => { clearTimeout(timer); resolve(); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} never joined ${roomId}`)), 4000);
    socket.once(LOBBY_SERVER_EVENTS.joined, (_m: JoinedMessage) => { clearTimeout(timer); resolve(); });
    socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, {
      roomId, name, playerId, token, protocolVersion: PROTOCOL_VERSION,
    });
  });

  const settle = () => settleSocket(socket);

  return {
    socket,
    playerId,
    states,
    rejections,
    latest: () => states[states.length - 1],
    async send(wire) {
      socket.emit(GAME_CLIENT_EVENTS.intent, wire);
      await settle();
    },
    async undo(stepId) {
      socket.emit(GAME_CLIENT_EVENTS.undo, { stepId });
      await settle();
    },
    close: () => { socket.disconnect(); },
  };
}
