// packages/notify/person.test.ts
// The person layer (specs/2026-09-09-person-identity-and-app-signin.md):
// a person is every profile proven on one address, derived at query time.
// `me` restores that person's seats and invites; `acceptInvite` claims by
// the hash the server holds; every fan-out expands to the person; `signOut`
// cleans one device. The fixture is invites.test.ts's miniature game,
// copied rather than imported — that file exports nothing.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NotifyGameRegistration } from '@game-host/host/contract.js';
import { createNotifyService, NUDGE_MIN_AGE_MS, type NotifyService } from './service.js';
import {
  fakeEmailSender,
  fakePushSender,
  sub,
  type FakeEmailSender,
  type FakePushSender,
} from './testChannels.js';

const SAFARI = 'safari-key-0123456789abcdef';
const APP = 'app-key-0123456789abcdefghi';
const OTHER = 'other-key-0123456789abcdef';

interface FakeGame {
  registration: NotifyGameRegistration;
  addRoom(roomId: string): void;
  seat(roomId: string, playerId: string): { playerId: string; token: string };
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

async function makeFixture(log?: (line: string) => void): Promise<Fixture> {
  const dataDir = await mkdtemp(join(tmpdir(), 'notify-person-'));
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
    log: log ?? (() => {}),
  });
  const reporter = service.registerGame(game.registration);
  const fixture = { dir: dataDir, service, push, email, game, reporter, clock };
  cleanups.push(async () => {
    await service.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return fixture;
}

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drain(): Promise<void> {
  return wait(5);
}

/**
 * Seat a player, bind them at play phase with a name, subscribe push.
 * Returns the seat: the fake game appends a second entry if `seat()` is
 * called twice for one player id, so callers take the token from here.
 */
function seatAndBind(
  f: Fixture,
  key: string,
  roomId: string,
  playerId: string,
  name: string,
): { playerId: string; token: string } {
  const seat = f.game.seat(roomId, playerId);
  const bound = f.service.bindSeat(key, 'testgame', roomId, playerId, seat.token, {
    name,
    phase: 'playing',
  });
  expect(bound.ok).toBe(true);
  f.service.addSubscription(key, sub(`https://push.test/${key}`));
  return seat;
}

/** Confirm `address` on `key`'s profile through the real flow. */
async function confirm(f: Fixture, key: string, address: string): Promise<void> {
  expect(await f.service.submitEmail(key, address)).toBe('confirmationSent');
  const mail = [...f.email.sent].reverse().find((m) => m.kind === 'confirmation' && m.to === address)!;
  const token = new URL(mail.url).searchParams.get('token')!;
  expect(f.service.confirmEmail(token)).toBe('confirmed');
}

describe('me: the person derived from a confirmed address', () => {
  test('a lone profile with no address is its own person: its bindings, null address', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    const mine = f.service.me(SAFARI);
    expect(mine.address).toBeNull();
    expect(mine.seats).toEqual([
      { game: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: 'token-p1-ROOM1', name: 'Seat p1' },
    ]);
    expect(mine.invites).toEqual([]);
  });

  test('two profiles confirmed on one address, in differing case, are one person', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'Pete@Example.com');
    await confirm(f, APP, 'pete@example.com');
    // The app profile holds no bindings of its own and still sees the seat.
    const mine = f.service.me(APP);
    expect(mine.address).toBe('pete@example.com');
    expect(mine.seats.map((s) => s.roomId)).toEqual(['ROOM1']);
  });

  test('a pending address links nothing', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    expect(await f.service.submitEmail(APP, 'pete@example.com')).toBe('confirmationSent');
    expect(f.service.me(APP).seats).toEqual([]);
  });

  test('an unsubscribed address still links: "stop mailing me" is not "sign me out"', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    // The unsubscribe token rides every turn mail; drive one turn to get it.
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    const turn = f.email.sent.find((m) => m.kind === 'turn')!;
    const token = new URL(turn.unsubscribeUrl!).searchParams.get('token')!;
    expect(f.service.unsubscribeEmail(token)).toBe(true);
    expect(f.service.settings(SAFARI).email?.status).toBe('disabled');
    expect(f.service.me(APP).seats.map((s) => s.roomId)).toEqual(['ROOM1']);
  });

  test('a vacated seat falls out', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    f.reporter.seatVacated?.('ROOM1', 'p1');
    expect(f.service.me(SAFARI).seats).toEqual([]);
  });

  test('invites addressed to a profile of the person, or to the address, are listed; revoked ones are not', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    const host1 = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    const host2 = seatAndBind(f, OTHER, 'ROOM2', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host1.token,
      email: 'Pete@example.com',
    });
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM2', playerId: 'p1', token: host2.token,
      email: 'pete@example.com',
    });
    await drain();
    f.reporter.seatVacated?.('ROOM2', 'p2');
    const mine = f.service.me(APP);
    expect(mine.invites).toEqual([
      { game: 'testgame', roomId: 'ROOM1', playerId: 'p2', inviterName: 'Alice', gameTitle: 'Test Game' },
    ]);
  });

  test('the payload never reaches the log', async () => {
    const lines: string[] = [];
    const f = await makeFixture((line) => lines.push(line));
    f.game.addRoom('ROOM1');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    const mine = f.service.me(SAFARI);
    expect(mine.seats.length).toBeGreaterThan(0);
    for (const seat of mine.seats) {
      expect(lines.some((l) => l.includes(seat.token))).toBe(false);
    }
  });
});

describe('acceptInvite: claim by the hash the server holds', () => {
  async function invitedRoom(f: Fixture): Promise<void> {
    f.game.addRoom('ROOM1');
    const host = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host.token,
      email: 'pete@example.com',
    });
    await drain();
  }

  test('claims the pending seat, binds the asking profile, and answers credentials', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    const creds = f.service.acceptInvite(APP, 'testgame', 'ROOM1');
    expect(creds).toMatchObject({ playerId: 'p2', inviterName: 'Alice' });
    expect(f.game.pendingIn('ROOM1')).toEqual([]);
    // Bound: restore now lists it as a seat, and the invite is gone.
    const mine = f.service.me(APP);
    expect(mine.seats.map((s) => s.playerId)).toEqual(['p2']);
    expect(mine.invites).toEqual([]);
  });

  test('a second accept, and an accept by someone it was not for, are one shaped null', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    expect(f.service.acceptInvite(SAFARI, 'testgame', 'ROOM1')).toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).not.toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).toBeNull();
  });

  test('an invite claimed by link in Safari first refuses the app, whose restore then shows the seat', async () => {
    const f = await makeFixture();
    await invitedRoom(f);
    const mail = f.email.sent.find((m) => m.kind === 'invite')!;
    const token = mail.url.split('invite=')[1]!;
    expect(f.service.claimInvite(token, SAFARI)).not.toBeNull();
    expect(f.service.acceptInvite(APP, 'testgame', 'ROOM1')).toBeNull();
    // Safari's claim confirmed the address on its profile, so the app is linked.
    expect(f.service.me(APP).seats.map((s) => s.playerId)).toEqual(['p2']);
  });
});

describe('fan-out reaches the person, not only the bound profile', () => {
  test('a nudge: the push lands on the linked app profile, the mail once at the address', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = f.game.seat('ROOM1', 'p2');
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    f.email.sent.length = 0;
    f.push.sent.length = 0;
    f.clock.now += NUDGE_MIN_AGE_MS;
    expect(f.service.nudge({ gameId: 'testgame', roomId: 'ROOM1', playerId: 'p2', token: host.token })).toEqual({ ok: true });
    await wait(30);
    expect(f.push.sent.map((p) => p.endpoint).sort()).toEqual([
      'https://push.test/app',
      `https://push.test/${SAFARI}`,
    ]);
    expect(f.email.sent.filter((m) => m.kind === 'reminder').map((m) => m.to)).toEqual(['pete@example.com']);
  });

  test('a turn: one push to the linked app profile, one email to the address — never two mails', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    // Safari holds the seat and the address; the app is linked and holds push.
    seatAndBind(f, SAFARI, 'ROOM1', 'p1', 'Pete');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    f.email.sent.length = 0;
    f.push.sent.length = 0;
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    expect(f.push.sent.map((p) => p.endpoint).sort()).toEqual([
      'https://push.test/app',
      `https://push.test/${SAFARI}`,
    ]);
    expect(f.email.sent.filter((m) => m.kind === 'turn')).toHaveLength(1);
  });

  test('an invite to a contact holding only the Safari profile pushes to the app profile', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    // A shared game makes Pete a contact of Alice's, via the Safari profile.
    seatAndBind(f, SAFARI, 'ROOM1', 'p2', 'Pete');
    seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, SAFARI, 'pete@example.com');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    const contact = f.service.contacts(OTHER).find((c) => c.name === 'Pete')!;
    const host = seatAndBind(f, OTHER, 'ROOM2', 'p1', 'Alice');
    f.push.sent.length = 0;
    const result = await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM2', playerId: 'p1', token: host.token,
      contactId: contact.contactId,
    });
    expect(result).toMatchObject({ ok: true });
    await drain();
    expect(f.push.sent.map((p) => p.endpoint).sort()).toEqual([
      'https://push.test/app',
      `https://push.test/${SAFARI}`,
    ]);
    expect(f.push.sent[0]?.payload).toMatchObject({ kind: 'invite', roomId: 'ROOM2' });
  });

  test('an invite by email to a proven address also pushes to its profiles', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    const host = seatAndBind(f, OTHER, 'ROOM1', 'p1', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    f.service.addSubscription(APP, sub('https://push.test/app', 'testgame'));
    f.push.sent.length = 0;
    await f.service.invite({
      playerKey: OTHER, gameId: 'testgame', roomId: 'ROOM1', playerId: 'p1', token: host.token,
      email: 'pete@example.com',
    });
    await drain();
    expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/app']);
    expect(f.email.sent.filter((m) => m.kind === 'invite')).toHaveLength(1);
  });
});

describe('signOut', () => {
  test('drops the address and every binding, keeps push and prefs; a second call is a no-op', async () => {
    const f = await makeFixture();
    f.game.addRoom('ROOM1');
    f.game.addRoom('ROOM2');
    seatAndBind(f, APP, 'ROOM1', 'p1', 'Pete');
    seatAndBind(f, APP, 'ROOM2', 'p1', 'Pete');
    seatAndBind(f, OTHER, 'ROOM1', 'p2', 'Alice');
    await confirm(f, APP, 'pete@example.com');
    f.service.setPrefs(APP, { email: false });

    f.service.signOut(APP);
    const settings = f.service.settings(APP);
    expect(settings.email).toBeNull();
    expect(settings.prefs).toEqual({ push: true, email: false });
    expect(settings.pushEndpoints).toEqual([`https://push.test/${APP}`]);
    expect(f.service.me(APP).seats).toEqual([]);
    // The other person's binding on the same room is untouched.
    expect(f.service.me(OTHER).seats.map((s) => s.playerId)).toEqual(['p2']);
    // No turn reaches the signed-out device.
    f.push.sent.length = 0;
    f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
    await wait(30);
    expect(f.push.sent).toEqual([]);

    expect(() => f.service.signOut(APP)).not.toThrow();
    expect(() => f.service.signOut('never-seen-key-0123456789')).not.toThrow();
  });
});
