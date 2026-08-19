// server/devSeed.test.ts
// The dev-only seeding route.
//
// What it does matters less than what it must never do. `socketHarness.ts`
// records that there is "deliberately no socket event that installs a prepared
// state", and that stays true: this is an HTTP route, off the wire entirely, so
// the protocol surface does not grow a permanent dev affordance right before
// Stage 1 puts a version on it.
//
// The load-bearing test here is the last one. The route is *absent* under
// production rather than guarded inside its own handler, because an absent
// route cannot be reached by a bug in its own auth check.

import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from './index.js';
import { buildFixture } from '../engine/golden/fixtures.js';
import { ALL_GOLDEN_GAMES } from '../engine/golden/index.js';
import { BASE_PATH } from '../basePath.js';

interface Running {
  port: number;
  rooms: ReturnType<typeof createServer>['rooms'];
  devSeed: boolean;
  close(): Promise<void>;
}

let running: Running | null = null;

/**
 * `nodeEnv` is applied around `createServer`, not around the request: the
 * route is registered at construction, which is the whole point of the guard.
 * Setting it before the fetch instead would test nothing.
 */
async function start(nodeEnv?: string): Promise<Running> {
  const previous = process.env.NODE_ENV;
  if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
  let handle;
  try {
    handle = createServer();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }

  const { httpServer, io, rooms, devSeed } = handle;
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('dev seed test server did not bind an ephemeral port');
  }

  running = {
    port: address.port,
    rooms,
    devSeed,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
  return running;
}

afterEach(async () => {
  if (running) await running.close();
  running = null;
});

function seed(port: number, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}${BASE_PATH}/dev/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /dev/rooms', () => {
  it('seats a golden game and returns a token for every seat', async () => {
    const { port, rooms } = await start('development');

    const res = await seed(port, { goldenId: 'G2' });
    expect(res.status).toBe(200);
    const body = await res.json();

    // G2's own fixture is the authority on who is playing — the caller does
    // not pass names, so there is no way for them to drift apart.
    const g2 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G2');
    if (!g2) throw new Error('G2 is missing from ALL_GOLDEN_GAMES');
    const expected = buildFixture(g2.setup).players.map((p) => p.name);

    expect(body.players.map((p: { name: string }) => p.name)).toEqual(expected);
    for (const player of body.players) {
      expect(player.token, `${player.name} has no token`).toBeTruthy();
      expect(player.path).toBe(
        `${BASE_PATH}/room/${body.roomId}?devSeat=${player.id}&devToken=${player.token}` +
          `&devName=${encodeURIComponent(player.name)}`,
      );
    }

    // The room is really in the registry, holding the fixture's board —
    // not merely described by a response body.
    const room = rooms.get(body.roomId);
    expect(room, 'the seeded room is not in the registry').toBeDefined();
    expect(room?.committed().stage).toBe(buildFixture(g2.setup).stage);
  });

  it('seats every player disconnected, so presence is honest before anyone joins', async () => {
    const { port, rooms } = await start('development');

    const body = await (await seed(port, { goldenId: 'G2' })).json();
    const room = rooms.get(body.roomId);

    // `fromState` seats through `seatPlayer`, which marks a player connected.
    // Left alone, a freshly seeded room claims both players are present and
    // the roster's presence dots lie before a single socket has opened.
    expect(room?.players.every((p) => !p.connected)).toBe(true);
  });

  it('takes an explicit roomId, and re-seeding the same id restarts the scenario', async () => {
    const { port, rooms } = await start('development');

    const first = await (await seed(port, { goldenId: 'G2', roomId: 'MERGE1' })).json();
    expect(first.roomId).toBe('MERGE1');

    const second = await (await seed(port, { goldenId: 'G2', roomId: 'MERGE1' })).json();
    expect(second.roomId).toBe('MERGE1');
    // Fresh tokens, because it is a fresh room object — re-seeding is how a
    // by-hand run is restarted, so it must not silently reuse the old one.
    expect(second.players[0].token).not.toBe(first.players[0].token);
    expect(rooms.get('MERGE1')).toBeDefined();
  });

  it('refuses an unknown golden id with a 400, not a 500', async () => {
    const { port } = await start('development');

    const res = await seed(port, { goldenId: 'G99' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('G99');
  });

  it('refuses a body with no goldenId', async () => {
    const { port } = await start('development');
    expect((await seed(port, {})).status).toBe(400);
  });

  it('does not exist when NODE_ENV is unset, because the guard fails closed', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const { port } = await start();
      // An absent NODE_ENV must not be read as "not production, therefore
      // dev". Anything that is not explicitly development gets no route.
      expect((await seed(port, { goldenId: 'G2' })).status).toBe(404);
      expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('reports whether it registered, so the boot banner cannot lie about it', async () => {
    // The banner is the only place a stale environment shows itself: `tsx
    // watch` reloads code and never the env it was launched with, so a server
    // started before the guard was inverted keeps serving, reloads into the
    // new code, and stops registering the route with nothing said. That is
    // worth a line of output only if the line is derived from the same
    // decision the route is — hence a reported flag rather than a second
    // reading of NODE_ENV, which could drift from the first.
    const dev = await start('development');
    expect(dev.devSeed).toBe(true);
    expect((await seed(dev.port, { goldenId: 'G2' })).status).toBe(200);
    await dev.close();
    running = null;

    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const off = await start();
      expect(off.devSeed).toBe(false);
      expect((await seed(off.port, { goldenId: 'G2' })).status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('does not exist at all in production', async () => {
    const { port } = await start('production');

    const res = await seed(port, { goldenId: 'G2' });
    // 404, not 403: the route is never registered, so there is no handler to
    // hold a guard that could be wrong. Break this by registering the route
    // unconditionally and this test must turn red — if it does not, the guard
    // is decorative.
    expect(res.status).toBe(404);

    // And the health route still works, proving the server itself came up and
    // the 404 above is about this route rather than a dead process.
    expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
  });
});
