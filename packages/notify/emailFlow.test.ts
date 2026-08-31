// packages/notify/emailFlow.test.ts
// Double opt-in end to end: pending → confirmation link → confirmed →
// turn emails; expiry, single use, the 3-a-day resend limit, unsubscribe,
// and the invariant behind all of it — an unconfirmed address never gets a
// turn email.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotifyService, type NotifyService } from './service.js';
import { fakeEmailSender, type FakeEmailSender } from './testChannels.js';

const KEY = 'player-key-0123456789abcdef';
const DEBOUNCE = 15;
const DAY = 24 * 60 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let dir: string;
let service: NotifyService;
let email: FakeEmailSender;
let clock: { now: number };
let reporter: ReturnType<NotifyService['registerGame']>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notify-email-'));
  email = fakeEmailSender();
  clock = { now: 1_700_000_000_000 };
  service = await createNotifyService({
    dataDir: dir,
    debounceMs: DEBOUNCE,
    origin: 'https://games.test',
    channels: { email },
    now: () => clock.now,
    log: () => {},
  });
  reporter = service.registerGame({
    gameId: 'testgame',
    title: 'Test Game',
    roomPath: (roomId) => `/testgame/room/${roomId}`,
    isConnected: () => false,
    verifySeat: () => true,
  });
});

afterEach(async () => {
  await service.close();
  await rm(dir, { recursive: true, force: true });
});

function tokenFromLink(url: string): string {
  const token = new URL(url).searchParams.get('token');
  if (token === null) throw new Error(`No token in ${url}`);
  return token;
}

async function turnFires(): Promise<void> {
  reporter.turnChanged('ROOM1', 'p1', `turn-${clock.now}-${Math.random()}`);
  await wait(DEBOUNCE * 3);
}

test('submit sends a confirmation link; confirming enables turn emails', async () => {
  expect(service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 't').ok).toBe(true);
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(email.sent).toHaveLength(1);
  const confirmation = email.sent[0];
  expect(confirmation?.kind).toBe('confirmation');
  expect(confirmation?.to).toBe('pete@example.com');

  // Pending: a turn comes and goes, nothing is emailed.
  await turnFires();
  expect(email.sent.filter((e) => e.kind === 'turn')).toHaveLength(0);

  expect(service.confirmEmail(tokenFromLink(confirmation?.url ?? ''))).toBe('confirmed');
  await turnFires();
  const turns = email.sent.filter((e) => e.kind === 'turn');
  expect(turns).toHaveLength(1);
  expect(turns[0]?.to).toBe('pete@example.com');
  expect(turns[0]?.url).toBe('https://games.test/testgame/room/ROOM1');
  expect(turns[0]?.unsubscribeUrl).toContain('https://games.test/notify/unsubscribe?token=');
});

test('a confirmation link works exactly once', async () => {
  await service.submitEmail(KEY, 'pete@example.com');
  const token = tokenFromLink(email.sent[0]?.url ?? '');
  expect(service.confirmEmail(token)).toBe('confirmed');
  expect(service.confirmEmail(token)).toBe('invalid');
});

test('a confirmation link expires after 24 hours', async () => {
  await service.submitEmail(KEY, 'pete@example.com');
  const token = tokenFromLink(email.sent[0]?.url ?? '');
  clock.now += DAY + 1;
  expect(service.confirmEmail(token)).toBe('expired');
});

test('at most three confirmation sends per address per day', async () => {
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('rateLimited');
  expect(email.sent).toHaveLength(3);
  clock.now += DAY;
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
});

test('a resend invalidates the earlier link', async () => {
  await service.submitEmail(KEY, 'pete@example.com');
  const first = tokenFromLink(email.sent[0]?.url ?? '');
  await service.submitEmail(KEY, 'pete@example.com');
  const second = tokenFromLink(email.sent[1]?.url ?? '');
  expect(service.confirmEmail(first)).toBe('invalid');
  expect(service.confirmEmail(second)).toBe('confirmed');
});

test('changing the address restarts the flow', async () => {
  await service.submitEmail(KEY, 'pete@example.com');
  service.confirmEmail(tokenFromLink(email.sent[0]?.url ?? ''));
  expect(await service.submitEmail(KEY, 'new@example.com')).toBe('confirmationSent');
  expect(service.settings(KEY).email).toEqual({ address: 'new@example.com', status: 'pending' });
  // The replaced address is pending again — so no turn email to either.
  expect(service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 't').ok).toBe(true);
  await turnFires();
  expect(email.sent.filter((e) => e.kind === 'turn')).toHaveLength(0);
});

test('unsubscribe disables turn emails without login, and is re-optable', async () => {
  expect(service.bindSeat(KEY, 'testgame', 'ROOM1', 'p1', 't').ok).toBe(true);
  await service.submitEmail(KEY, 'pete@example.com');
  service.confirmEmail(tokenFromLink(email.sent[0]?.url ?? ''));
  await turnFires();
  const unsubscribeUrl = email.sent.find((e) => e.kind === 'turn')?.unsubscribeUrl ?? '';
  expect(service.unsubscribeEmail(tokenFromLink(unsubscribeUrl))).toBe(true);
  expect(service.settings(KEY).email?.status).toBe('disabled');
  await turnFires();
  expect(email.sent.filter((e) => e.kind === 'turn')).toHaveLength(1); // no new one
  // Re-opting means confirming again.
  expect(await service.submitEmail(KEY, 'pete@example.com')).toBe('confirmationSent');
  expect(service.settings(KEY).email?.status).toBe('pending');
});

test('garbage tokens are refused', () => {
  expect(service.confirmEmail('short')).toBe('invalid');
  expect(service.confirmEmail('x'.repeat(40))).toBe('invalid');
  expect(service.unsubscribeEmail('x'.repeat(40))).toBe(false);
});

test('syntactically bad addresses are refused before any send', async () => {
  for (const bad of ['nope', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@example.com`, '']) {
    expect(await service.submitEmail(KEY, bad)).toBe('invalidAddress');
  }
  expect(email.sent).toHaveLength(0);
});

test('email flow reports unavailable when the channel or origin is missing', async () => {
  const bare = await createNotifyService({
    dataDir: await mkdtemp(join(tmpdir(), 'notify-bare-')),
    channels: { email }, // sender present but no origin: links can't be built
    log: () => {},
  });
  expect(bare.emailEnabled()).toBe(false);
  expect(await bare.submitEmail(KEY, 'pete@example.com')).toBe('emailUnavailable');
  await bare.close();
});
