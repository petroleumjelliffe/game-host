// packages/notify/service.test.ts
// The trigger semantics: debounce, presence re-check at fire time,
// once-per-turn per channel, restart without duplicates, pruning.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NotifyGameRegistration } from '@game-host/host/contract.js';
import { createNotifyService, type NotifyService } from './service.js';
import { fakeEmailSender, fakePushSender, sub, type FakeEmailSender, type FakePushSender } from './testChannels.js';

const KEY = 'player-key-0123456789abcdef';
const DEBOUNCE = 25;

/** Real timers, tiny window: the debounce contract is about ordering, not 60s. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Fixture {
  dir: string;
  service: NotifyService;
  push: FakePushSender;
  email: FakeEmailSender;
  connected: Set<string>; // "roomId/playerId" entries that count as online
  reporter: ReturnType<NotifyService['registerGame']>;
}

let fixtures: Fixture[] = [];

async function makeFixture(dir?: string): Promise<Fixture> {
  const dataDir = dir ?? (await mkdtemp(join(tmpdir(), 'notify-')));
  const push = fakePushSender();
  const email = fakeEmailSender();
  const connected = new Set<string>();
  const service = await createNotifyService({
    dataDir,
    debounceMs: DEBOUNCE,
    origin: 'https://games.test',
    channels: { push, email },
    log: () => {},
  });
  const registration: NotifyGameRegistration = {
    gameId: 'testgame',
    title: 'Test Game',
    roomPath: (roomId) => `/testgame/room/${roomId}`,
    isConnected: (roomId, playerId) => connected.has(`${roomId}/${playerId}`),
    verifySeat: (_roomId, _playerId, token) => token === 'good-token',
  };
  const reporter = service.registerGame(registration);
  const fixture = { dir: dataDir, service, push, email, connected, reporter };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const f of fixtures) {
    await f.service.close();
    await rm(f.dir, { recursive: true, force: true });
  }
  fixtures = [];
});

function bindAndSubscribe(f: Fixture, playerId = 'p1', roomId = 'ROOM1'): void {
  const bound = f.service.bindSeat(KEY, 'testgame', roomId, playerId, 'good-token');
  expect(bound.ok).toBe(true);
  f.service.addSubscription(KEY, sub('https://push.test/e1'));
}

/** Confirm an address on KEY's profile so the email leg has a target. */
async function confirmEmail(f: Fixture): Promise<void> {
  expect(await f.service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  const confirmation = f.email.sent.find((m) => m.kind === 'confirmation');
  const token = new URL(confirmation!.url).searchParams.get('token')!;
  expect(f.service.confirmEmail(token)).toBe('confirmed');
}

function turnEmails(f: Fixture): number {
  return f.email.sent.filter((m) => m.kind === 'turn').length;
}

// The channel split (owner, 2026-09-09): push fires AT the turn change,
// presence-blind — to a player looking at the board it is a one-click way
// into the tab, not noise — while email keeps the debounce and the
// fire-time presence check, because the same email IS noise.
test('the push leg fires at the turn change, before any debounce', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(5); // sends settle; well inside the 25ms window
  expect(f.push.sent).toHaveLength(1);
  const first = f.push.sent[0];
  expect(first?.payload).toEqual({
    gameTitle: 'Test Game',
    roomId: 'ROOM1',
    url: '/testgame/room/ROOM1',
  });
});

test('a connected player still gets the push; the email leg stays presence-gated', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.connected.add('ROOM1/p1');
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1);
  expect(turnEmails(f)).toBe(0);
});

test('the email leg lands after the window when the player stays away', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(5);
  expect(turnEmails(f)).toBe(0); // not before the window
  await wait(DEBOUNCE * 3);
  expect(turnEmails(f)).toBe(1);
  expect(f.push.sent).toHaveLength(1); // and exactly the one immediate push
});

test('reconnecting inside the window (checked at fire time) suppresses the email, not the push', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  f.connected.add('ROOM1/p1'); // came back before the timer fired
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1);
  expect(turnEmails(f)).toBe(0);
});

test('the turn advancing cancels the pending email leg', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1'); // immediate push to p1
  f.reporter.turnChanged('ROOM1', 'p2', 'turn-2'); // p1 moved after all
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1); // p2 has no binding; p1's email timer is gone
  expect(turnEmails(f)).toBe(0);
});

test('a same-turn re-report neither re-pushes nor kills the pending email', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(5);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1'); // duplicate, inside the window
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1);
  expect(turnEmails(f)).toBe(1); // the email leg survived the re-report
});

test('exactly one notification per turn, even if the turn is re-reported', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1'); // duplicate report, same turn
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-9'); // a genuinely new turn sends again
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(2);
});

test('no duplicate after a restart: the marker survives on disk', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1);
  await f.service.close();

  const rebooted = await makeFixture(f.dir);
  rebooted.reporter.turnChanged('ROOM1', 'p1', 'turn-1'); // same turn, re-reported post-boot
  await wait(DEBOUNCE * 3);
  expect(rebooted.push.sent).toHaveLength(0);
  fixtures = fixtures.filter((x) => x !== f); // dir now owned by `rebooted`
});

test('a null current player clears the pending email leg (the push has already gone)', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  await confirmEmail(f);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  f.reporter.turnChanged('ROOM1', null, 'turn-2'); // game over
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(1); // the immediate push had already left
  expect(turnEmails(f)).toBe(0);
});

test('an unbound seat notifies nobody', async () => {
  const f = await makeFixture();
  f.service.addSubscription(KEY, sub('https://push.test/e1')); // profile exists, seat never bound
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(0);
});

test('binding needs the real seat token', async () => {
  const f = await makeFixture();
  const refused = f.service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 'stolen-token');
  expect(refused).toEqual({ ok: false, reason: 'seatRefused' });
  const noGame = f.service.bindSeat(KEY, 'nope', 'ROOM1', 'p1', 'good-token');
  expect(noGame).toEqual({ ok: false, reason: 'noSuchGame' });
});

test('a 410 from the push service prunes that subscription and keeps the rest', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.service.addSubscription(KEY, sub('https://push.test/dead'));
  f.push.gone.add('https://push.test/dead');
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent.map((s) => s.endpoint)).toEqual(['https://push.test/e1']);
  expect(f.service.settings(KEY).pushEndpoints).toEqual(['https://push.test/e1']);
});

test('push pref off silences push without touching the subscription', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.service.setPrefs(KEY, { push: false });
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(0);
  expect(f.service.settings(KEY).pushEndpoints).toHaveLength(1);
});

test('roomRemoved drops bindings and markers', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f);
  f.reporter.roomRemoved('ROOM1');
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(0);
});

test('two rooms debounce independently', async () => {
  const f = await makeFixture();
  bindAndSubscribe(f, 'p1', 'ROOM1');
  const bound = f.service.bindSeat(KEY, 'testgame', 'ROOM2', 'p3', 'good-token');
  expect(bound.ok).toBe(true);
  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  f.reporter.turnChanged('ROOM2', 'p3', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(2);
});

/** A second registered game, so 'othergame' tags survive the unknown-tag strip. */
function registerOtherGame(f: Fixture): void {
  f.service.registerGame({
    gameId: 'othergame',
    title: 'Other Game',
    roomPath: (roomId) => `/othergame/room/${roomId}`,
    isConnected: () => false,
    verifySeat: () => true,
  });
}

// The scope routing (shared-PWA spec): a subscription belongs to one game's
// service worker, and a turn delivered through another game's worker would
// open the room inside the wrong app shell.
test('a scope-tagged subscription receives only its own game\'s turns', async () => {
  const f = await makeFixture();
  registerOtherGame(f);
  // One profile, two devices' worth of subscriptions: one tagged for
  // testgame, one tagged for a game this service also runs.
  const bound = f.service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 'good-token');
  expect(bound.ok).toBe(true);
  f.service.addSubscription(KEY, sub('https://push.test/mine', 'testgame'));
  f.service.addSubscription(KEY, sub('https://push.test/other', 'othergame'));

  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/mine']);
});

test('an untagged (pre-tag) subscription still receives turns from any game', async () => {
  const f = await makeFixture();
  const bound = f.service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 'good-token');
  expect(bound.ok).toBe(true);
  f.service.addSubscription(KEY, sub('https://push.test/legacy'));

  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/legacy']);
});

test('a turn with only off-scope subscriptions sends no push at all — no fallback', async () => {
  const f = await makeFixture();
  registerOtherGame(f);
  const bound = f.service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 'good-token');
  expect(bound.ok).toBe(true);
  f.service.addSubscription(KEY, sub('https://push.test/other', 'othergame'));

  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent).toHaveLength(0);
});

test('a tag naming no registered game is stripped at add — stored as any-scope, never a dead letter', async () => {
  const f = await makeFixture();
  const bound = f.service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 'good-token');
  expect(bound.ok).toBe(true);
  // 'testgmae' registers nothing; storing it verbatim would mint a
  // subscription no send ever matches while the UI reports push enabled.
  f.service.addSubscription(KEY, sub('https://push.test/typo', 'testgmae'));

  f.reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await wait(DEBOUNCE * 3);
  expect(f.push.sent.map((p) => p.endpoint)).toEqual(['https://push.test/typo']);
});
