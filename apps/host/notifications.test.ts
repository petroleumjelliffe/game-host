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
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { fakeEmailSender, fakePushSender } from '@game-host/notify/testChannels.js';
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

it('a bound actor gets a turn marker at the turn change, connected or not', async () => {
  // The channel split (2026-09-09) rewrote this test's premise: it used to
  // assert that a connected actor NEVER gets a marker, because the debounce
  // declined at fire time. Push is now immediate and presence-blind — the
  // marker lands the moment the turn changes — and presence only gates the
  // email leg, which packages/notify's own suite covers channel by channel.
  const host = await boot();
  const creator = await host.client(ACQUIRE);
  const joinedMsg = next<JoinedWithToken>(creator, 'joined');
  creator.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Cass' });
  const p1 = await joinedMsg;
  const guest = await host.client(ACQUIRE);
  await joinRoom(guest, p1.roomId, AQ_VERSION, 'Dev');

  expect((await bind(host, p1)).status).toBe(200);

  // Begin: the first commit reports p1 (first in seat order) as the actor —
  // still connected, and marked anyway. The save is fire-and-forget, so poll.
  const begun = next<{ reason: string }>(creator, 'state');
  creator.emit('beginGame');
  await begun;
  let marked: RoomMarkerRecord | null = null;
  for (let i = 0; i < 50 && marked === null; i++) {
    await wait(DEBOUNCE_MS);
    const record = await markerRecord(host, p1.roomId);
    if (record && Object.keys(record.lastNotified).length > 0) marked = record;
  }
  expect(marked?.lastNotified[p1.playerId]).toBeDefined();
});

describe('Acquire seats are reachable by the person, not just the device', () => {
  // Needs the channels on (fakes) and an origin to build links from, the way
  // a deploy runs. Scoped to this block so the marker tests above keep
  // proving the unconfigured, dev-boot path.
  let savedOrigin: string | undefined;
  beforeAll(() => {
    savedOrigin = process.env.NOTIFY_ORIGIN;
    process.env.NOTIFY_ORIGIN = 'https://games.test';
  });
  afterAll(() => {
    if (savedOrigin === undefined) delete process.env.NOTIFY_ORIGIN;
    else process.env.NOTIFY_ORIGIN = savedOrigin;
  });

  async function post(host: TestHost, path: string, body: unknown): Promise<Response> {
    return fetch(`${host.url}/notify${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function bootWithChannels() {
    const email = fakeEmailSender();
    const push = fakePushSender();
    const host = await startTestHost({ notifyChannels: { push, email } });
    hosts.push(host);
    dirs.push(host.dataDir);
    return { host, email, push };
  }

  /** A seat in a real Acquire lobby, bound to PLAYER_KEY, with a confirmed address. */
  async function signedInSeat(host: TestHost, email: ReturnType<typeof fakeEmailSender>) {
    const creator = await host.client(ACQUIRE);
    const joined = next<JoinedWithToken>(creator, 'joined');
    creator.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Cass' });
    const seat = await joined;
    expect((await bind(host, seat)).status).toBe(200);

    expect((await post(host, '/email', { playerKey: PLAYER_KEY, email: 'cass@example.com' })).status).toBe(200);
    const confirmation = email.sent.find((m) => m.kind === 'confirmation');
    const confirmToken = new URL(confirmation!.url).searchParams.get('token')!;
    const confirmed = await fetch(`${host.url}/notify/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: confirmToken }).toString(),
    });
    expect(confirmed.status).toBe(200);
    return { creator, seat };
  }

  it('mails an Acquire sign-in link that carries a key, and the key redeems to the seat', async () => {
    // Before 2026-09-29 Acquire registered no `getSeatCredentials`: this
    // request answered the same vague 200 and mailed nothing at all.
    const { host, email } = await bootWithChannels();
    const { seat } = await signedInSeat(host, email);

    expect((await post(host, '/seat-signin', { game: 'acquire', roomId: seat.roomId, playerId: seat.playerId })).status).toBe(200);
    let signin = email.sent.find((m) => m.kind === 'signin');
    for (let i = 0; i < 40 && signin === undefined; i++) {
      await wait(25);
      signin = email.sent.find((m) => m.kind === 'signin');
    }
    expect(signin?.to).toBe('cass@example.com');
    const url = new URL(signin!.url);
    expect(url.pathname).toBe(`${ACQUIRE}/room/${seat.roomId}`);
    const key = url.searchParams.get('key');
    expect(key).toBeTruthy();

    const redeemed = await post(host, '/redeem-key', { key });
    expect(redeemed.status).toBe(200);
    expect(await redeemed.json()).toMatchObject({ playerId: seat.playerId, token: seat.token, name: 'Cass' });

    // And the person's restore sees the seat, which is what an installed app
    // signing in reads.
    const me = (await (await post(host, '/me', { playerKey: PLAYER_KEY })).json()) as {
      seats: { game: string; roomId: string; playerId: string }[];
    };
    expect(me.seats).toContainEqual(expect.objectContaining({ game: 'acquire', roomId: seat.roomId, playerId: seat.playerId }));
  });

  it('pushes an Acquire turn to Acquire-scoped subscriptions only', async () => {
    const { host, push } = await bootWithChannels();
    const keys = { p256dh: 'p', auth: 'a' };
    await post(host, '/subscriptions', { playerKey: PLAYER_KEY, game: 'acquire', subscription: { endpoint: 'https://push.test/acquire', keys } });
    await post(host, '/subscriptions', { playerKey: PLAYER_KEY, game: 'wordgame', subscription: { endpoint: 'https://push.test/wordgame', keys } });

    const creator = await host.client(ACQUIRE);
    const joined = next<JoinedWithToken>(creator, 'joined');
    creator.emit('createRoom', { protocolVersion: AQ_VERSION, name: 'Cass' });
    const seat = await joined;
    const guest = await host.client(ACQUIRE);
    await joinRoom(guest, seat.roomId, AQ_VERSION, 'Dev');
    expect((await bind(host, seat)).status).toBe(200);

    // Begin: the opening draw waits on seat one, which is Cass.
    const begun = next<{ reason: string }>(creator, 'state');
    creator.emit('beginGame');
    await begun;
    for (let i = 0; i < 40 && push.sent.length === 0; i++) await wait(25);

    expect(push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/acquire']);
  });
});
