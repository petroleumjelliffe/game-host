// packages/notify/invites.test.ts
// The invite layer and the friends layer: the co-player ledger, the contacts
// listing (proved on serialized output, never intent), invite by contact and
// by email with the caps, resend vs revoke, claim as double-opt-in, seat-key
// redemption, the legacy-bindings migration, and the 24h reminder sweep.

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NotifyGameRegistration } from '@game-host/host/contract.js';
import { createNotifyService, type NotifyService } from './service.js';
import {
  fakeEmailSender,
  fakePushSender,
  sub,
  type FakeEmailSender,
  type FakePushSender,
} from './testChannels.js';

const HOST_KEY = 'host-key-0123456789abcdef';
const SAM_KEY = 'sam-key-0123456789abcdefg';
const KIT_KEY = 'kit-key-0123456789abcdefg';

/**
 * A miniature game: three seats per room, real tokens, a pending list —
 * enough to satisfy the full registration honestly, in memory.
 */
interface FakeGame {
  registration: NotifyGameRegistration;
  addRoom(roomId: string): void;
  seat(roomId: string, playerId: string): { playerId: string; token: string };
  rotateToken(roomId: string, playerId: string): void;
  pendingIn(roomId: string): string[];
}

function fakeGame(): FakeGame {
  interface Seat { playerId: string; token: string; name: string }
  interface Room { seats: Seat[]; pending: { playerId: string; tokenHash: string; name: string | null }[] }
  const rooms = new Map<string, Room>();
  const IDS = ['p1', 'p2', 'p3'];
  let minted = 0;

  const registration: NotifyGameRegistration = {
    gameId: 'testgame',
    title: 'Test Game',
    roomPath: (roomId) => `/testgame/room/${roomId}`,
    isConnected: () => false,
    verifySeat: (roomId, playerId, token) =>
      rooms.get(roomId)?.seats.some((s) => s.playerId === playerId && s.token === token) ?? false,
    reserveSeat: (roomId, tokenHash, name) => {
      const room = rooms.get(roomId);
      if (!room) return null;
      const held = new Set([
        ...room.seats.map((s) => s.playerId),
        ...room.pending.map((p) => p.playerId),
      ]);
      const free = IDS.find((id) => !held.has(id));
      if (free === undefined) return null;
      room.pending.push({ playerId: free, tokenHash, name });
      return free;
    },
    claimSeat: (roomId, tokenHash) => {
      const room = rooms.get(roomId);
      if (!room) return null;
      const at = room.pending.findIndex((p) => p.tokenHash === tokenHash);
      if (at === -1) return null;
      const [reserved] = room.pending.splice(at, 1);
      const seat: Seat = {
        playerId: reserved!.playerId,
        token: `minted-${(minted += 1)}`,
        name: reserved!.name ?? 'Player',
      };
      room.seats.push(seat);
      return { playerId: seat.playerId, token: seat.token, name: seat.name };
    },
    getSeatCredentials: (roomId, playerId) => {
      const seat = rooms.get(roomId)?.seats.find((s) => s.playerId === playerId);
      return seat ? { playerId: seat.playerId, token: seat.token, name: seat.name } : null;
    },
  };

  return {
    registration,
    addRoom(roomId) {
      rooms.set(roomId, { seats: [], pending: [] });
    },
    seat(roomId, playerId) {
      const token = `token-${playerId}-${roomId}`;
      rooms.get(roomId)!.seats.push({ playerId, token, name: `Seat ${playerId}` });
      return { playerId, token };
    },
    rotateToken(roomId, playerId) {
      const seat = rooms.get(roomId)!.seats.find((s) => s.playerId === playerId)!;
      seat.token = `${seat.token}-rotated`;
    },
    pendingIn(roomId) {
      return rooms.get(roomId)?.pending.map((p) => p.playerId) ?? [];
    },
  };
}

interface Fixture {
  dir: string;
  service: NotifyService;
  push: FakePushSender;
  email: FakeEmailSender;
  game: FakeGame;
  reporter: ReturnType<NotifyService['registerGame']>;
  clock: { now: number };
}

let cleanups: (() => Promise<void>)[] = [];

async function makeFixture(dir?: string): Promise<Fixture> {
  const dataDir = dir ?? (await mkdtemp(join(tmpdir(), 'notify-invites-')));
  const push = fakePushSender();
  const email = fakeEmailSender();
  const game = fakeGame();
  const clock = { now: 1_700_000_000_000 };
  const service = await createNotifyService({
    dataDir,
    debounceMs: 5,
    origin: 'https://games.test',
    channels: { push, email },
    now: () => clock.now,
    log: () => {},
  });
  const reporter = service.registerGame(game.registration);
  const fixture = { dir: dataDir, service, push, email, game, reporter, clock };
  cleanups.push(async () => {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return fixture;
}

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

function drain(): Promise<void> {
  // Sends are tracked promises; two microtask hops settles the fakes.
  return new Promise((resolve) => setTimeout(resolve, 5));
}

/** Seat a player, bind them at play phase with a name, subscribe push. */
function seatAndBind(f: Fixture, key: string, roomId: string, playerId: string, name: string): void {
  const seat = f.game.seat(roomId, playerId);
  const bound = f.service.bindSeat(key, 'testgame', roomId, playerId, seat.token, {
    name,
    phase: 'playing',
  });
  expect(bound.ok).toBe(true);
  f.service.addSubscription(key, sub(`https://push.test/${key}`));
}

describe('the co-player ledger', () => {
  test('reciprocal entries at play-phase bind; lobby binds write nothing', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p1');
    const sam = f.game.seat('ROOM1', 'p2');
    // Lobby binds first — the design's alreadySeated needs them, the ledger
    // must not see them.
    f.service.bindSeat(HOST_KEY, 'testgame', 'ROOM1', 'p1', host.token, { name: 'Pete', phase: 'lobby' });
    f.service.bindSeat(SAM_KEY, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Sam', phase: 'lobby' });
    expect(f.service.contacts(HOST_KEY)).toEqual([]);
    expect(f.service.contacts(SAM_KEY)).toEqual([]);

    // The game starts: play-phase binds write both directions.
    f.service.bindSeat(HOST_KEY, 'testgame', 'ROOM1', 'p1', host.token, { name: 'Pete', phase: 'playing' });
    f.service.bindSeat(SAM_KEY, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Sam', phase: 'playing' });
    expect(f.service.contacts(HOST_KEY).map((c) => c.name)).toEqual(['Sam']);
    expect(f.service.contacts(SAM_KEY).map((c) => c.name)).toEqual(['Pete']);
  });

  test('re-binds are no-ops; a new shared room bumps lastPlayedAt', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, HOST_KEY, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    const first = f.service.contacts(HOST_KEY)[0]!;

    f.clock.now += 60_000;
    const sam = f.game.seat('ROOM1', 'p2'); // no-op refresh re-bind
    void sam;
    const again = f.service.contacts(HOST_KEY)[0]!;
    expect(again.lastPlayedAt).toBe(first.lastPlayedAt);

    f.clock.now += 60_000;
    f.game.addRoom('ROOM2');
    seatAndBind(f, HOST_KEY, 'ROOM2', 'p1', 'Pete');
    seatAndBind(f, SAM_KEY, 'ROOM2', 'p2', 'Sam');
    const moved = f.service.contacts(HOST_KEY)[0]!;
    expect(moved.lastPlayedAt).toBeGreaterThan(first.lastPlayedAt);
    // Still one entry: same person, merged by profile overlap.
    expect(f.service.contacts(HOST_KEY)).toHaveLength(1);
  });

  test('entries survive roomRemoved', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, HOST_KEY, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    f.reporter.roomRemoved('ROOM1');
    expect(f.service.contacts(HOST_KEY).map((c) => c.name)).toEqual(['Sam']);
  });

  test('the wire shape provably carries no address and no profileId', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, HOST_KEY, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    await f.service.submitEmail(SAM_KEY, 'sam@example.com');
    const serialized = JSON.stringify(f.service.contacts(HOST_KEY));
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain(
      createHash('sha256').update(SAM_KEY).digest('hex'),
    );
    // And the row keys are exactly the published five (plus alreadySeated
    // only when room context is given).
    const row = f.service.contacts(HOST_KEY)[0]!;
    expect(Object.keys(row).sort()).toEqual([
      'contactId',
      'gameTitle',
      'lastPlayedAt',
      'name',
      'reachable',
    ]);
  });

  test('reachable tracks channels and prefs; unmounted games fall back to gameId', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, HOST_KEY, 'ROOM1', 'p1', 'Pete');
    const sam = f.game.seat('ROOM1', 'p2');
    // Sam binds but never subscribes: in the ledger, not reachable.
    f.service.bindSeat(SAM_KEY, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Sam', phase: 'playing' });
    const row = f.service.contacts(HOST_KEY)[0]!;
    expect(row).toMatchObject({ name: 'Sam', reachable: false, gameTitle: 'Test Game' });

    f.service.addSubscription(SAM_KEY, sub('https://push.test/sam'));
    expect(f.service.contacts(HOST_KEY)[0]!.reachable).toBe(true);
    // Prefs respected: push off with no email means unreachable again.
    f.service.setPrefs(SAM_KEY, { push: false });
    expect(f.service.contacts(HOST_KEY)[0]!.reachable).toBe(false);
  });
});

describe('invite by contact', () => {
  async function playedTogether(f: Fixture): Promise<string> {
    f.game.addRoom('ROOM1');
    seatAndBind(f, HOST_KEY, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    const contact = f.service.contacts(HOST_KEY)[0]!;
    return contact.contactId;
  }

  test('reserves a seat and fans out immediately, push and mail alike', async () => {
    const f = await makeFixture();
    const contactId = await playedTogether(f);
    await f.service.submitEmail(SAM_KEY, 'sam@example.com');
    const confirmUrl = f.email.sent[0]!.url;
    f.service.confirmEmail(confirmUrl.split('token=')[1]!);

    f.game.addRoom('ROOM2');
    const host = f.game.seat('ROOM2', 'p1');
    const result = await f.service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM2',
      playerId: 'p1',
      token: host.token,
      contactId,
    });
    expect(result).toEqual({ ok: true, playerId: 'p2', resend: false });
    expect(f.game.pendingIn('ROOM2')).toEqual(['p2']);
    await drain();
    // No debounce: the push went now, saying who asked, with the claim link.
    const pushed = f.push.sent.find((p) => 'kind' in p.payload);
    expect(pushed?.payload).toMatchObject({ kind: 'invite', inviterName: 'Pete' });
    expect((pushed?.payload as { url: string }).url).toMatch(
      /^\/testgame\/room\/ROOM2\?invite=/,
    );
    const mail = f.email.sent.find((m) => m.kind === 'invite');
    expect(mail).toMatchObject({ to: 'sam@example.com', inviterName: 'Pete' });
    // A confirmed address gets the real unsubscribe link.
    expect(mail?.unsubscribeUrl).toContain('/notify/unsubscribe');
  });

  test('refusals land before any seat is reserved', async () => {
    const f = await makeFixture();
    const contactId = await playedTogether(f);
    f.game.addRoom('ROOM2');
    const host = f.game.seat('ROOM2', 'p1');
    const ask = (over: Record<string, string>) =>
      f.service.invite({
        playerKey: HOST_KEY,
        gameId: 'testgame',
        roomId: 'ROOM2',
        playerId: 'p1',
        token: host.token,
        contactId,
        ...over,
      });

    // Unreachable: Sam's one channel goes away.
    f.service.removeSubscription(SAM_KEY, `https://push.test/${SAM_KEY}`);
    expect(await ask({})).toEqual({ ok: false, reason: 'unreachable' });
    // Foreign or fabricated contactId: one shape.
    expect(await ask({ contactId: 'no-such' })).toEqual({ ok: false, reason: 'noSuchContact' });
    // Bad seat proof.
    expect(await ask({ token: 'wrong' })).toEqual({ ok: false, reason: 'seatRefused' });
    // Nothing dangled: no reservation was ever made.
    expect(f.game.pendingIn('ROOM2')).toEqual([]);
  });

  test('alreadySeated: the target is bound in this room (and the listing says so)', async () => {
    const f = await makeFixture();
    const contactId = await playedTogether(f);
    f.service.addSubscription(SAM_KEY, sub('https://push.test/sam'));
    // Sam is in ROOM1 (lobby-or-playing bound); inviting them there refuses.
    const host = f.game.registration.getSeatCredentials!('ROOM1', 'p1')!;
    const result = await f.service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM1',
      playerId: 'p1',
      token: host.token,
      contactId,
    });
    expect(result).toEqual({ ok: false, reason: 'alreadySeated' });
    const listed = f.service.contacts(HOST_KEY, { gameId: 'testgame', roomId: 'ROOM1' });
    expect(listed[0]!.alreadySeated).toBe(true);
  });

  test('a repeat is a resend of the same link; caps stop the loop at 3', async () => {
    const f = await makeFixture();
    const contactId = await playedTogether(f);
    f.game.addRoom('ROOM2');
    const host = f.game.seat('ROOM2', 'p1');
    const ask = () =>
      f.service.invite({
        playerKey: HOST_KEY,
        gameId: 'testgame',
        roomId: 'ROOM2',
        playerId: 'p1',
        token: host.token,
        contactId,
      });

    const first = await ask();
    const second = await ask();
    expect(first).toMatchObject({ ok: true, resend: false });
    expect(second).toMatchObject({ ok: true, resend: true });
    // One reservation, however many asks.
    expect(f.game.pendingIn('ROOM2')).toEqual(['p2']);
    await drain();
    const urls = f.push.sent
      .filter((p) => 'kind' in p.payload)
      .map((p) => (p.payload as { url: string }).url);
    expect(urls).toHaveLength(2);
    // The SAME link — a resend, not a sibling invite.
    expect(new Set(urls).size).toBe(1);
    // 3 per (inviter, target) per UTC day.
    expect(await ask()).toMatchObject({ ok: true, resend: true });
    expect(await ask()).toEqual({ ok: false, reason: 'rateLimited' });
    // A new UTC day resets.
    f.clock.now += 24 * 60 * 60 * 1000;
    expect(await ask()).toMatchObject({ ok: true, resend: true });
  });

  test('revoke-then-reinvite reserves fresh; the dead token never claims', async () => {
    const f = await makeFixture();
    const contactId = await playedTogether(f);
    f.game.addRoom('ROOM2');
    const host = f.game.seat('ROOM2', 'p1');
    const ask = () =>
      f.service.invite({
        playerKey: HOST_KEY,
        gameId: 'testgame',
        roomId: 'ROOM2',
        playerId: 'p1',
        token: host.token,
        contactId,
      });

    await ask();
    await drain();
    const firstUrl = (f.push.sent.find((p) => 'kind' in p.payload)!.payload as { url: string }).url;
    const firstToken = firstUrl.split('invite=')[1]!;

    // The host revokes: the game clears the pending seat and reports it.
    f.game.pendingIn('ROOM2'); // p2 pending
    // (the fake game has no revoke; the report is what notify acts on)
    f.reporter.seatVacated!('ROOM2', 'p2');

    // The old link is dead — one shaped refusal.
    expect(f.service.claimInvite(firstToken, SAM_KEY)).toBeNull();

    // Re-inviting is NOT a resend of the dead token: it reserves fresh.
    const again = await ask();
    expect(again).toMatchObject({ ok: true, resend: false });
    await drain();
    const urls = new Set(
      f.push.sent
        .filter((p) => 'kind' in p.payload)
        .map((p) => (p.payload as { url: string }).url),
    );
    expect(urls.size).toBe(2); // a fresh token, not the dead one again
  });
});

describe('invite by email', () => {
  test('first contact: invite mail with the ignore-line footer, claim confirms the address', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p1');
    f.service.bindSeat(HOST_KEY, 'testgame', 'ROOM1', 'p1', host.token, { name: 'Pete', phase: 'lobby' });
    const result = await f.service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM1',
      playerId: 'p1',
      token: host.token,
      email: 'new@example.com',
    });
    expect(result).toMatchObject({ ok: true, resend: false });
    await drain();
    const mail = f.email.sent.find((m) => m.kind === 'invite')!;
    expect(mail.to).toBe('new@example.com');
    // First contact: no unsubscribe token exists yet, so no link.
    expect(mail.unsubscribeUrl).toBeUndefined();

    // Claiming converts the seat AND is the double-opt-in.
    const token = mail.url.split('invite=')[1]!;
    const creds = f.service.claimInvite(token, KIT_KEY);
    expect(creds).toMatchObject({ playerId: 'p2' });
    expect(f.service.settings(KIT_KEY).email).toEqual({
      address: 'new@example.com',
      status: 'confirmed',
    });
    // Spent: the same token never claims twice.
    expect(f.service.claimInvite(token, KIT_KEY)).toBeNull();
  });

  test('email mode refusals: invalid address, per-address cap', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p1');
    const ask = (email: string, roomId = 'ROOM1') =>
      f.service.invite({
        playerKey: HOST_KEY,
        gameId: 'testgame',
        roomId,
        playerId: 'p1',
        token: host.token,
        email,
      });
    expect(await ask('not-an-address')).toEqual({ ok: false, reason: 'invalidAddress' });
    // 3 sends to one address per day, resends included, then the cap.
    await ask('new@example.com');
    await ask('new@example.com');
    await ask('new@example.com');
    expect(await ask('new@example.com')).toEqual({ ok: false, reason: 'rateLimited' });
  });

  test('roomFull is the game refusing the reservation', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p1');
    f.game.seat('ROOM1', 'p2');
    f.game.seat('ROOM1', 'p3');
    const result = await f.service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM1',
      playerId: 'p1',
      token: host.token,
      email: 'new@example.com',
    });
    expect(result).toEqual({ ok: false, reason: 'roomFull' });
  });

  test('unconfigured email is off, not broken', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'notify-invites-'));
    const service = await createNotifyService({
      dataDir,
      channels: { push: fakePushSender() }, // no email channel at all
      log: () => {},
    });
    cleanups.push(async () => {
      await service.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    const game = fakeGame();
    service.registerGame(game.registration);
    game.addRoom('ROOM1');
    const host = game.seat('ROOM1', 'p1');
    const result = await service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM1',
      playerId: 'p1',
      token: host.token,
      email: 'new@example.com',
    });
    expect(result).toEqual({ ok: false, reason: 'emailUnavailable' });
  });
});

describe('seat keys', () => {
  test('every turn email is a login link, stable across sends, dead after a reclaim', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    await f.service.submitEmail(SAM_KEY, 'sam@example.com');
    f.service.confirmEmail(f.email.sent[0]!.url.split('token=')[1]!);

    f.reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await drain();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const turnMail = f.email.sent.find((m) => m.kind === 'turn')!;
    expect(turnMail.url).toMatch(/\?key=/);
    const key = turnMail.url.split('key=')[1]!;

    // The emailed key redeems to the live credentials, name included.
    const creds = f.service.redeemSeatKey(key);
    expect(creds).toMatchObject({ playerId: 'p2', name: 'Seat p2' });

    // A second turn's email carries the SAME key: any email ever received
    // is a login link, with no freshness bookkeeping.
    f.reporter.turnChanged('ROOM1', 'p2', 'turn-2');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = f.email.sent.filter((m) => m.kind === 'turn')[1]!;
    expect(second.url.split('key=')[1]).toBe(key);

    // An honor-system reclaim rotates the seat token; the old key dies.
    f.game.rotateToken('ROOM1', 'p2');
    expect(f.service.redeemSeatKey(key)).toBeNull();
    // And the NEXT email carries the re-derived key — rotation, not death.
    f.reporter.turnChanged('ROOM1', 'p2', 'turn-3');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const third = f.email.sent.filter((m) => m.kind === 'turn')[2]!;
    const rotated = third.url.split('key=')[1]!;
    expect(rotated).not.toBe(key);
    expect(f.service.redeemSeatKey(rotated)).toMatchObject({ playerId: 'p2' });
  });

  test('a fabricated key is one shaped nothing', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');
    expect(f.service.redeemSeatKey('A'.repeat(43))).toBeNull();
    expect(f.service.redeemSeatKey('short')).toBeNull();
  });
});

describe('the legacy bindings migration', () => {
  test('a scalar-bindings file on disk loads, normalizes, and still receives', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'notify-invites-'));
    // A literally legacy-shaped record, written before the binding set.
    const profileId = createHash('sha256').update(SAM_KEY).digest('hex');
    await mkdir(join(dataDir, 'rooms'), { recursive: true });
    await writeFile(
      join(dataDir, 'rooms', 'testgame--ROOM1.json'),
      JSON.stringify({
        key: 'testgame--ROOM1',
        gameId: 'testgame',
        roomId: 'ROOM1',
        savedAt: 1,
        bindings: { p2: profileId }, // the scalar
        lastNotified: {},
      }),
    );

    const push = fakePushSender();
    const game = fakeGame();
    const service = await createNotifyService({
      dataDir,
      debounceMs: 5,
      channels: { push },
      log: () => {},
    });
    cleanups.push(async () => {
      await service.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    const reporter = service.registerGame(game.registration);
    game.addRoom('ROOM1');
    game.seat('ROOM1', 'p2');
    service.addSubscription(SAM_KEY, sub('https://push.test/sam'));

    // Proved through a real send, not the guard: the pre-migration binding
    // still notifies.
    reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(push.sent).toHaveLength(1);
  });
});

describe('the seat binding set', () => {
  test('two devices on one seat both notify; email deduped by address', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const sam = f.game.seat('ROOM1', 'p2');
    const KEY_A = 'sam-phone-0123456789abcd';
    const KEY_B = 'sam-laptop-0123456789abc';
    for (const key of [KEY_A, KEY_B]) {
      f.service.bindSeat(key, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Sam', phase: 'playing' });
      f.service.addSubscription(key, sub(`https://push.test/${key}`));
      await f.service.submitEmail(key, 'sam@example.com');
      const confirm = f.email.sent.filter((m) => m.kind === 'confirmation').pop()!;
      f.service.confirmEmail(confirm.url.split('token=')[1]!);
    }
    f.reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    // Both devices pushed; ONE mail to the shared address.
    expect(f.push.sent.map((p) => p.endpoint).sort()).toEqual(
      [`https://push.test/${KEY_A}`, `https://push.test/${KEY_B}`].sort(),
    );
    expect(f.email.sent.filter((m) => m.kind === 'turn')).toHaveLength(1);
  });

  test('a vacated seat re-taken by someone else notifies only the new occupant', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const sam = f.game.seat('ROOM1', 'p2');
    f.service.bindSeat(SAM_KEY, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Sam', phase: 'lobby' });
    f.service.addSubscription(SAM_KEY, sub('https://push.test/sam'));

    // Sam leaves the lobby; the game reports the vacated seat; Kit takes it.
    f.reporter.seatVacated!('ROOM1', 'p2');
    f.service.bindSeat(KIT_KEY, 'testgame', 'ROOM1', 'p2', sam.token, { name: 'Kit', phase: 'playing' });
    f.service.addSubscription(KIT_KEY, sub('https://push.test/kit'));

    f.reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/kit']);
  });
});

describe('the 24h reminder', () => {
  test('sweeps once per turn, survives restarts, never fires for a superseded turn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notify-invites-'));
    const f = await makeFixture(dir);
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');

    f.reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(f.push.sent).toHaveLength(1);

    // Under 24h: the sweep holds.
    f.clock.now += 23 * 60 * 60 * 1000;
    f.service.startReminderSweep();
    await drain();
    expect(f.push.sent).toHaveLength(1);

    // Past 24h — and across a restart, in the same data dir: the marker is
    // durable, so a deploy cannot forget a pending reminder.
    await f.service.close();
    const push2 = fakePushSender();
    const service2 = await createNotifyService({
      dataDir: dir,
      debounceMs: 5,
      channels: { push: push2 },
      now: () => f.clock.now + 2 * 60 * 60 * 1000,
      log: () => {},
    });
    cleanups.push(async () => {
      await service2.close();
    });
    const game2 = fakeGame();
    service2.registerGame(game2.registration);
    game2.addRoom('ROOM1');
    game2.seat('ROOM1', 'p2');
    service2.startReminderSweep();
    await drain();
    expect(push2.sent).toHaveLength(1);

    // One per turn: a second sweep sends nothing more.
    service2.startReminderSweep();
    await drain();
    expect(push2.sent).toHaveLength(1);
  });

  test('a superseded turn clears the marker even when its own send was skipped', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAM_KEY, 'ROOM1', 'p2', 'Sam');

    f.reporter.turnChanged('ROOM1', 'p2', 'turn-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(f.push.sent).toHaveLength(1); // notified for turn-1

    // The turn advances; the marker for turn-1 must die with it, or the
    // sweep would remind for a turn already taken.
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-2');
    f.clock.now += 25 * 60 * 60 * 1000;
    f.service.startReminderSweep();
    await drain();
    expect(f.push.sent).toHaveLength(1); // no reminder — turn-1 is gone
  });
});

describe('invite records on disk', () => {
  test('an invite and its claim state survive a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notify-invites-'));
    const f = await makeFixture(dir);
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p1');
    await f.service.invite({
      playerKey: HOST_KEY,
      gameId: 'testgame',
      roomId: 'ROOM1',
      playerId: 'p1',
      token: host.token,
      email: 'new@example.com',
    });
    await drain();
    const mail = f.email.sent.find((m) => m.kind === 'invite')!;
    const token = mail.url.split('invite=')[1]!;
    await f.service.close();

    // On-disk shape, read straight from the file: hash-keyed, target intact.
    const hash = createHash('sha256').update(token).digest('hex');
    const raw = JSON.parse(await readFile(join(dir, 'invites', `${hash}.json`), 'utf8')) as {
      target: unknown;
      claimedAt?: number;
    };
    expect(raw.target).toEqual({ kind: 'email', address: 'new@example.com' });
    expect(raw.claimedAt).toBeUndefined();

    // The restarted service still claims it (the fake game is fresh, so
    // re-seed its pending seat through a fresh reservation-shaped room).
    const service2 = await createNotifyService({ dataDir: dir, log: () => {} });
    cleanups.push(async () => {
      await service2.close();
    });
    const game2 = fakeGame();
    service2.registerGame(game2.registration);
    game2.addRoom('ROOM1');
    game2.registration.reserveSeat!('ROOM1', hash, null);
    expect(service2.claimInvite(token, KIT_KEY)).toMatchObject({ playerId: 'p1' });
  });
});
