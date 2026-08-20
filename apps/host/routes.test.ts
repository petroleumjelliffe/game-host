// apps/host/routes.test.ts
// Route isolation: who answers what, when three games and a menu share one
// Express app.
//
// Every game's SPA fallback answers *every* unmatched GET under its base
// path. That was harmless when each game had a process to itself; composed it
// is the one thing standing between "refresh /railbaron/room/ABCD" and "Marco
// Polo's index.html, status 200".
//
// Which is why nothing here asserts a bare status code. The `__PWA_BASE__`
// incident is the precedent: a doubled asset path was answered by the SPA
// fallback with 200 text/html, so a status-only check passed while the page
// was broken. Each fake client carries a marker string, and the assertions
// name it.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, startTestHost, type TestHost } from './testHost.js';

let host: TestHost | undefined;

afterEach(async () => {
  const dataDir = host?.dataDir;
  await host?.close();
  host = undefined;
  if (dataDir) await cleanup(dataDir);
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PATHS = {
  railbaron: '/railbaron',
  acquire: '/acquire',
  marcopolo: '/marcopolo',
};

describe('the menu', () => {
  it('is served at the root and lists every mounted game', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    for (const game of host.host.games) {
      expect(html).toContain(`href="${game.basePath}/"`);
      expect(html).toContain(game.title);
    }
  });

  it('links with a trailing slash, or every asset would 404', async () => {
    // `/railbaron` without one makes the browser resolve the client's
    // relative asset URLs against `/`.
    host = await startTestHost();
    const html = await (await fetch(`${host.url}/`)).text();

    expect(html).toContain('href="/railbaron/"');
    expect(html).not.toContain('href="/railbaron"');
  });

  it('does not answer for a path that belongs to a game', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}${PATHS.railbaron}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('health', () => {
  it('aggregates all three games at the root', async () => {
    host = await startTestHost();

    const body = await (await fetch(`${host.url}/health`)).json() as {
      ok: boolean;
      games: Record<string, { protocolVersion: number; saveVersion?: number }>;
    };

    expect(body.ok).toBe(true);
    expect(Object.keys(body.games).sort()).toEqual(
      [PATHS.acquire, PATHS.marcopolo, PATHS.railbaron].sort(),
    );
  });

  it('reports each game\'s own versions, not one game\'s three times', async () => {
    host = await startTestHost();

    const body = await (await fetch(`${host.url}/health`)).json() as {
      games: Record<string, { protocolVersion: number; saveVersion?: number }>;
    };

    // Marco Polo persists nothing, so it has no save version and the other
    // two do. If one game were answering for all three, this would not hold.
    expect(body.games[PATHS.marcopolo]?.saveVersion).toBeUndefined();
    expect(body.games[PATHS.railbaron]?.saveVersion).toBeDefined();
    expect(body.games[PATHS.acquire]?.saveVersion).toBeDefined();
  });

  it('matches what each game\'s own twin says', async () => {
    host = await startTestHost();

    const aggregate = await (await fetch(`${host.url}/health`)).json() as {
      games: Record<string, unknown>;
    };

    for (const game of host.host.games) {
      const twin = await (await fetch(`${host.url}${game.basePath}/health`)).json() as
        Record<string, unknown>;
      const { ok, ...versions } = twin;
      expect(ok).toBe(true);
      expect(aggregate.games[game.basePath]).toEqual(versions);
    }
  });

  it('cannot be shadowed by a game, because it is registered first', async () => {
    // Express matches in registration order. Until this refactor all three
    // games registered a bare /health of their own and whichever mounted
    // first silently owned it; the host's is registered before any mount.
    host = await startTestHost();

    const body = await (await fetch(`${host.url}/health`)).json() as Record<string, unknown>;

    // A game's twin answers `{ok, protocolVersion, ...}` with no `games` key.
    // The aggregate has one. This is how you tell which route answered.
    expect(body.games).toBeDefined();
    expect(body.protocolVersion).toBeUndefined();
  });
});

describe('one game\'s SPA fallback', () => {
  // Rail Baron and Acquire arm their fallback only when a built client exists
  // beside them, so this block tests built output and not routing alone. An
  // earlier version of this comment claimed the assertions "hold either way,
  // with a build present or not". They do not, and that cost a day of red CI
  // in August 2026: the workflow ran `npm test` without ever building, this
  // was the only test that noticed, and it reported `expected 404 to be 200`
  // — which says nothing at all about the actual cause.
  //
  // So the requirement is stated once, out loud, and the failure explains
  // itself. CI builds before it tests.
  const BUILT_CLIENTS: Readonly<Record<string, string>> = {
    'Rail Baron': join(REPO, 'games', 'railbaron', 'dist', 'index.html'),
    Acquire: join(REPO, 'games', 'acquire', 'dist', 'index.html'),
  };

  beforeAll(() => {
    const missing = Object.entries(BUILT_CLIENTS)
      .filter(([, file]) => !existsSync(file))
      .map(([game, file]) => `  ${game}: ${file}`);
    if (missing.length > 0) {
      throw new Error(
        'These tests need built clients, and these are missing:\n'
        + `${missing.join('\n')}\n\n`
        + '  Run `npm run build` first. A game only arms its SPA fallback when\n'
        + '  a built client sits beside it, so without one the assertions below\n'
        + '  fail as a bare 404 that looks like a routing bug and is not.\n',
      );
    }
  });

  it('answers under its own prefix with its own page', async () => {
    // Both games' clients are built in this working tree, so both titles are
    // real strings on disk. Asserting the title rather than the status is the
    // point: 200 cannot tell you *which* game answered, and answering with
    // the wrong game is the entire failure mode a shared app creates.
    host = await startTestHost();

    const rail = await fetch(`${host.url}${PATHS.railbaron}/room/ABCD`);
    const acquire = await fetch(`${host.url}${PATHS.acquire}/room/ABCD`);

    expect(rail.status).toBe(200);
    expect(await rail.text()).toContain('<title>Rail Baron</title>');
    expect(acquire.status).toBe(200);
    expect(await acquire.text()).toContain('<title>Acquire');
  });

  it('does not answer under another game\'s prefix', async () => {
    host = await startTestHost();

    // Marco Polo has no SPA fallback of its own — a client-side route under
    // its prefix is a 404 from express.static. So if anything answers here
    // with a page, it is somebody else's fallback reaching across, which is
    // exactly what `app.use(BASE_PATH, …)` scoping prevents.
    const marco = await fetch(`${host.url}${PATHS.marcopolo}/room/ABCD`);

    expect(marco.status).toBe(404);
    const body = await marco.text();
    expect(body).not.toContain('<title>Rail Baron</title>');
    expect(body).not.toContain('<title>Acquire');
  });

  it('leaves an unclaimed path to the menu, not to a game', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/not-a-game/at-all`);

    // Nothing claims it, and the menu is registered at `/` exactly rather
    // than as a catch-all, so this is a plain 404 — not a game's index.html
    // and not the menu either.
    expect(res.status).toBe(404);
  });

  it('leaves non-GETs alone rather than answering with a page', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}${PATHS.railbaron}/room/ABCD`, { method: 'POST' });

    expect(res.status).toBe(404);
  });
});

describe('the old Acquire path, kept working indefinitely', () => {
  // `/acquire-startups-m1` was a GitHub Pages repository name that leaked into
  // the URL (spec §7). The rename to `/acquire` broke every link anyone had
  // ever shared — a room code is the thing people paste to each other, so a
  // redirect that drops the suffix is a redirect that loses the room.
  //
  // Not a 302: this is permanent, and a browser that caches it is doing the
  // right thing. Kept indefinitely rather than for a deprecation window,
  // because the cost is two lines and the failure is someone's evening.
  it('redirects a shared room link to the new path, suffix intact', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/acquire-startups-m1/room/ABCD`, { redirect: 'manual' });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/acquire/room/ABCD');
  });

  it('redirects the bare path to the new base', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/acquire-startups-m1/`, { redirect: 'manual' });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/acquire/');
  });

  // A query string is how a room link arrives from some chat clients, and
  // dropping it silently is the same class of loss as dropping the suffix.
  it('keeps the query string', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/acquire-startups-m1/room/ABCD?seat=red`, { redirect: 'manual' });

    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/acquire/room/ABCD?seat=red');
  });

  // The redirect must not shadow the game that now lives there.
  it('does not touch the new path', async () => {
    host = await startTestHost();

    const res = await fetch(`${host.url}/acquire/health`);

    expect(res.status).toBe(200);
  });
});
