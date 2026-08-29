// packages/notify/routes.test.ts
// The router over real HTTP: express on port 0, fetch against it — the same
// arrangement the games' route tests use, so nothing here mocks express.

import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createNotifyRouter } from './routes.js';
import { createNotifyService, type NotifyService } from './service.js';
import { fakeEmailSender, fakePushSender, type FakeEmailSender } from './testChannels.js';

const KEY = 'player-key-0123456789abcdef';

let dir: string;
let service: NotifyService;
let reporter: ReturnType<NotifyService['registerGame']>;
let email: FakeEmailSender;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notify-routes-'));
  email = fakeEmailSender();
  service = await createNotifyService({
    dataDir: dir,
    debounceMs: 15,
    origin: 'https://games.test',
    channels: { push: fakePushSender(), email },
    log: () => {},
  });
  reporter = service.registerGame({
    gameId: 'testgame',
    title: 'Test Game',
    roomPath: (roomId) => `/testgame/room/${roomId}`,
    isConnected: () => false,
    verifySeat: (_room, _player, token) => token === 'good-token',
  });
  const app = express();
  app.use('/notify', createNotifyRouter(service));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}/notify`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await service.close();
  await rm(dir, { recursive: true, force: true });
});

async function post(path: string, payload: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('vapid-public-key serves the configured key', async () => {
  const res = await fetch(`${base}/vapid-public-key`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ key: 'test-vapid-public-key' });
});

test('bind demands the real seat token', async () => {
  const refused = await post('/bind', {
    playerKey: KEY,
    game: 'testgame',
    roomId: 'ROOM1',
    playerId: 'p1',
    token: 'stolen',
  });
  expect(refused.status).toBe(403);
  const ok = await post('/bind', {
    playerKey: KEY,
    game: 'testgame',
    roomId: 'ROOM1',
    playerId: 'p1',
    token: 'good-token',
  });
  expect(ok.status).toBe(200);
});

test('a malformed playerKey is rejected everywhere it appears', async () => {
  for (const path of ['/settings', '/subscriptions', '/prefs', '/email', '/email/remove']) {
    const res = await post(path, { playerKey: 'too short' });
    expect(res.status, path).toBe(400);
  }
});

test('subscription round trip shows in settings and can be removed', async () => {
  const subscription = { endpoint: 'https://push.test/e1', keys: { p256dh: 'p', auth: 'a' } };
  expect((await post('/subscriptions', { playerKey: KEY, subscription })).status).toBe(200);
  const settings = (await (await post('/settings', { playerKey: KEY })).json()) as {
    pushEndpoints: string[];
    pushEnabled: boolean;
    emailEnabled: boolean;
  };
  expect(settings.pushEnabled).toBe(true);
  expect(settings.emailEnabled).toBe(true);
  expect(settings.pushEndpoints).toEqual(['https://push.test/e1']);
  await post('/subscriptions/remove', { playerKey: KEY, endpoint: 'https://push.test/e1' });
  const after = (await (await post('/settings', { playerKey: KEY })).json()) as {
    pushEndpoints: string[];
  };
  expect(after.pushEndpoints).toEqual([]);
});

test('a garbage subscription object is a 400, not a stored record', async () => {
  const res = await post('/subscriptions', { playerKey: KEY, subscription: { endpoint: 42 } });
  expect(res.status).toBe(400);
});

test('the email flow works over the wire, links included', async () => {
  expect((await post('/email', { playerKey: KEY, email: 'not-an-address' })).status).toBe(400);
  expect((await post('/email', { playerKey: KEY, email: 'pete@example.com' })).status).toBe(200);
  const confirmUrl = email.sent[0]?.url ?? '';
  expect(confirmUrl.startsWith('https://games.test/notify/confirm?token=')).toBe(true);
  // The link's path is exactly this router's confirm route.
  const token = new URL(confirmUrl).searchParams.get('token') ?? '';
  const confirm = await fetch(`${base}/confirm?token=${token}`);
  expect(confirm.status).toBe(200);
  expect(await confirm.text()).toContain('Email confirmed');
  // Single use.
  const again = await fetch(`${base}/confirm?token=${token}`);
  expect(again.status).toBe(404);
});

test('the unsubscribe link from a turn email works with no credentials', async () => {
  await post('/email', { playerKey: KEY, email: 'pete@example.com' });
  const token = new URL(email.sent[0]?.url ?? '').searchParams.get('token') ?? '';
  await fetch(`${base}/confirm?token=${token}`);
  expect(
    (
      await post('/bind', {
        playerKey: KEY,
        game: 'testgame',
        roomId: 'ROOM1',
        playerId: 'p1',
        token: 'good-token',
      })
    ).status,
  ).toBe(200);
  // Drive one turn so a real turn email (carrying the unsubscribe link) sends.
  reporter.turnChanged('ROOM1', 'p1', 'turn-1');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const turn = email.sent.find((e) => e.kind === 'turn');
  expect(turn).toBeDefined();
  const unsubscribeUrl = turn?.unsubscribeUrl ?? '';
  // The link targets this same router — swap the deployed origin for the
  // test server's and GET it exactly as a mail client would.
  const res = await fetch(unsubscribeUrl.replace('https://games.test/notify', base));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('Unsubscribed');
  const settings = (await (await post('/settings', { playerKey: KEY })).json()) as {
    email: { status: string } | null;
  };
  expect(settings.email?.status).toBe('disabled');
});

test('prefs toggle over the wire', async () => {
  await post('/prefs', { playerKey: KEY, push: false });
  const settings = (await (await post('/settings', { playerKey: KEY })).json()) as {
    prefs: { push: boolean; email: boolean };
  };
  expect(settings.prefs).toEqual({ push: false, email: true });
});
