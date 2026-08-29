// apps/host/notifications.test.ts
// The notification pipeline through the whole composed stack: a real Acquire
// room over real sockets, the /notify HTTP surface, and the on-disk markers.
//
// No channel is configured here (no VAPID, no SMTP — exactly how every dev
// boot runs), so nothing "sends"; what this proves is everything up to the
// send. The once-per-turn marker is written by the same code path that
// chooses to send, so its presence is the observable half of "a disconnected
// actor would have been notified" — and its absence, with the actor still
// connected, is the debounce doing its job. The channels themselves are
// proven against fakes in packages/notify.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, afterAll, expect, it } from 'vitest';
import { PROTOCOL_VERSION as AQ_VERSION } from '@game-host/acquire/session/protocol.js';
import { cleanup, createRoom, joinRoom, next, startTestHost, type TestHost } from './testHost.js';

const ACQUIRE = '/acquire';
const PLAYER_KEY = 'test-player-key-0123456789abcdef';
const DEBOUNCE_MS = 40;

let savedDebounce: string | undefined;
beforeAll(() => {
  savedDebounce = process.env.NOTIFY_DEBOUNCE_MS;
  process.env.NOTIFY_DEBOUNCE_MS = String(DEBOUNCE_MS);
});
afterAll(() => {
  if (savedDebounce === undefined) delete process.env.NOTIFY_DEBOUNCE_MS;
  else process.env.NOTIFY_DEBOUNCE_MS = savedDebounce;
});

let hosts: TestHost[] = [];
let dirs: string[] = [];

afterEach(async () => {
  for (const host of hosts) await host.close();
  hosts = [];
  for (const dir of dirs) await cleanup(dir);
  dirs = [];
});

async function boot(): Promise<TestHost> {
  const host = await startTestHost();
  hosts.push(host);
  dirs.push(host.dataDir);
  return host;
}

interface JoinedWithToken {
  roomId: string;
  playerId: string;
  token: string;
}

async function bind(
  host: TestHost,
  seat: JoinedWithToken,
  token = seat.token,
): Promise<Response> {
  return fetch(`${host.url}/notify/bind`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerKey: PLAYER_KEY,
      game: 'acquire',
      roomId: seat.roomId,
      playerId: seat.playerId,
      token,
    }),
  });
}

interface RoomMarkerRecord {
  bindings: Record<string, string>;
  lastNotified: Record<string, string>;
}

async function markerRecord(host: TestHost, roomId: string): Promise<RoomMarkerRecord | null> {
  try {
    const raw = await readFile(
      join(host.dataDir, 'notifications', 'rooms', `acquire--${roomId}.json`),
      'utf8',
    );
    return JSON.parse(raw) as RoomMarkerRecord;
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

it('binding a seat needs that seat\'s real token', async () => {
  const host = await boot();
  const socket = await host.client(ACQUIRE);
  const joined = next<JoinedWithToken>(socket, 'joined');
  socket.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Cass' });
  const seat = await joined;

  const stolen = await bind(host, seat, 'not-the-token');
  expect(stolen.status).toBe(403);
  const real = await bind(host, seat);
  expect(real.status).toBe(200);
  // The binding is on disk, so it survives a redeploy. The save is
  // fire-and-forget (a player never waits on a disk), so poll for it.
  let record: RoomMarkerRecord | null = null;
  for (let i = 0; i < 40 && record === null; i++) {
    await wait(25);
    record = await markerRecord(host, seat.roomId);
  }
  expect(record?.bindings[seat.playerId]).toBeDefined();
});

it('a disconnected actor gets a turn marker; a connected one never does', async () => {
  const host = await boot();
  const creator = await host.client(ACQUIRE);
  const joinedMsg = next<JoinedWithToken>(creator, 'joined');
  creator.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Cass' });
  const p1 = await joinedMsg;
  const guest = await host.client(ACQUIRE);
  await joinRoom(guest, p1.roomId, AQ_VERSION, 'Dev');

  expect((await bind(host, p1)).status).toBe(200);

  // Begin: the first commit reports p1 (first in seat order) as the actor.
  const begun = next<{ reason: string }>(creator, 'state');
  creator.emit('beginGame');
  await begun;

  // Both players connected: the debounce fires and declines.
  await wait(DEBOUNCE_MS * 4);
  let record = await markerRecord(host, p1.roomId);
  expect(record?.lastNotified ?? {}).toEqual({});

  // Now the actor walks away. Nothing re-reports the turn — the pending
  // window already passed — so play one more commit from the guest? No:
  // p1 is still the actor. Re-trigger by disconnecting and having the
  // *server* see a fresh turn report requires a commit, which only the
  // actor can produce. So instead assert the inverse on a fresh room:
  creator.disconnect();
  const c2 = await host.client(ACQUIRE);
  const j2 = next<JoinedWithToken>(c2, 'joined');
  c2.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Eve' });
  const p1b = await j2;
  const g2 = await host.client(ACQUIRE);
  await joinRoom(g2, p1b.roomId, AQ_VERSION, 'Finn');
  expect((await bind(host, p1b)).status).toBe(200);
  const begun2 = next<{ reason: string }>(c2, 'state');
  c2.emit('beginGame');
  await begun2;
  // The actor drops immediately after their turn starts and stays away
  // past the debounce: the marker lands.
  c2.disconnect();
  let marked: RoomMarkerRecord | null = null;
  for (let i = 0; i < 50; i++) {
    await wait(DEBOUNCE_MS);
    record = await markerRecord(host, p1b.roomId);
    if (record && Object.keys(record.lastNotified).length > 0) {
      marked = record;
      break;
    }
  }
  expect(marked?.lastNotified[p1b.playerId]).toBeDefined();
});
