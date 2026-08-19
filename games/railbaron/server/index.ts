// server/index.ts
// Boot. Express for /health and the built client, socket.io for everything
// that matters, the lobby's handlers and the game's over one connection.
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
import { createLobbyHandlers } from '../vendor/lobby/server/handlers';
import { attachGameHandlers } from './handlers';
import { createRooms, type GameRoom } from './rooms';
import { createFileStore } from './store';

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

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
  app.use(cors());
  // Versions from day one: the client ships to GitHub Pages and the server to
  // Render, independently, so "which halves are these?" has to be answerable
  // without reading a deploy log.
  const health = (_req: Request, res: Response): void => {
    res.json({
      ok: true,
      protocolVersion: RB_PROTOCOL_VERSION,
      saveVersion: RB_SAVE_VERSION,
    });
  };
  app.get('/health', health);
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
    app.use(BASE_PATH, (req, res, next) => {
      if (req.method !== 'GET') { next(); return; }
      res.sendFile(join(dist, 'index.html'));
    });
    console.log(`Serving built client at ${BASE_PATH}/ from ${dist}`);
  } else {
    console.log(`No built client (${join(dist, 'index.html')} missing) — ${BASE_PATH}/ will 404. Run \`npm run build\` to host the client from this server.`);
  }

  const http = createServer(app);
  const io = new SocketServer(http, {
    cors: { origin: '*' },
    path: opts.socketPath ?? SOCKET_PATH,
  });
  const rooms = createRooms(createFileStore(opts.gamesDir));

  const sendLog = (room: GameRoom, to: { emit: (e: string, m: LogMessage) => void }): void => {
    to.emit(GAME_SERVER_EVENTS.log, { roomId: room.id, events: room.log });
  };

  const wiring = createLobbyHandlers<GameRoom>(io, rooms.registry, {
    protocolVersion: RB_PROTOCOL_VERSION,

    onBegin(room) {
      rooms.seedOnBegin(room);
      void rooms.persist(room);
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
    wiring.attach(socket);
    attachGame(socket);
  });

  // Boot-only, and before listen: no socket can race the restore because none
  // can connect yet.
  const restored = await rooms.restore();
  if (restored > 0) console.log(`✓ Restored ${restored} room(s)`);

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
  console.log(`Server listening on ${port}, sockets at ${io.path()}`);

  return {
    port,
    async close() {
      // Saves before sockets. Handlers do not await persist, so a room whose
      // last append is still being written would otherwise be restored a move
      // behind — or not at all, if it was its first save.
      await rooms.settled();
      // io.close() disconnects every socket and closes the http server it was
      // attached to. Awaited so a next boot cannot race a half-closed port.
      await new Promise<void>((resolve) => { io.close(() => { resolve(); }); });
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
