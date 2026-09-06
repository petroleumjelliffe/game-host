// The invite flow through the whole composed stack: a real wordgame room
// over a real socket, an email invite through the real /notify HTTP with
// the fake mailer, the claim through the real endpoint, and the claimed
// seat joining over the wire — plus the on-disk records, read straight
// from the files, in notifications.test.ts's style.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PROTOCOL_VERSION as WORDGAME_PROTOCOL } from '@game-host/wordgame/session/protocol.js';
import { fakeEmailSender, fakePushSender } from '@game-host/notify/testChannels.js';
import type { RosterMessage } from '@game-host/lobby/protocol/protocol.js';
import {
  cleanup,
  createRoom,
  next,
  nextWhere,
  startTestHost,
  type TestHost,
} from './testHost.js';

let handle: TestHost | null = null;
let savedOrigin: string | undefined;

beforeAll(() => {
  // The email channel refuses to build links without an origin — the same
  // rule production runs under, so the test sets one the way a deploy does.
  savedOrigin = process.env.NOTIFY_ORIGIN;
  process.env.NOTIFY_ORIGIN = 'https://games.test';
});

afterAll(() => {
  if (savedOrigin === undefined) delete process.env.NOTIFY_ORIGIN;
  else process.env.NOTIFY_ORIGIN = savedOrigin;
});

afterEach(async () => {
  const dataDir = handle?.dataDir;
  await handle?.close();
  handle = null;
  if (dataDir !== undefined) await cleanup(dataDir);
});

test('an email invite reserves a seat, mails a claimable link, and the claim joins', async () => {
  const email = fakeEmailSender();
  handle = await startTestHost({ notifyChannels: { push: fakePushSender(), email } });

  // A real room with a real host seat.
  const host = await handle.client('/wordgame');
  const rosters: RosterMessage[] = [];
  host.on('roster', (r: RosterMessage) => rosters.push(r));
  const seat = await createRoom(host, WORDGAME_PROTOCOL, 'Pete');

  // The invite, over the real HTTP mount.
  const playerKey = 'host-key-0123456789abcdef';
  const reserved = nextWhere<RosterMessage>(host, 'roster', (r) => (r.pending ?? []).length === 1);
  const inviteRes = await fetch(`${handle.url}/notify/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerKey,
      game: 'wordgame',
      roomId: seat.roomId,
      playerId: seat.playerId,
      token: (seat as { token?: string }).token,
      email: 'sam@example.com',
    }),
  });
  expect(inviteRes.status).toBe(200);
  const invited = (await inviteRes.json()) as { ok: boolean; playerId: string };
  expect(invited.ok).toBe(true);

  // The reserved row reached every phone in the lobby, and carries no hash.
  const withPending = await reserved;
  expect(withPending.pending).toEqual([{ id: invited.playerId, name: null }]);

  // The mail went, to the address, with the claim link.
  expect(email.sent).toHaveLength(1);
  const mail = email.sent[0]!;
  expect(mail).toMatchObject({ kind: 'invite', to: 'sam@example.com' });
  expect(mail.url).toContain(`https://games.test/wordgame/room/${seat.roomId}?invite=`);
  const token = mail.url.split('invite=')[1]!;
  // The roster never carried the token or its hash.
  const hash = createHash('sha256').update(token).digest('hex');
  expect(JSON.stringify(withPending)).not.toContain(hash);

  // On disk: the invite record, keyed by the hash, target intact, unclaimed.
  // The store's writes are fire-and-forget behind the response, so give the
  // file a beat to land rather than racing it.
  const recordPath = join(handle.dataDir, 'notifications', 'invites', `${hash}.json`);
  const raw = await (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await readFile(recordPath, 'utf8');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return readFile(recordPath, 'utf8');
  })();
  const record = JSON.parse(raw) as {
    target: unknown;
    claimedAt?: number;
    roomId: string;
  };
  expect(record.target).toEqual({ kind: 'email', address: 'sam@example.com' });
  expect(record.claimedAt).toBeUndefined();
  expect(record.roomId).toBe(seat.roomId);

  // The claim, through the real endpoint — the landing page's POST.
  const claimRes = await fetch(`${handle.url}/notify/invite/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteToken: token, playerKey: 'sam-key-0123456789abcdef' }),
  });
  expect(claimRes.status).toBe(200);
  const creds = (await claimRes.json()) as { playerId: string; token: string; name: string };
  expect(creds.playerId).toBe(invited.playerId);

  // Claiming IS the double-opt-in: the address is confirmed with no click.
  const settingsRes = await fetch(`${handle.url}/notify/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerKey: 'sam-key-0123456789abcdef' }),
  });
  expect(((await settingsRes.json()) as { email: unknown }).email).toEqual({
    address: 'sam@example.com',
    status: 'confirmed',
  });

  // The claimed credentials join over the wire — the ordinary path.
  const claimer = await handle.client('/wordgame');
  const joined = next<{ playerId: string }>(claimer, 'joined');
  claimer.emit('joinRoom', {
    roomId: seat.roomId,
    playerId: creds.playerId,
    token: creds.token,
    protocolVersion: WORDGAME_PROTOCOL,
  });
  expect((await joined).playerId).toBe(creds.playerId);
  const settled = await nextWhere<RosterMessage>(
    host,
    'roster',
    (r) => r.players.length === 2 && (r.pending ?? []).length === 0,
  );
  expect(settled.players.map((p) => p.id).sort()).toEqual(
    [seat.playerId, creds.playerId].sort(),
  );

  // And the spent token is one shaped nothing.
  const again = await fetch(`${handle.url}/notify/invite/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteToken: token }),
  });
  expect(again.status).toBe(404);
});
