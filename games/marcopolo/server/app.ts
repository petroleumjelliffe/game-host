// Assembly only: express static + socket.io + lobby wiring + game wiring.
//
// Two entry points, and the split between them is the whole point of this
// file. `mount` adds Marco Polo to an app and an HTTP server it does not own,
// so it registers only what is safe to have two other games beside it.
// `createAppServer` owns both, and adds back the things that only make sense
// when Marco Polo is alone in a process.

import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import type { HostContext, MountedGame } from '@game-host/host/contract.js';
import { closeSockets } from '@game-host/host/close.js';
import { guardSocket } from '@game-host/host/guard.js';
import { createLobbyRegistry, type SeatSpace } from '@game-host/lobby/server/rooms.js';
import { createLobbyHandlers, type LobbyHooks } from '@game-host/lobby/server/handlers.js';
import { PROTOCOL_VERSION, SEAT_IDS } from '../protocol/game.js';
import { makeRoom, type MarcoPoloRoom } from './game.js';
import { createGameHandlers } from './gameHandlers.js';

// The proxy path the game-host repo's Caddyfile routes; the client is built
// with base '/marcopolo/' to match.
const BASE_PATH = '/marcopolo';

/** How the menu names this game. */
const TITLE = 'Marco Polo';

/**
 * Where socket.io mounts: the same front-door route as pages and assets, so
 * one proxied prefix carries the whole game — this retires the root
 * /socket.io claim in game-host's Caddyfile. A constant, not a knob: Marco
 * Polo has no remote deploy, so nothing needs to move it. Exported for the
 * wire suite — its clients must ask for this path or hang on socket.io's
 * bare default.
 */
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;

/**
 * Where this game's built client lives, resolved from **this package's root**
 * rather than from this module's location.
 *
 * The working directory is still not an option, and for the original reason —
 * the GAMES_DIR lesson: a service's cwd is wherever its plist says, and a
 * relative path would quietly serve nothing. What changed is that
 * `import.meta.url` is not an option either. It names where this *module*
 * ended up, and compiling moves modules: an `outDir` changes their depth and
 * a bundle collapses every game into one file, at which point all three
 * compute the same path and at most one can be right. Verified — bundled,
 * Rail Baron and Acquire both looked in `apps/host/dist`.
 *
 * Resolving the package by name asks the same question the host's own
 * imports already ask, and gets an answer that is true from anywhere: inside
 * the package under `tsx`, and from a bundle three directories away.
 * `apps/host/compiled.test.ts` boots the compiled host and reads this path
 * back.
 */
const DIST = fileURLToPath(
  new URL('client/dist', import.meta.resolve('@game-host/marcopolo/package.json')),
);

// "Which server is this?" has to be answerable without reading a deploy log.
// No save version: Marco Polo persists nothing.
function health(_req: express.Request, res: express.Response): void {
  res.json({ ok: true, protocolVersion: PROTOCOL_VERSION });
}

/**
 * Adds Marco Polo to somebody else's app and HTTP server.
 *
 * Registers only under BASE_PATH. The bare `/health` and the root static
 * mount live in `createAppServer` below, because in a composed process the
 * first would be a route three games fight over and the second would answer
 * `/` with Marco Polo's index.html, which is the menu's job.
 *
 * Synchronous underneath — there is nothing to restore, since nothing is
 * persisted — but typed as the async `Mount` the host expects, so all three
 * games look the same from `apps/host`.
 */
export function mount(ctx: HostContext): Promise<MountedGame> {
  return Promise.resolve(mountSync(ctx));
}

function mountSync({ app, httpServer }: HostContext): MountedGame {
  // Twinned under the base path because that prefix is the only route the
  // game-host front door forwards — a bare /health is unreachable through the
  // proxy.
  app.get(`${BASE_PATH}/health`, health);
  app.use(BASE_PATH, express.static(DIST));

  // Which client this process is serving, said out loud, in the same words
  // Rail Baron and Acquire use. Marco Polo was the only game that never said,
  // and "which build is this?" was correspondingly unanswerable for it
  // without reading the code — the exact question the aggregate /health
  // exists to answer for everything else. Unlike the other two this does not
  // gate the static mount: a missing directory is already harmless to
  // express.static, and changing routing is not what a log line is for.
  const index = join(DIST, 'index.html');
  if (existsSync(index)) {
    console.log(`Serving built client at ${BASE_PATH}/ from ${DIST}`);
  } else {
    console.log(`No built client (${index} missing) — ${BASE_PATH}/ will 404. Run \`npm run build\` to host the client from this server.`);
  }

  const io = new SocketServer(httpServer, {
    path: SOCKET_PATH,
    // Both of these are about sharing an HTTP server, and both are invisible
    // until something goes wrong.
    //
    // destroyUpgrade: engine.io's `attach` chains `request` listeners (it
    // caches the existing ones and delegates on a path miss) but installs
    // `upgrade` listeners additively, caching nothing. So every attached
    // engine sees every websocket upgrade, and the ones whose path does not
    // match schedule a 1-second timer that ends the socket unless it has
    // written bytes by then. The handshake wins that race almost every time,
    // which is exactly what makes deleting this line so dangerous: sockets
    // would fail rarely, under load, on the slowest phone at the table.
    //
    // serveClient: no client loads socket.io from the server — all three
    // bundle it — and leaving it on makes `initEngine` call `attachServe`,
    // which splices into the *shared* server's request listeners to serve a
    // file nobody asks for.
    destroyUpgrade: false,
    serveClient: false,
  });

  const space: SeatSpace = { ids: SEAT_IDS, defaultName: (i) => `Swimmer ${i + 1}` };
  const registry = createLobbyRegistry(makeRoom, space);
  const hooks: LobbyHooks<MarcoPoloRoom> = {
    protocolVersion: PROTOCOL_VERSION,
    // `game` is assigned below; these run only after a socket event arrives.
    onBegin(room) {
      game.begin(room);
    },
    onSeated(room, playerId) {
      game.seat(room, playerId);
    },
  };
  const wiring = createLobbyHandlers(io, registry, hooks);
  const game = createGameHandlers(io, registry, wiring);

  io.on('connection', (socket) => {
    // Guard first: it patches `on`, so it covers every handler registered
    // after it and none registered before — including the lobby's, which
    // `wiring.attach` installs and nothing here could otherwise reach.
    guardSocket(socket, 'marcopolo');
    // Game before lobby: its disconnect handler must read the seat binding
    // before the lobby's disconnect handler deletes it. Do not reorder.
    game.attach(socket);
    wiring.attach(socket);
  });

  return {
    basePath: BASE_PATH,
    title: TITLE,
    version: () => ({ protocolVersion: PROTOCOL_VERSION }),
    io,
    async close() {
      game.stop();
      // Not io.close(): it would close the HTTP server, which in a composed
      // process belongs to the host and to two other games. See close.ts.
      closeSockets(io);
      return Promise.resolve();
    },
  };
}

/**
 * Marco Polo alone in a process: its own app, its own HTTP server, and the
 * two routes that only make sense that way.
 *
 * This is a host with one game in it — which is why the signature has not
 * changed and `main.ts` and the wire suite have not noticed anything.
 */
export function createAppServer(): {
  httpServer: HttpServer;
  io: SocketServer;
  stop(): Promise<void>;
} {
  const app = express();
  const httpServer = createServer(app);
  // Unreachable through the front door, which forwards only the prefix — but
  // it is how `curl localhost:4003/health` works, and that is the situation
  // you are in when you are asking.
  app.get('/health', health);

  const game = mountSync({ app, httpServer });

  // After the mount, so the prefixed routes win: hitting the bare port still
  // lands on the game — `/` serves index.html, whose asset URLs resolve via
  // the prefixed mount. The one line here that could never be composed.
  app.use(express.static(DIST));

  return {
    httpServer,
    io: game.io,
    async stop() {
      await game.close();
      // The server this function created is the server this function closes.
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
