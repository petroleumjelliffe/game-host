// server/index.ts
// Express for /health and the built client, socket.io for everything that
// matters, the lobby's handlers and the game's over one connection.
//
// Two entry points. `mount` adds Rail Baron to an app and an HTTP server it
// does not own, and registers only what is safe to have two other games
// beside it. `startServer` owns both and adds back what only makes sense
// alone in a process — which is why its signature has not changed and every
// socket suite still boots exactly the way it did.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { BASE_PATH } from '../basePath';
import { Server as SocketServer } from 'socket.io';
import {
  GAME_SERVER_EVENTS, RB_PROTOCOL_VERSION, RB_SAVE_VERSION,
  type LogMessage,
} from '../session/protocol';
import type { HostContext, MountedGame } from '@game-host/host/contract';
import { closeSockets } from '@game-host/host/close';
import { guardSocket } from '@game-host/host/guard';
import { createLobbyHandlers } from '@game-host/lobby/server/handlers';
import { attachGameHandlers } from './handlers';
import { createRooms, type GameRoom } from './rooms';
import { createFileStore } from './store';

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** How the menu names this game. */
const TITLE = 'Rail Baron';

/**
 * Resolved from this module's location, not the working directory — the
 * GAMES_DIR lesson: a service's cwd is wherever its plist says, and a
 * relative path would quietly serve nothing.
 */
const DEFAULT_DIST = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/**
 * Where socket.io mounts unless an option says otherwise: the same
 * front-door route as pages and assets, so one proxied prefix carries the
 * whole game. Exported for the socket suites — their clients must ask for
 * this path or hang on socket.io's bare default.
 */
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;

// Versions from day one: the client ships to GitHub Pages and the server to
// Render, independently, so "which halves are these?" has to be answerable
// without reading a deploy log.
function health(_req: Request, res: Response): void {
  res.json({
    ok: true,
    protocolVersion: RB_PROTOCOL_VERSION,
    saveVersion: RB_SAVE_VERSION,
  });
}

/** The seams `startServer` needs and the host does not. */
interface MountOptions {
  distDir?: string;
  socketPath?: string;
}

/**
 * Adds Rail Baron to somebody else's app and HTTP server.
 *
 * Registers only under BASE_PATH — including `cors()`, which used to be
 * global. That was harmless with one game in the process and wrong with
 * three: Rail Baron's `origin: '*'` would otherwise apply to Marco Polo's
 * routes and to the menu, neither of which ever had it. (Narrowing the policy
 * itself waits for the one public origin the cutover creates.)
 */
export function mount(ctx: HostContext): Promise<MountedGame> {
  return mountInto(ctx, {});
}

async function mountInto(
  { app, httpServer, dataDir }: HostContext,
  opts: MountOptions,
): Promise<MountedGame> {
  if (dataDir === undefined) {
    // Loud, not a fallback. Rail Baron cannot run without somewhere to save,
    // and a relative default resolves against a working directory that is
    // wherever the service's plist says — the failure being every saved room
    // appearing to vanish at once.
    throw new Error('Rail Baron needs a dataDir to save rooms into');
  }
  app.use(BASE_PATH, cors());
  // Twinned under the base path because that is the only route the game-host
  // front door forwards — a bare /health is unreachable through the proxy.
  // Registered before the static mounts below so the SPA fallback never
  // swallows it.
  app.get(`${BASE_PATH}/health`, health);

  // The built client, served under its base path so this one process is the
  // whole game: http://<host>:<port>/railbaron/ is pages, assets, health and
  // sockets, one prefix for the front door to forward. Checked at boot, not per
  // request — `npm run dev:server` without a build is the ordinary dev case
  // (Vite serves the client then), so it's a note, not an error.
  const dist = opts.distDir ?? DEFAULT_DIST;
  if (existsSync(join(dist, 'index.html'))) {
    app.use(BASE_PATH, express.static(dist));
    // SPA fallback: a direct load or refresh of /railbaron/room/ABCD is a
    // client-side route, not a file — hand every unmatched GET under the
    // base path back to the router, exactly the job 404.html does on Pages.
    // Prefix-scoped, which used to be an accident of being alone in a process
    // and is now a cross-package invariant: unscoped, this would answer for
    // Marco Polo and Acquire too.
    app.use(BASE_PATH, (req, res, next) => {
      if (req.method !== 'GET') { next(); return; }
      res.sendFile(join(dist, 'index.html'));
    });
    console.log(`Serving built client at ${BASE_PATH}/ from ${dist}`);
  } else {
    console.log(`No built client (${join(dist, 'index.html')} missing) — ${BASE_PATH}/ will 404. Run \`npm run build\` to host the client from this server.`);
  }

  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
    path: opts.socketPath ?? SOCKET_PATH,
    // destroyUpgrade: engine.io chains `request` listeners across attached
    // engines but installs `upgrade` listeners additively, so every engine
    // sees every websocket upgrade and the ones whose path does not match arm
    // a 1-second timer to end the socket. The handshake beats that timer
    // almost every time, which is what makes deleting this line so dangerous:
    // sockets would fail rarely, under load, on the slowest phone at the
    // table. serveClient: no client loads socket.io from the server, and
    // leaving it on splices a file-serving handler into the *shared* server's
    // request listeners.
    destroyUpgrade: false,
    serveClient: false,
  });
  const rooms = createRooms(createFileStore(dataDir));

  const sendLog = (room: GameRoom, to: { emit: (e: string, m: LogMessage) => void }): void => {
    to.emit(GAME_SERVER_EVENTS.log, { roomId: room.id, events: room.log });
  };

  const wiring = createLobbyHandlers<GameRoom>(io, rooms.registry, {
    protocolVersion: RB_PROTOCOL_VERSION,

    onBegin(room) {
      rooms.seedOnBegin(room);
      void rooms.persist(room).catch((error: unknown) => {
        // Handled rather than floating: composed, an unhandled rejection here
        // ends a live Marco Polo round, which persists nothing and cannot be
        // restored. Alone in a process it only ever cost Rail Baron a restart
        // it recovers from.
        console.error('[railbaron] save failed', error);
      });
      // The lobby hands Begin to the game and lets it own the send order: the
      // lifecycle has just become 'playing', so the roster goes first and the
      // log that justifies it goes second.
      wiring.broadcastRoster(room);
      sendLog(room, io.to(room.id));
    },

    onSeated(room, playerId) {
      // A joiner or rejoiner needs the game so far, and only they do — the
      // roster already went to everyone. socketsFor narrows it to the sockets
      // actually holding this seat rather than re-broadcasting to the room.
      if (room.log.length === 0) return;
      for (const socket of wiring.socketsFor(room.id, playerId)) sendLog(room, socket);
    },
  });

  const attachGame = attachGameHandlers(io, rooms, wiring);
  io.on('connection', (socket) => {
    // Guard first: it patches `on`, so it covers every handler registered
    // after it — the lobby's included, which nothing here could otherwise
    // reach — and nothing registered before.
    guardSocket(socket, 'railbaron');
    wiring.attach(socket);
    attachGame(socket);
  });

  // Boot-only, and before the host listens: no socket can race the restore
  // because none can connect yet. That used to be true because this ran
  // before `listen` in the boot block; composed it is true because the host
  // awaits every mount before it listens — which is why the restore belongs
  // in here rather than out there.
  const restored = await rooms.restore();
  if (restored > 0) console.log(`✓ Restored ${restored} room(s)`);

  return {
    basePath: BASE_PATH,
    title: TITLE,
    version: () => ({
      protocolVersion: RB_PROTOCOL_VERSION,
      saveVersion: RB_SAVE_VERSION,
    }),
    io,
    async close() {
      // Saves before sockets. Handlers do not await persist, so a room whose
      // last append is still being written would otherwise be restored a move
      // behind — or not at all, if it was its first save.
      await rooms.settled();
      // Not io.close(): that would close the HTTP server, which composed
      // belongs to the host and two other games. See close.ts.
      closeSockets(io);
    },
  };
}

/**
 * Rail Baron alone in a process: its own app, its own HTTP server, its own
 * port, and the bare `/health` that only makes sense that way.
 *
 * A host with one game in it.
 */
export async function startServer(
  opts: {
    port: number;
    gamesDir: string;
    distDir?: string;
    /** Where socket.io mounts. Absent means SOCKET_PATH, which pins test
     *  servers by construction — no ambient env can move their mount. The
     *  env read (SOCKET_PATH) lives in the boot block, with PORT and
     *  GAMES_DIR. */
    socketPath?: string;
  },
): Promise<RunningServer> {
  const app = express();
  // Unreachable through the front door, which forwards only the prefix — but
  // it is how `curl localhost:4001/health` answers, and that is the situation
  // you are in when you are asking. Composed, the host owns this route and
  // answers for all three games at once.
  app.get('/health', health);

  const http = createServer(app);
  const game = await mountInto(
    { app, httpServer: http, dataDir: opts.gamesDir },
    { distDir: opts.distDir, socketPath: opts.socketPath },
  );

  // `listen` reports failure by emitting 'error', not by throwing, and an
  // unhandled 'error' on a server takes the process down with a stack trace
  // that buries the one useful word in it. Surfacing it as a rejection lets
  // the caller say something a person can act on.
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  // The socket path is in the banner because a mismatch is otherwise silent:
  // a client asking at the wrong mount just hangs on "Connecting…", and this
  // line is where the effective mount shows itself.
  console.log(`Server listening on ${port}, sockets at ${game.io.path()}`);

  return {
    port,
    async close() {
      await game.close();
      // The server this function created is the server this function closes.
      await new Promise<void>((resolve) => { http.close(() => { resolve(); }); });
    },
  };
}

// Run directly (`tsx server/index.ts`); imported by tests without starting.
const invoked = process.argv[1] ?? '';
if (invoked.endsWith('server/index.ts') || invoked.endsWith('server/index.js')) {
  // `.env.local` is where a developer moves the port off 4001. The client no
  // longer reads a port at all — it is origin-relative, and in dev it is
  // vite.config.ts's proxy target that names this server — so moving the
  // port means moving that target with it. The server has no bundler to load
  // the file for it, so it loads it here; VITE_SERVER_PORT keeps working as
  // a name because existing .env.local files use it.
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No such file is the ordinary case, not an error.
  }

  // 4001 is Rail Baron's slot in the cross-game registry (the game-host
  // repo's PORTS.md). Must agree with vite.config.ts's dev proxy target, or
  // a dev client's sockets land on a port nothing is listening on.
  const port = Number(process.env.PORT ?? process.env.VITE_SERVER_PORT ?? 4001);
  const gamesDir = process.env.GAMES_DIR ?? 'server/games';

  // SOCKET_PATH is read here, not inside startServer, so a test server's
  // mount can never be moved by ambient env — same seam as PORT and
  // GAMES_DIR above. Nothing sets it today; it exists so a deploy that
  // owns its whole origin could move sockets back to the bare default.
  startServer({ port, gamesDir, socketPath: process.env.SOCKET_PATH }).then((server) => {
    // close() has always known how to drain in-flight saves (rooms.settled(),
    // so the last move's write lands before the process dies) — but until
    // here nothing called it on the signals that actually stop a server:
    // SIGTERM from launchd/`brew services stop`, SIGINT from Ctrl-C. A
    // second signal skips the drain — if close() is wedged, the way out
    // should not be `kill -9`.
    let closing = false;
    const stop = (): void => {
      if (closing) process.exit(1);
      closing = true;
      void server.close().then(() => { process.exit(0); });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch((error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'EADDRINUSE') {
      console.error(
        `\n✗ Port ${port} is already in use — something is listening there.\n\n`
        + '  Find it:   lsof -nP -iTCP:' + String(port) + ' -sTCP:LISTEN\n'
        + '  Or move:   set VITE_SERVER_PORT in .env.local to a free port, and\n'
        + '             point vite.config.ts\'s dev proxy target there too.\n\n'
        + '  The cross-game port registry is the game-host repo\'s PORTS.md.\n',
      );
      process.exit(1);
    }
    console.error('✗ The server failed to start:', error);
    process.exit(1);
  });
}
