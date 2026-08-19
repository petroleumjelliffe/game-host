// server/versioning.test.ts
// The handshake check, over real sockets.
//
// `createRoom` and `joinRoom` are the only two handlers an unbound socket can
// usefully reach, and the only two that call `bindings.set`. Everything else
// resolves through a binding, so a client refused here can never act — which
// is why this check lives in two handlers rather than in a socket.io
// middleware, and why every test below asserts the *absence* of a binding as
// well as the presence of a rejection.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { startTestServer, settleSocket, SOCKET_PATH, type TestServer } from './socketHarness.js';
import { SAVE_VERSION } from './store.js';
import { BASE_PATH } from '../basePath.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import {
  LOBBY_CLIENT_EVENTS,
  LOBBY_SERVER_EVENTS,
  type JoinedMessage,
  type RejectedMessage,
} from '../vendor/lobby/protocol/protocol.js';

let server: TestServer;

beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

interface Bare {
  socket: Socket;
  rejections: RejectedMessage[];
  joins: JoinedMessage[];
  close(): void;
}

/** A connected socket that has not joined anything — what a stale client is. */
async function bareSocket(): Promise<Bare> {
  const socket = connect(`http://localhost:${server.port}`, {
    transports: ['websocket'],
    path: SOCKET_PATH,
  });
  const rejections: RejectedMessage[] = [];
  const joins: JoinedMessage[] = [];

  socket.on(LOBBY_SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));
  socket.on(LOBBY_SERVER_EVENTS.joined, (m: JoinedMessage) => joins.push(m));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bare socket never connected')), 4000);
    socket.on('connect', () => { clearTimeout(timer); resolve(); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });

  return { socket, rejections, joins, close: () => { socket.disconnect(); } };
}

/**
 * Every version a client might present that is not this server's.
 *
 * Both directions on purpose. The client deploys to GitHub Pages and the
 * server to Render, independently, so "client is older" and "client is newer"
 * are equally likely — and a check written the usual way, assuming the server
 * always leads, passes the first and waves the second through.
 */
const WRONG_VERSIONS: { label: string; version: number | undefined }[] = [
  { label: 'older than the server', version: PROTOCOL_VERSION - 1 },
  { label: 'newer than the server', version: PROTOCOL_VERSION + 1 },
  // An already-deployed client sends nothing at all. Treating absent as
  // acceptable would exempt exactly the clients this check exists for.
  { label: 'absent entirely', version: undefined },
];

describe('joinRoom refuses a protocol it does not speak', () => {
  for (const { label, version } of WRONG_VERSIONS) {
    it(`refuses a version ${label}, and seats nobody`, async () => {
      const { room } = server.rooms.create('Alex');
      const seatsBefore = room.players.length;
      const client = await bareSocket();

      try {
        const msg: Record<string, unknown> = { roomId: room.id, name: 'Sam' };
        if (version !== undefined) msg.protocolVersion = version;
        client.socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, msg);
        await settleSocket(client.socket);

        expect(client.rejections.map((r) => r.code)).toEqual(['versionMismatch']);
        // The seat is the real assertion. A rejection that still seated the
        // player would leave a stale client holding a place in the room.
        expect(room.players.length).toBe(seatsBefore);
        expect(client.joins).toEqual([]);
      } finally {
        client.close();
      }
    });
  }

  it('accepts the version this server actually speaks', async () => {
    // The control. Without it every assertion above passes on a server that
    // refuses everything, including correct clients.
    const { room } = server.rooms.create('Alex');
    const client = await bareSocket();

    try {
      client.socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, {
        roomId: room.id,
        name: 'Sam',
        protocolVersion: PROTOCOL_VERSION,
      });
      await settleSocket(client.socket);

      expect(client.rejections).toEqual([]);
      expect(client.joins).toHaveLength(1);
      expect(room.players.length).toBe(2);
    } finally {
      client.close();
    }
  });
});

/**
 * Motivated by a real blind spot, on 2026-08-07: with a local client about to
 * be pointed at the deployed server, there was no way to tell what that server
 * was running short of opening the Render dashboard. `/health` answered
 * `{ ok: true }` — alive, and nothing else. A client expecting Phase 4's wire
 * against a server that predates it would have presented as a game bug.
 */
describe('/health says what this server speaks', () => {
  it('reports both versions', async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);

    expect(res.status).toBe(200);
    // Read from the constants, not typed in again: a literal here would go
    // stale at the first bump and assert that the bump had not happened.
    expect(await res.json()).toEqual({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      saveVersion: SAVE_VERSION,
    });
  });

  it('needs no version of its own to answer', async () => {
    // The point of it: a client that cannot complete the handshake — the
    // exact case you are debugging — can still ask what the server speaks.
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect((await res.json()).protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('answers the same under the base path — the route the front door forwards', async () => {
    // Behind the game-host proxy every request arrives prefixed, so a bare
    // `/health` is unreachable from outside; the twin under BASE_PATH is what
    // an operator's curl through port 80 actually hits.
    const bare = await fetch(`http://localhost:${server.port}/health`);
    const prefixed = await fetch(`http://localhost:${server.port}${BASE_PATH}/health`);

    expect(prefixed.status).toBe(200);
    expect(await prefixed.json()).toEqual(await bare.json());
  });
});

describe('createRoom refuses a protocol it does not speak', () => {
  for (const { label, version } of WRONG_VERSIONS) {
    it(`refuses a version ${label}, and creates no room`, async () => {
      const before = server.rooms.all().length;
      const client = await bareSocket();

      try {
        const msg: Record<string, unknown> = { name: 'Alex' };
        if (version !== undefined) msg.protocolVersion = version;
        client.socket.emit(LOBBY_CLIENT_EVENTS.createRoom, msg);
        await settleSocket(client.socket);

        expect(client.rejections.map((r) => r.code)).toEqual(['versionMismatch']);
        // A room created and then abandoned would be persisted and restored
        // at the next boot, so this is a leak as well as a wrong answer.
        expect(server.rooms.all().length).toBe(before);
        expect(client.joins).toEqual([]);
      } finally {
        client.close();
      }
    });
  }

  it('accepts the version this server actually speaks', async () => {
    const before = server.rooms.all().length;
    const client = await bareSocket();

    try {
      client.socket.emit(LOBBY_CLIENT_EVENTS.createRoom, {
        name: 'Alex',
        protocolVersion: PROTOCOL_VERSION,
      });
      await settleSocket(client.socket);

      expect(client.rejections).toEqual([]);
      expect(client.joins).toHaveLength(1);
      expect(server.rooms.all().length).toBe(before + 1);
    } finally {
      client.close();
    }
  });
});
