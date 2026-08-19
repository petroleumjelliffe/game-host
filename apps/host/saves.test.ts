// apps/host/saves.test.ts
// Rooms survive a restart, from the directories the host allocated.
//
// Two questions, and only the second is new. Each game already tests that its
// own store round-trips; what no per-game suite can say is whether the *host*
// hands each game somewhere sensible to write, and whether three games'
// saves stay out of each other's way under one DATA_DIR.

import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RB_PROTOCOL_VERSION,
  GAME_CLIENT_EVENTS as RB_CLIENT,
  GAME_SERVER_EVENTS as RB_SERVER,
} from '@game-host/railbaron/session/protocol.js';
import { PROTOCOL_VERSION as AQ_VERSION } from '@game-host/acquire/session/protocol.js';
import {
  cleanup, createRoom, joinRoom, next, nextWhere, startTestHost, type TestHost,
} from './testHost.js';

const RAILBARON = '/railbaron';
const ACQUIRE = '/acquire-startups-m1';
const RED_HOME = { type: 'arrived', seat: 'red', city: 20, region: 'NC', payout: null };

let hosts: TestHost[] = [];
let dataDir: string | undefined;

afterEach(async () => {
  for (const host of hosts) await host.close();
  hosts = [];
  if (dataDir) await cleanup(dataDir);
  dataDir = undefined;
});

async function boot(existing?: string): Promise<TestHost> {
  const host = await startTestHost(existing === undefined ? {} : { dataDir: existing });
  hosts.push(host);
  dataDir = host.dataDir;
  return host;
}

describe('the directories the host allocates', () => {
  it('gives one to each game that persists, and none to the one that does not', async () => {
    const host = await boot();

    const entries = (await readdir(host.dataDir)).sort();

    expect(entries).toEqual(['acquire', 'railbaron']);
    // Marco Polo persists nothing, so it gets no directory at all rather than
    // an empty one somebody has to ask about later.
    expect(entries).not.toContain('marcopolo');
  });

  it('names Acquire\'s by the game, not by its URL', async () => {
    // A directory name is not a URL path. `/acquire-startups-m1` is a GitHub
    // Pages repository name that leaked into the URL and is being retired at
    // cutover; the directory never had to carry it.
    const host = await boot();

    const entries = await readdir(host.dataDir);

    expect(entries).toContain('acquire');
    expect(entries).not.toContain('acquire-startups-m1');
  });
});

describe('a room across a restart', () => {
  it('comes back to a second host booted on the same DATA_DIR', async () => {
    const first = await boot();

    // A Rail Baron room with one real move in it.
    const rb1 = await first.client(RAILBARON);
    const rb2 = await first.client(RAILBARON);
    const { roomId } = await createRoom(rb1, RB_PROTOCOL_VERSION, 'ADA');
    await joinRoom(rb2, roomId, RB_PROTOCOL_VERSION, 'BEN');
    const begun = next<{ events: unknown[] }>(rb1, RB_SERVER.log);
    rb1.emit('beginGame');
    await begun;
    const appended = nextWhere<{ events: { type: string }[] }>(
      rb1, RB_SERVER.log,
      (m) => m.events[m.events.length - 1]?.type === 'arrived',
    );
    rb1.emit(RB_CLIENT.append, { event: RED_HOME });
    await appended;

    // Stop the whole process, keep the disk.
    const dir = first.dataDir;
    await first.close();
    hosts = hosts.filter((h) => h !== first);

    const second = await boot(dir);
    const rejoined = await second.client(RAILBARON);
    const back = next<{ events: unknown[] }>(rejoined, RB_SERVER.log);
    rejoined.emit('joinRoom', { roomId, protocolVersion: RB_PROTOCOL_VERSION, name: 'ADA' });

    // The log is the wire: a restored room hands a joiner the game so far.
    const events = (await back).events;
    expect(events).toContainEqual(RED_HOME);
  });

  it('restores from the path the host chose, not from a game\'s own default', async () => {
    // The proof that `ctx.dataDir` is what a mounted game actually writes to.
    // A game falling back to its own repo-relative default would still pass
    // the round-trip above — it would simply save somewhere else — and this
    // is what tells the two apart.
    const host = await boot();

    const rb = await host.client(RAILBARON);
    const { roomId } = await createRoom(rb, RB_PROTOCOL_VERSION, 'ADA');
    const begun = next<{ events: unknown[] }>(rb, RB_SERVER.log);
    rb.emit('beginGame');
    await begun;

    await nextWhere<unknown>(rb, RB_SERVER.log, () => true, 2000).catch(() => undefined);
    const files = await readdir(`${host.dataDir}/railbaron`);

    expect(files.some((name) => name.includes(roomId))).toBe(true);
  });

  it('keeps two games\' saves in their own directories', async () => {
    const host = await boot();

    const rb = await host.client(RAILBARON);
    const rbRoom = await createRoom(rb, RB_PROTOCOL_VERSION, 'ADA');
    const rbBegun = next<{ events: unknown[] }>(rb, RB_SERVER.log);
    rb.emit('beginGame');
    await rbBegun;

    const aq1 = await host.client(ACQUIRE);
    const aq2 = await host.client(ACQUIRE);
    const aqRoom = await createRoom(aq1, AQ_VERSION, 'Cass');
    await joinRoom(aq2, aqRoom.roomId, AQ_VERSION, 'Dev');
    const aqBegun = next<{ reason: string }>(aq1, 'state');
    aq1.emit('beginGame');
    await aqBegun;

    // Give both stores a moment to land; neither write is awaited by a handler.
    await new Promise<void>((resolve) => { setTimeout(resolve, 200); });

    const rbFiles = await readdir(`${host.dataDir}/railbaron`);
    const aqFiles = await readdir(`${host.dataDir}/acquire`);

    expect(rbFiles.some((name) => name.includes(rbRoom.roomId))).toBe(true);
    expect(aqFiles.some((name) => name.includes(aqRoom.roomId))).toBe(true);
    // Neither game can see the other's rooms.
    expect(rbFiles.some((name) => name.includes(aqRoom.roomId))).toBe(false);
    expect(aqFiles.some((name) => name.includes(rbRoom.roomId))).toBe(false);
  });
});
