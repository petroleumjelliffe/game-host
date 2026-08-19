// server/recovery.test.ts
// The phase's third recovery test: a real server process's worth of state,
// thrown away and rebuilt from disk, with real clients reconnecting into it.
//
// Two servers, not one restarted in place — a new `createServer()` against the
// same store directory is what a process restart actually is from the room
// registry's point of view: an empty Map, an empty bindings table, and a
// directory of files.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect } from 'socket.io-client';
import { createServer } from './index.js';
import { createFileStore } from './store.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { connectPlayer, settleSocket, SOCKET_PATH } from './socketHarness.js';
import { PROTOCOL_VERSION } from '../session/protocol.js';
import { LOBBY_CLIENT_EVENTS, LOBBY_SERVER_EVENTS, type RejectedMessage } from '../vendor/lobby/protocol/protocol.js';

let dir: string;

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'acquire-recovery-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function fixture() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    // Not E5: E5 sits right next to Alex's E6, and placing next to an
    // unclaimed loner founds a startup — the placement would then wait on a
    // `chooseFoundingBrand` intent instead of going straight to `buy`, which
    // is not what this test is exercising. I5 is isolated from both hand
    // tiles, so Alex's placement below is a plain isolated tile: `buy`
    // directly, then `endTurn` proceeds without an extra step.
    loners: ['I5'],
    bag: ['I11', 'I12'],
  });
}

/**
 * Waits for `${roomId}.json` to exist in `dir`.
 *
 * `deliver`'s commit branch calls `rooms.persist` fire-and-forget — the
 * socket handler returns, and the client's round trip (`settleSocket`)
 * completes, before the write (`mkdir` → `writeFile` → `rename`) has
 * necessarily reached disk. Closing the server and reopening a second one
 * right after a commit races that write for real; this is the deterministic
 * substitute for a fixed sleep, with the same ordering role `settleSocket`
 * plays for the socket round trip.
 */
async function waitForPersist(dir: string, roomId: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if ((await readdir(dir)).includes(`${roomId}.json`)) return;
    if (Date.now() > deadline) throw new Error(`${roomId}.json never appeared in ${dir}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Boots a server on an ephemeral port against `dir`. */
async function boot() {
  const handle = createServer({ store: createFileStore(dir) });
  await new Promise<void>((r) => handle.httpServer.listen(0, r));
  const address = handle.httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    rooms: handle.rooms,
    close: () => new Promise<void>((r) => {
      handle.io.close();
      handle.httpServer.close(() => r());
    }),
  };
}

describe('a server restarted with a game in progress', () => {
  it('comes back with the roster, the tokens and the last committed state', async () => {
    const first = await boot();
    const room = first.rooms.fromState('KEEP01', ['Alex', 'Sam'], fixture());
    const [alex, sam] = room.players;

    const a = await connectPlayer(first.port, 'KEEP01', 'Alex', alex!.id, alex!.token);
    const s = await connectPlayer(first.port, 'KEEP01', 'Sam', sam!.id, sam!.token);

    // A whole turn, so what survives is a real commit rather than the seeded
    // fixture: place, then end. `endTurn` draws from the bag, so the state
    // after it is one only the server could have produced.
    await a.send({ type: 'placeTile', coord: 'E6' });
    await a.send({ type: 'endTurn' });
    const lastCommitted = room.committed();
    expect(lastCommitted.board).not.toEqual(fixture().board);

    // A trailing *uncommitted* placement: Sam's segment (the one now open)
    // gets a tile on the board that no commit has captured. `persist` must
    // never see this — the store's own docstring calls a draft "never real."
    // If it ever writes `room.draft()` instead of `room.committed()`, this is
    // what would leak onto disk and come back after a restart.
    await s.send({ type: 'placeTile', coord: 'A1' });
    const trailingDraft = room.draft();
    expect(trailingDraft.board).not.toEqual(lastCommitted.board);

    a.close(); s.close();
    await waitForPersist(dir, 'KEEP01');
    await first.close();

    // The restart.
    const second = await boot();
    expect(await second.rooms.restore()).toBe(1);

    // Both clients reconnect on the tokens they were holding — no form, no
    // new seat, nothing re-entered.
    const a2 = await connectPlayer(second.port, 'KEEP01', 'Alex', alex!.id, alex!.token);
    const s2 = await connectPlayer(second.port, 'KEEP01', 'Sam', sam!.id, sam!.token);
    // `connectPlayer` only awaits the `joined` round trip, not the `resume`
    // state message the join handler sends right after it — the same gap
    // Task 5 found and fixed the same way (see its report). Without this,
    // reading `.latest()` below races that second message.
    await settleSocket(a2.socket);
    await settleSocket(s2.socket);

    expect(a2.latest()!.state.board).toEqual(lastCommitted.board);
    expect(s2.latest()!.state.board).toEqual(lastCommitted.board);
    // Not the trailing draft — the uncommitted placement above must not have
    // survived the restart.
    expect(a2.latest()!.state.board).not.toEqual(trailingDraft.board);
    // Their own seats, not each other's and not new ones.
    expect(second.rooms.get('KEEP01')!.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    // Each sees only their own hand, because a restored room is projected
    // like any other.
    expect(a2.latest()!.state.players.find((p) => p.id === sam!.id)!.hand).toEqual([]);

    // And play continues.
    await s2.send({ type: 'placeTile', coord: 'A1' });
    expect(s2.rejections).toEqual([]);

    a2.close(); s2.close();
    await second.close();
  });

  it('tells a client the room is gone rather than seating them as a stranger', async () => {
    const first = await boot();
    const room = first.rooms.fromState('LOST01', ['Alex', 'Sam'], fixture());
    const [alex] = room.players;
    await first.close();

    // A server that never restored — the Render free-tier case, where the
    // filesystem resets and there is nothing on disk to read back.
    const second = await boot();
    expect(await second.rooms.restore()).toBe(0);

    const socket = connect(`http://localhost:${second.port}`, {
      transports: ['websocket'],
      path: SOCKET_PATH,
    });
    const rejections: RejectedMessage[] = [];
    socket.on(LOBBY_SERVER_EVENTS.rejected, (m: RejectedMessage) => rejections.push(m));
    await new Promise<void>((r) => socket.on('connect', () => r()));

    socket.emit(LOBBY_CLIENT_EVENTS.joinRoom, {
      roomId: 'LOST01', name: 'Alex', playerId: alex!.id, token: alex!.token,
      protocolVersion: PROTOCOL_VERSION,
    });
    await settleSocket(socket);

    // The silent failure this guards: seating them as a *new* player in a
    // *new* room, which would look like it worked and be a different game.
    expect(rejections.map((r) => r.code)).toEqual(['noSuchRoom']);
    expect(second.rooms.get('LOST01')).toBeUndefined();

    socket.disconnect();
    await second.close();
  });
});
