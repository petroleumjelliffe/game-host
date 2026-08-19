import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, RB_PROTOCOL_VERSION,
  type LogMessage,
} from '../session/protocol';
import type { GameEvent } from '../src/state/events';
import type { JoinedMessage } from '../vendor/lobby/protocol/protocol';
import { SOCKET_PATH, startServer, type RunningServer } from './index';

/**
 * A Render deploy restarts the process while people are mid-turn, so "the
 * game survives its server" is a requirement rather than a nicety. This kills
 * a real server and boots a new one on the same directory — a new port, so
 * nothing can be reused by accident — and expects the room, its logs and its
 * seat tokens to come back.
 */

const redHome: GameEvent =
  { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };
const greenHome: GameEvent =
  { type: 'arrived', seat: 'green', city: 9, region: 'SE', payout: null };

const running: RunningServer[] = [];
const open: ClientSocket[] = [];

afterEach(async () => {
  for (const s of open) s.disconnect();
  open.length = 0;
  for (const s of running) await s.close();
  running.length = 0;
});

async function boot(gamesDir: string): Promise<RunningServer> {
  const server = await startServer({ port: 0, gamesDir });
  running.push(server);
  return server;
}

function client(server: RunningServer): ClientSocket {
  const socket = connect(`http://localhost:${server.port}`, {
    path: SOCKET_PATH, transports: ['websocket'],
  });
  open.push(socket);
  return socket;
}

function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => { socket.once(event, resolve as (v: T) => void); });
}

function append(socket: ClientSocket, event: GameEvent): Promise<GameEvent[]> {
  const landed = JSON.stringify(event);
  return new Promise<GameEvent[]>((resolve, reject) => {
    const onLog = (msg: LogMessage): void => {
      if (JSON.stringify(msg.events[msg.events.length - 1]) !== landed) return;
      cleanup();
      resolve(msg.events);
    };
    const onRejected = (r: { code: string; message: string }): void => {
      cleanup();
      reject(new Error(`refused ${event.type}: ${r.code} — ${r.message}`));
    };
    function cleanup(): void {
      socket.off(GAME_SERVER_EVENTS.log, onLog);
      socket.off('rejected', onRejected);
    }
    socket.on(GAME_SERVER_EVENTS.log, onLog);
    socket.on('rejected', onRejected);
    socket.emit(GAME_CLIENT_EVENTS.append, { event });
  });
}

describe('a reboot keeps its rooms and their tokens', () => {
  it('restores the log, and an append legal before is legal after', async () => {
    const gamesDir = await mkdtemp(join(tmpdir(), 'rb-recover-'));
    const first = await boot(gamesDir);

    const host = client(first);
    const hostSeat = next<JoinedMessage>(host, 'joined');
    host.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name: 'ADA' });
    const { roomId } = await hostSeat;

    const guest = client(first);
    const guestJoined = next<JoinedMessage>(guest, 'joined');
    guest.emit('joinRoom', { roomId, protocolVersion: RB_PROTOCOL_VERSION, name: 'BEN' });
    const guestSeat = await guestJoined;

    const begun = next<LogMessage>(host, GAME_SERVER_EVENTS.log);
    host.emit('beginGame');
    await begun;
    const before = await append(host, redHome);
    expect(before).toHaveLength(4);

    // The process dies with the players mid-game.
    for (const s of open) s.disconnect();
    open.length = 0;
    await first.close();
    running.length = 0;

    // A new server, a new port: nothing is reused but the directory.
    const second = await boot(gamesDir);
    expect(second.port).not.toBe(first.port);

    const returningHost = client(second);
    const hostLog = next<LogMessage>(returningHost, GAME_SERVER_EVENTS.log);
    const rejoined = next<JoinedMessage>(returningHost, 'joined');
    returningHost.emit('joinRoom', {
      roomId, protocolVersion: RB_PROTOCOL_VERSION,
      playerId: 'red', token: (await hostSeat).token,
    });
    expect((await rejoined).playerId).toBe('red');
    expect((await hostLog).events).toEqual(before);

    const returningGuest = client(second);
    const guestLog = next<LogMessage>(returningGuest, GAME_SERVER_EVENTS.log);
    const guestBack = next<JoinedMessage>(returningGuest, 'joined');
    returningGuest.emit('joinRoom', {
      roomId, protocolVersion: RB_PROTOCOL_VERSION,
      playerId: guestSeat.playerId, token: guestSeat.token,
    });
    expect((await guestBack).playerId).toBe('green');
    expect((await guestLog).events).toEqual(before);

    // The game carries on: green's home was owed before the kill and is
    // still owed after it.
    expect(await append(returningGuest, greenHome)).toHaveLength(5);
  }, 20_000);

  it('loses one room to a corrupt record, never the boot', async () => {
    const gamesDir = await mkdtemp(join(tmpdir(), 'rb-recover-bad-'));
    const first = await boot(gamesDir);

    const rooms: JoinedMessage[] = [];
    for (const name of ['ADA', 'BEN']) {
      const socket = client(first);
      const joined = next<JoinedMessage>(socket, 'joined');
      socket.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name });
      const seat = await joined;
      const begun = next<LogMessage>(socket, GAME_SERVER_EVENTS.log);
      socket.emit('beginGame');
      await begun;
      await append(socket, redHome);
      rooms.push(seat);
    }
    const [intact, doomed] = rooms as [JoinedMessage, JoinedMessage];

    for (const s of open) s.disconnect();
    open.length = 0;
    await first.close();
    running.length = 0;

    // One record goes bad between boots, as a shape change across a deploy
    // would leave it.
    expect((await readdir(gamesDir)).sort())
      .toEqual([`${doomed.roomId}.json`, `${intact.roomId}.json`].sort());
    await writeFile(join(gamesDir, `${doomed.roomId}.json`), '{ not json at all');

    const second = await boot(gamesDir);

    // The player who was in the intact room comes back to it, with the seat
    // and token the dead process issued.
    const good = client(second);
    const goodJoined = next<JoinedMessage>(good, 'joined');
    const goodLog = next<LogMessage>(good, GAME_SERVER_EVENTS.log);
    good.emit('joinRoom', {
      roomId: intact.roomId, protocolVersion: RB_PROTOCOL_VERSION,
      playerId: intact.playerId, token: intact.token,
    });
    await goodJoined;
    // A one-player room: joined(red) + started, then red's home.
    expect((await goodLog).events).toHaveLength(3);

    // The bad one is simply not there — one record costs one room, and the
    // player holding a perfectly good token for it is told the room is gone
    // rather than that their seat was refused.
    const bad = client(second);
    const refused = next<{ code: string }>(bad, 'rejected');
    bad.emit('joinRoom', {
      roomId: doomed.roomId, protocolVersion: RB_PROTOCOL_VERSION,
      playerId: doomed.playerId, token: doomed.token,
    });
    expect((await refused).code).toBe('noSuchRoom');

    // And the server is perfectly well: a new room still works.
    const fresh = client(second);
    const freshJoined = next<JoinedMessage>(fresh, 'joined');
    fresh.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name: 'EVE' });
    expect((await freshJoined).roomId).toBeTruthy();
  }, 20_000);
});
