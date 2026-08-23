// A tap-for-tap wire probe: plays the client's opening flow — homes, order,
// first destination, then three illegal reroll attempts — over a real socket,
// mirroring the client exactly (outcomes come from
// rollDestination(currentCity(seat), rng, homesTaken(state)), the same call
// useOnlineGame.roll() makes). Locally it is one more wire test. Its second
// job is the reason it exists: pointed at a deployment with
//   WIRE_URL=https://acquire-multiplayer.onrender.com npx vitest run --root games/railbaron wireProbe
// it creates a scratch room on the LIVE server and reports, event by event,
// what production accepted and refused — /tmp/rb-wire-prod.txt. Built
// 2026-08-22 chasing the game-night reroll report (see docs/backlog.md);
// production refused every reroll, which is what parked the bug.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS, RB_PROTOCOL_VERSION,
  type LogMessage,
} from '../session/protocol.js';
import { rollDestination, destinationInRegion } from '../engine/index.js';
import type { GameEvent } from '../src/state/events.js';
import { currentCity, replay } from '../src/state/game.js';
import { homesTaken, needsDestination } from '../src/state/turns.js';
import { nodeForCity } from '../engine/index.js';
import type { JoinedMessage } from '@game-host/lobby/protocol/protocol';
import { SOCKET_PATH, startServer, type RunningServer } from './index.js';

const PROD = process.env.WIRE_URL; // e.g. https://acquire-multiplayer.onrender.com
let server: RunningServer | null = null;
const open: ClientSocket[] = [];

beforeEach(async () => {
  if (PROD) return; // production: nothing to boot
  const gamesDir = await mkdtemp(join(tmpdir(), 'rb-repro-'));
  server = await startServer({ port: 0, gamesDir });
});

afterEach(async () => {
  for (const s of open) s.disconnect();
  open.length = 0;
  await server?.close();
});

function next<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve) => { socket.once(event, resolve as (v: T) => void); });
}

function client(): ClientSocket {
  const socket = connect(PROD ?? `http://localhost:${server!.port}`, {
    path: SOCKET_PATH, transports: ['websocket'],
  });
  open.push(socket);
  return socket;
}

function createRoom(socket: ClientSocket): Promise<JoinedMessage> {
  const joined = next<JoinedMessage>(socket, 'joined');
  socket.emit('createRoom', { protocolVersion: RB_PROTOCOL_VERSION, name: 'ADA' });
  return joined;
}

function joinRoom(
  socket: ClientSocket, roomId: string, opts: { name: string },
): Promise<JoinedMessage> {
  const joined = next<JoinedMessage>(socket, 'joined');
  socket.emit('joinRoom', { protocolVersion: RB_PROTOCOL_VERSION, roomId, name: opts.name });
  return joined;
}

/** Append and race the echo against a rejection, reporting which. */
function tryAppend(socket: ClientSocket, event: GameEvent):
  Promise<{ kind: 'accepted'; log: GameEvent[] } | { kind: 'rejected'; code: string; message: string }> {
  return new Promise((resolve) => {
    const landed = JSON.stringify(event);
    const onLog = (m: LogMessage) => {
      if (JSON.stringify(m.events[m.events.length - 1]) === landed) {
        socket.off(GAME_SERVER_EVENTS.log, onLog);
        socket.off('rejected', onRejected);
        resolve({ kind: 'accepted', log: m.events });
      }
    };
    const onRejected = (r: { code: string; message: string }) => {
      socket.off(GAME_SERVER_EVENTS.log, onLog);
      socket.off('rejected', onRejected);
      resolve({ kind: 'rejected', ...r });
    };
    socket.on(GAME_SERVER_EVENTS.log, onLog);
    socket.on('rejected', onRejected);
    socket.emit(GAME_CLIENT_EVENTS.append, { event });
  });
}

/** Exactly what useOnlineGame.roll()+commitRoll() would send, given this log. */
function clientDestinationEvent(log: GameEvent[], seat: 'red' | 'green'): GameEvent {
  const state = replay(log);
  const me = state.seats[seat];
  const outcome = rollDestination(currentCity(me), Math.random, homesTaken(state));
  if (outcome.kind === 'chooseRegion') {
    // The table answers the ballot with the first region; the client then
    // sends the arrived that destinationInRegion computes.
    const arrival = destinationInRegion(currentCity(me)!, outcome.rolled, Math.random);
    return { type: 'arrived', seat, city: arrival.city,
             region: arrival.region, payout: arrival.payout };
  }
  return { type: 'arrived', seat, city: outcome.city,
           region: outcome.region,
           payout: outcome.kind === 'home' ? null : outcome.payout };
}

it('repro: the table flow, tap for tap — can red reroll a destination?', async () => {
  const host = client();
  const { roomId } = await createRoom(host);
  const guest = client();
  await joinRoom(guest, roomId, { name: 'BEN' });

  const begun = next<LogMessage>(host, GAME_SERVER_EVENTS.log);
  host.emit('beginGame');
  let log = (await begun).events;

  const report: string[] = [];
  const state0 = replay(log);
  report.push(`after begin: phase=${state0.phase} turn=${state0.turn}`);

  // Homes: red rolls, green rolls — via the same client computation.
  let r = await tryAppend(host, clientDestinationEvent(log, 'red'));
  report.push(`red home: ${r.kind}`);
  if (r.kind === 'accepted') log = r.log;
  r = await tryAppend(guest, clientDestinationEvent(log, 'green'));
  report.push(`green home: ${r.kind}`);
  if (r.kind === 'accepted') log = r.log;

  // Order: red first.
  r = await tryAppend(host, { type: 'orderRolled', seat: 'red', first: 'red' });
  report.push(`orderRolled: ${r.kind}`);
  if (r.kind === 'accepted') log = r.log;

  // Red taps the row: first destination.
  const first = clientDestinationEvent(log, 'red');
  r = await tryAppend(host, first);
  report.push(`destination 1 (${JSON.stringify(first)}): ${r.kind}`);
  if (r.kind === 'accepted') log = r.log;

  // Red taps again, and again, and again — the reported bug.
  for (let i = 2; i <= 4; i++) {
    const state = replay(log);
    const me = state.seats.red;
    report.push(`before tap ${i}: at=${me.at} lastStop=${me.stops[me.stops.length - 1]?.city} `
      + `needsDestination=${needsDestination(me, nodeForCity)} homeward=${me.homeward}`);
    const again = clientDestinationEvent(log, 'red');
    r = await tryAppend(host, again);
    report.push(`destination ${i} (${JSON.stringify(again)}): ${r.kind}`
      + (r.kind === 'rejected' ? ` — ${r.message}` : ''));
    if (r.kind === 'accepted') log = r.log;
    // The probe's teeth: a second destination without a walk is never legal.
    expect(r.kind, `tap ${i} must be refused`).toBe('rejected');
  }

  const { writeFileSync } = await import('node:fs');
  writeFileSync(PROD ? '/tmp/rb-wire-prod.txt' : '/tmp/rb-wire-repro.txt', report.join('\n'));
  expect(true).toBe(true);
}, 20000);
