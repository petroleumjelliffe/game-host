// apps/host/compose.test.ts
// The load-bearing test: all three games played at once, in one process.
//
// It guards two failures neither visible to nor reachable by any per-game
// suite, because a per-game suite only ever has one engine attached:
//
//   1. The websocket upgrade race. engine.io's `attach` chains `request`
//      listeners but installs `upgrade` listeners additively, so every
//      attached engine sees every upgrade and the ones whose path does not
//      match arm a 1-second timer to kill the socket. `destroyUpgrade: false`
//      is what disarms it.
//   2. Cross-game event-loop interference. Marco Polo runs a 20 Hz simulation
//      per active room; Rail Baron and Acquire do disk-backed work on a turn.
//      They now share one event loop, and "a Marco Polo round fits in a 50 ms
//      tick budget beside two turn-based games" is an argument until something
//      runs it.

import { afterEach, describe, expect, it } from 'vitest';
import {
  GAME_SERVER_EVENTS as MP_SERVER,
  MIN_PLAYERS,
  PROTOCOL_VERSION as MP_VERSION,
} from '@game-host/marcopolo/protocol/game.js';
import {
  GAME_CLIENT_EVENTS as RB_CLIENT,
  GAME_SERVER_EVENTS as RB_SERVER,
  RB_PROTOCOL_VERSION,
} from '@game-host/railbaron/session/protocol.js';
import {
  GAME_CLIENT_EVENTS as AQ_CLIENT,
  GAME_SERVER_EVENTS as AQ_SERVER,
  PROTOCOL_VERSION as AQ_VERSION,
} from '@game-host/acquire/session/protocol.js';
import {
  cleanup, collect, createRoom, joinRoom, next, nextWhere, startTestHost, type TestHost,
} from './testHost.js';

let host: TestHost | undefined;

afterEach(async () => {
  const dataDir = host?.dataDir;
  await host?.close();
  host = undefined;
  if (dataDir) await cleanup(dataDir);
});

// Versions and event names come off each game's own protocol module rather
// than being typed here. A hardcoded string is how this suite would go quietly
// green against a handshake nothing speaks any more — and the first draft of
// this file did exactly that: `'event'` instead of Marco Polo's `'gameEvent'`,
// which failed loudly only because the round never started.
const MARCOPOLO = { base: '/marcopolo', version: MP_VERSION };
const RAILBARON = { base: '/railbaron', version: RB_PROTOCOL_VERSION };
const ACQUIRE = { base: '/acquire', version: AQ_VERSION };

/** Rail Baron's first legal append: red arrives at Chicago (city 20, NC). */
const RED_HOME = { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };

describe('all three games at once', () => {
  it('accepts websocket connections on all three paths simultaneously', async () => {
    host = await startTestHost();

    // Concurrently, not one after the other: sequential connections never put
    // two upgrades in flight at the same moment, which is the whole hazard.
    const [marco, rail, acquire] = await Promise.all([
      host.client(MARCOPOLO.base),
      host.client(RAILBARON.base),
      host.client(ACQUIRE.base),
    ]);

    expect(marco.connected).toBe(true);
    expect(rail.connected).toBe(true);
    expect(acquire.connected).toBe(true);
  });

  it('survives repeated simultaneous upgrades', async () => {
    // The handshake beats the kill timer almost every time, so one connection
    // proves very little. Fifteen triples is not proof either, but it is the
    // cheapest pressure available on a timing bug.
    host = await startTestHost();

    for (let i = 0; i < 15; i += 1) {
      const sockets = await Promise.all([
        host.client(MARCOPOLO.base),
        host.client(RAILBARON.base),
        host.client(ACQUIRE.base),
      ]);
      for (const socket of sockets) expect(socket.connected).toBe(true);
      for (const socket of sockets) socket.disconnect();
    }
  });

  it('runs a Marco Polo round while Rail Baron and Acquire take turns', async () => {
    host = await startTestHost();

    // ---- Marco Polo: a full room, begun. The 20 Hz loop starts here and
    // runs for the rest of this test.
    //
    // MIN_PLAYERS seats, read from the protocol rather than typed as 3: Begin
    // is refused below it, and a game that raised its minimum would otherwise
    // turn this into a mysterious hang rather than a compile-time nudge.
    const swimmers = await Promise.all(
      Array.from({ length: MIN_PLAYERS }, () => host!.client(MARCOPOLO.base)),
    );
    const [host1, ...rest] = swimmers;
    if (host1 === undefined) throw new Error('MIN_PLAYERS must be at least 1');
    const mpRoom = await createRoom(host1, MARCOPOLO.version, 'Ann');
    for (const [i, socket] of rest.entries()) {
      await joinRoom(socket, mpRoom.roomId, MARCOPOLO.version, `Swimmer ${i + 2}`);
    }

    const watcher = rest[0] ?? host1;
    const roundStart = nextWhere<{ event: { type: string } }>(
      watcher, MP_SERVER.event, (envelope) => envelope.event.type === 'roundStart',
    );
    host1.emit('beginGame');
    await roundStart;
    const mp1 = host1;

    // From here the simulation is stepping and broadcasting. Everything below
    // happens while it does.
    const snapshots = collect<unknown>(mp1, MP_SERVER.state);

    // ---- Rail Baron: two seats, begun, and one real move appended.
    const rb1 = await host.client(RAILBARON.base);
    const rb2 = await host.client(RAILBARON.base);
    const rbRoom = await createRoom(rb1, RAILBARON.version, 'ADA');
    await joinRoom(rb2, rbRoom.roomId, RAILBARON.version, 'BEN');
    const begun = next<{ events: unknown[] }>(rb1, RB_SERVER.log);
    rb1.emit('beginGame');
    await begun;

    const appended = nextWhere<{ events: { type: string }[] }>(
      rb2, RB_SERVER.log,
      (m) => m.events[m.events.length - 1]?.type === 'arrived',
    );
    rb1.emit(RB_CLIENT.append, { event: RED_HOME });
    const rbLog = await appended;

    // ---- Acquire: two seats, begun, and a turn-order tile drawn — an intent
    // that runs the engine, projects per player, and persists.
    const aq1 = await host.client(ACQUIRE.base);
    const aq2 = await host.client(ACQUIRE.base);
    const aqRoom = await createRoom(aq1, ACQUIRE.version, 'Cass');
    await joinRoom(aq2, aqRoom.roomId, ACQUIRE.version, 'Dev');
    const aqBegun = next<{ reason: string }>(aq1, AQ_SERVER.state);
    aq1.emit('beginGame');
    expect((await aqBegun).reason).toBe('commit');

    const drawn = next<{ reason: string }>(aq1, AQ_SERVER.state);
    aq1.emit(AQ_CLIENT.intent, { type: 'drawTurnOrderTile' });
    await drawn;

    // ---- All three did real work, and Marco Polo never stopped.
    expect(rbLog.events[rbLog.events.length - 1]).toEqual(RED_HOME);

    // Note what is *not* asserted here: a snapshot count taken the instant
    // the other two games finish. The first draft did that and failed at 0 —
    // correctly. Both turns completed in under 60 ms, which is barely one
    // tick at TUNING.tickHz = 20, so "how many snapshots arrived while they
    // played" measures how fast they were, not whether the loop survived
    // them.
    //
    // The property worth having is that the simulation is still stepping
    // *after* two other games took turns on the same event loop. Three
    // further snapshots is three more ticks, which cannot happen if the loop
    // died, stalled, or was starved.
    const before = snapshots.length;
    await nextWhere<unknown>(mp1, MP_SERVER.state, () => snapshots.length >= before + 3);
    expect(snapshots.length).toBeGreaterThanOrEqual(before + 3);
  });

  it('keeps each game\'s sockets to itself', async () => {
    // Per-game `Server` instances rather than one server with three
    // namespaces — which is what keeps Marco Polo's `io.sockets.sockets`
    // iteration correctly scoped. Under a shared server it would walk all
    // three games' sockets twenty times a second: still correct, but coupled
    // in a way nothing in the code would warn about.
    host = await startTestHost();
    const marco = await host.client(MARCOPOLO.base);
    const rail = await host.client(RAILBARON.base);

    const railHeard = collect<unknown>(rail, 'joined');
    await createRoom(marco, MARCOPOLO.version, 'Ann');

    expect(railHeard).toHaveLength(0);
  });
});
