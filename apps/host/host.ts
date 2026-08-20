// apps/host/host.ts
// Three games, one Express app, one HTTP server, one port.
//
// Everything here is about order and ownership. The host registers its own
// `/health` before any game so no game can shadow it, mounts each game in
// turn, and puts the menu on last so it cannot shadow a game. It creates the
// HTTP server, so it is the only thing that closes it. It allocates each
// game's save directory, so no game resolves a path against a working
// directory nobody chose.

import { mkdir } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import type { HostContext, Mount, MountedGame } from '@game-host/host/contract.js';
import { mount as mountAcquire } from '@game-host/acquire/server/index.js';
import { mount as mountMarcoPolo } from '@game-host/marcopolo/server/app.js';
import { mount as mountRailBaron } from '@game-host/railbaron/server/index.js';
import { renderMenu } from './menu.js';

/**
 * Every game in the process, and the directory each one saves into.
 *
 * `dataDir` is a *name*, not a path — the host joins it to DATA_DIR. It is
 * `acquire`, not `acquire-startups-m1`: a directory name is not a URL path,
 * and the long one is a GitHub Pages repository name that leaked into
 * Acquire's URL and is being retired at cutover. On the Render instance the
 * existing disk holds `/var/data/games`, so the cutover does a one-shot
 * `mv /var/data/games /var/data/acquire` — a permanent special case here
 * would be the wrong trade against a single move.
 *
 * `undefined` means the game persists nothing, and gets no directory at all
 * rather than an empty one somebody has to ask about later.
 *
 * Adding a game is one row. The menu, the aggregate health and the shutdown
 * all read this list rather than repeating it.
 */
const GAMES: readonly { mount: Mount; dataDir: string | undefined }[] = [
  { mount: mountRailBaron, dataDir: 'railbaron' },
  { mount: mountAcquire, dataDir: 'acquire' },
  { mount: mountMarcoPolo, dataDir: undefined },
];

export interface HostOptions {
  /**
   * Where every game's saves live, one directory per game beneath it.
   *
   * Required, with no default. A relative fallback would resolve against a
   * working directory that is wherever the service's plist says — the
   * GAMES_DIR lesson, whose symptom was every saved room appearing to have
   * vanished at once. Better to refuse to boot and say which variable is
   * missing.
   */
  dataDir: string;
}

export interface RunningHost {
  app: express.Express;
  httpServer: HttpServer;
  games: readonly MountedGame[];
  close(): Promise<void>;
}

/**
 * Builds the composed app and mounts every game. Does not listen — the caller
 * does, which is what lets the test suite bind port 0 and the boot block bind
 * a real one.
 */
export async function createHost(opts: HostOptions): Promise<RunningHost> {
  const app = express();
  const httpServer = createServer(app);
  const games: MountedGame[] = [];

  // Before the mounts, deliberately. Express matches in registration order,
  // and until this refactor all three games registered a bare `/health` of
  // their own — so whichever mounted first silently owned it. Registering the
  // host's first makes that impossible rather than merely unlikely.
  //
  // It answers for all three at once, which is strictly more than any game
  // could say alone. Each game's prefixed twin still answers for itself.
  app.get('/health', (_req, res) => {
    const byPath: Record<string, ReturnType<MountedGame['version']>> = {};
    for (const game of games) byPath[game.basePath] = game.version();
    res.json({ ok: true, games: byPath });
  });

  // Before the mounts, for the same reason `/health` is: registration order
  // decides who answers, and this must not be shadowed by a game's SPA
  // fallback. It cannot collide with the game it points at — Acquire is
  // mounted at `/acquire`, and no prefix of this string matches that.
  //
  // `/acquire-startups-m1` was a GitHub Pages repository name that leaked
  // into Acquire's URL (spec §7). Renaming it to `/acquire` invalidated every
  // link anyone ever shared, and the thing people share is a room code — so
  // the suffix has to survive the redirect or the redirect loses the room.
  // The query string too: that is how a room link arrives from some chat
  // clients.
  //
  // A prefix test rather than a route pattern, deliberately. Express 5 moved
  // to a path-to-regexp whose wildcard syntax changed under it, and a
  // mis-specified pattern here fails by silently not matching — which looks
  // exactly like "the redirect works" until someone opens an old link. This
  // form has no syntax to get wrong, and `routes.test.ts` pins the behaviour.
  //
  // 301, not 302, and kept indefinitely rather than for a deprecation window:
  // the cost is this block, and the failure is somebody's evening.
  const OLD_ACQUIRE = '/acquire-startups-m1';
  app.use((req, res, next) => {
    if (req.path !== OLD_ACQUIRE && !req.path.startsWith(`${OLD_ACQUIRE}/`)) {
      next();
      return;
    }
    // From `originalUrl`, not `path`, because only the former carries the
    // query string.
    res.redirect(301, `/acquire${req.originalUrl.slice(OLD_ACQUIRE.length)}`);
  });

  for (const { mount, dataDir } of GAMES) {
    const ctx: HostContext = { app, httpServer };
    if (dataDir !== undefined) {
      const dir = join(opts.dataDir, dataDir);
      // Created before the mount that needs it: a game may open its store
      // eagerly, and "the directory will exist by the time someone saves" is
      // the kind of assumption that holds until the first save is also the
      // first thing anyone tries.
      await mkdir(dir, { recursive: true });
      ctx.dataDir = dir;
    }
    games.push(await mount(ctx));
  }

  // Last, so it can never shadow a game. Every game's routes are scoped to
  // its own base path — which used to be an accident of each game being alone
  // in a process and is now a cross-package invariant that routes.test.ts
  // asserts — so this only ever answers what nothing else claimed.
  app.get('/', (_req, res) => {
    res.type('html').send(renderMenu(games));
  });

  return {
    app,
    httpServer,
    games,
    async close() {
      // allSettled, not all: three independent drains have no ordering
      // between them, and one game failing to drain must not strand the other
      // two — Rail Baron's close() awaits in-flight saves and can reject if a
      // disk write failed.
      await Promise.allSettled(games.map((game) => game.close()));
      // The host created this server, so the host closes it — after every
      // game has stopped, never by a game on its way out. See
      // packages/host/close.ts for what that would have cost.
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
