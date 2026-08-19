// The one suite that runs the REAL wire: real socket.io server on an
// ephemeral port, real clients, real 50ms ticks. Everything asserted here is
// what a phone would actually receive — including that marco's phone never
// receives a polo coordinate.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  PROTOCOL_VERSION,
  type GameEvent,
  type GameEventEnvelope,
  type StateMessage,
} from '../protocol/game.js';
import { createAppServer, SOCKET_PATH } from './app.js';

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function stateWhere(
  socket: Socket,
  pred: (s: StateMessage) => boolean,
  timeoutMs = 4000,
): Promise<StateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(GAME_SERVER_EVENTS.state, on);
      reject(new Error('no matching state before timeout'));
    }, timeoutMs);
    const on = (s: StateMessage) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      socket.off(GAME_SERVER_EVENTS.state, on);
      resolve(s);
    };
    socket.on(GAME_SERVER_EVENTS.state, on);
  });
}

function eventWhere(
  socket: Socket,
  pred: (e: GameEvent) => boolean,
  timeoutMs = 4000,
): Promise<GameEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(GAME_SERVER_EVENTS.event, on);
      reject(new Error('no matching event before timeout'));
    }, timeoutMs);
    const on = (env: GameEventEnvelope) => {
      if (!pred(env.event)) return;
      clearTimeout(timer);
      socket.off(GAME_SERVER_EVENTS.event, on);
      resolve(env.event);
    };
    socket.on(GAME_SERVER_EVENTS.event, on);
  });
}

describe('over the wire', () => {
  let app: ReturnType<typeof createAppServer>;
  let url: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    app = createAppServer();
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await app.stop();
  });

  function client(): Socket {
    const c = connect(url, { path: SOCKET_PATH, transports: ['websocket'] });
    clients.push(c);
    return c;
  }

  it('answers health at the root and under the base path', async () => {
    for (const path of ['/health', '/marcopolo/health']) {
      const res = await fetch(url + path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, protocolVersion: PROTOCOL_VERSION });
    }
  });

  it('creates, joins, begins, filters, moves, calls', async () => {
    // Lobby: one creator, two joiners.
    const c1 = client();
    c1.emit('createRoom', { name: 'Ann', protocolVersion: PROTOCOL_VERSION });
    const joined1 = await once<{ roomId: string; playerId: string }>(c1, 'joined');
    const roomId = joined1.roomId;

    const c2 = client();
    c2.emit('joinRoom', { roomId, name: 'Bo', protocolVersion: PROTOCOL_VERSION });
    const joined2 = await once<{ playerId: string }>(c2, 'joined');
    const c3 = client();
    c3.emit('joinRoom', { roomId, name: 'Cy', protocolVersion: PROTOCOL_VERSION });
    const joined3 = await once<{ playerId: string }>(c3, 'joined');

    const bySeat = new Map<string, Socket>([
      [joined1.playerId, c1],
      [joined2.playerId, c2],
      [joined3.playerId, c3],
    ]);

    // Begin → everyone learns who is marco.
    const start = eventWhere(c2, (e) => e.type === 'roundStart');
    c1.emit('beginGame');
    const roundStart = (await start) as Extract<GameEvent, { type: 'roundStart' }>;
    const marcoSocket = bySeat.get(roundStart.marcoId)!;
    const poloId = [...bySeat.keys()].find((id) => id !== roundStart.marcoId)!;
    const poloSocket = bySeat.get(poloId)!;

    // Filtering, over the real wire.
    const marcoSnap = await stateWhere(marcoSocket, () => true);
    for (const p of marcoSnap.players) {
      if (p.role === 'polo') expect('x' in p).toBe(false);
      else expect(typeof p.x).toBe('number');
    }
    expect(marcoSnap.you.callCooldown).toBe(0);
    const poloSnap = await stateWhere(poloSocket, () => true);
    for (const p of poloSnap.players) expect(typeof p.x).toBe('number');
    expect(poloSnap.you.callCooldown).toBeNull();

    // Movement: the polo swims and sees itself move in later snapshots.
    // Target is AWAY from the center, where marco spawns — swimming at the
    // origin could end the round with an accidental catch mid-test.
    const before = poloSnap.players.find((p) => p.id === poloId)!;
    poloSocket.emit(GAME_CLIENT_EVENTS.input, {
      tx: Math.sign(before.x! || 1) * 1.2,
      ty: before.y!,
      turbo: false,
    });
    await stateWhere(poloSocket, (s) => {
      const now = s.players.find((p) => p.id === poloId)!;
      return Math.hypot(now.x! - before.x!, now.y! - before.y!) > 0.02;
    });

    // The call: everyone hears marco; a beat later everyone hears the replies.
    const heardCall = eventWhere(poloSocket, (e) => e.type === 'call');
    const heardReply = eventWhere(marcoSocket, (e) => e.type === 'reply');
    marcoSocket.emit(GAME_CLIENT_EVENTS.call);
    await heardCall;
    const reply = (await heardReply) as Extract<GameEvent, { type: 'reply' }>;
    expect(typeof reply.x).toBe('number'); // ripples DO carry positions — that is the game

    // A polo pressing MARCO is ignored: no call event may reach anyone.
    // Register right before emitting — marco's own earlier legitimate call
    // already fired and was consumed above, so only count arrivals after.
    // Wait out marco's own callCooldown (TUNING.callCooldownSeconds = 5s,
    // just started by that same earlier call) first: tryCall() rejects any
    // second call while it's running regardless of who sends it, so testing
    // immediately would pass even with the marco-only authorization check
    // deleted — this only becomes a real test of THAT gate once the
    // cooldown itself can no longer be the thing blocking the polo's call.
    let spurious = false;
    const onEv = (env: GameEventEnvelope) => {
      if (env.event.type === 'call') spurious = true;
    };
    marcoSocket.on(GAME_SERVER_EVENTS.event, onEv);
    await new Promise((r) => setTimeout(r, 5300));
    poloSocket.emit(GAME_CLIENT_EVENTS.call);
    await new Promise((r) => setTimeout(r, 300));
    marcoSocket.off(GAME_SERVER_EVENTS.event, onEv);
    expect(spurious).toBe(false);
  }, 15000);
});
