// server/index.ts
// Transport only. The room decides what happened; this file decides who hears
// about it, and is the single place `project` is ever called.
//
// Two entry points. `mount` adds Acquire to an app and an HTTP server it does
// not own, registering only what is safe to have two other games beside it.
// `createServer` owns both and adds back the bare `/health` that only makes
// sense alone in a process — which is why its signature, its options and its
// handle are unchanged, and the socket harness that hundreds of tests run on
// never noticed.

import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { BASE_PATH } from '../basePath.js';
import type {
  GameTurnReporter,
  HostContext,
  MountedGame,
  TurnNotifier,
} from '@game-host/host/contract.js';
import { closeSockets } from '@game-host/host/close.js';
import { guardSocket } from '@game-host/host/guard.js';
import { project } from './projection.js';
import { createRoomRegistry, type RoomRegistry } from './rooms.js';
import { createFileStore, createNullStore, SAVE_VERSION, type RoomStore } from './store.js';
import { registerDevSeed } from './devSeed.js';
import type { Delivery, GameRoom } from './room.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  PROTOCOL_VERSION,
  type StateMessage,
  type StateReason,
  type UndoMessage,
  type WireIntent,
  isWireIntent,
} from '../session/protocol.js';
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol.js';
import { createLobbyHandlers } from '@game-host/lobby/server/handlers.js';

/** How the menu names this game. */
const TITLE = 'Acquire';

export interface ServerHandle {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer;
  rooms: RoomRegistry;
  /**
   * Whether the dev seed route was registered, reported rather than inferred.
   *
   * `tsx watch` reloads code but never the environment it was launched with,
   * so a dev server can outlive the meaning of its own NODE_ENV: a process
   * started before the guard was inverted keeps running, picks up the new
   * code on its next reload, and quietly stops registering the route. That
   * happened on 2026-08-19 and cost four days of a 404 nobody was looking
   * for. The boot banner prints this, so every reload restates it.
   */
  devSeed: boolean;
  /**
   * The standalone server's mounted face — the same object `mount` hands
   * the composed host. Exposed so tests can exercise the contract the host
   * actually calls (`close`, above all) without booting three games.
   */
  game: MountedGame;
}

export interface ServerOptions {
  /** Defaults to the null store, so every test that boots a bare server keeps working. */
  store?: RoomStore;
  /** Where the built client lives. Tests point this at a fake; production
   *  resolves it from this module's location, never the cwd — a service's
   *  working directory is wherever its plist says. */
  distDir?: string;
  /** Where socket.io mounts. Absent means the prefixed default below, which
   *  is what pins the test harness by construction — no ambient env can move
   *  a test server's mount. The env read (SOCKET_PATH) lives in the boot
   *  block, same as PORT and GAMES_DIR. */
  socketPath?: string;
}

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
const DEFAULT_DIST = fileURLToPath(
  new URL('dist', import.meta.resolve('@game-host/acquire/package.json')),
);

/**
 * Alive, and what it speaks.
 *
 * The versions are here because a handshake that fails cannot report why:
 * a client refused with `versionMismatch` knows only its own number. This
 * endpoint needs no version of its own to answer, so it stays reachable in
 * exactly the situation you are trying to diagnose — and it makes "what is
 * deployed" one curl rather than a trip to the hosting dashboard, which is
 * what it took on 2026-08-07.
 */
function health(_req: Request, res: Response): void {
  res.json({ ok: true, protocolVersion: PROTOCOL_VERSION, saveVersion: SAVE_VERSION });
}

/** What `build` hands back: the mounted game, plus what only the wrapper wants. */
interface Built {
  game: MountedGame;
  rooms: RoomRegistry;
  devSeed: boolean;
}

/**
 * Adds Acquire to somebody else's app and HTTP server.
 *
 * The restore happens here, awaited, rather than in a boot block: the host
 * awaits every mount before it listens, so finishing the restore inside
 * `mount` is what makes "no socket can race a half-restored registry" true
 * by construction. A restore that fails is logged and survived — a broken
 * Acquire save must not stop Rail Baron and Marco Polo from mounting.
 */
export async function mount(ctx: HostContext): Promise<MountedGame> {
  const store = ctx.dataDir === undefined ? createNullStore() : createFileStore(ctx.dataDir);
  const built = build(ctx.app, ctx.httpServer, store, { notify: ctx.notify });
  try {
    const restored = await built.rooms.restore();
    if (restored > 0) console.log(`✓ Restored ${restored} room(s)`);
  } catch (e: unknown) {
    console.warn('! Restore failed, starting with no rooms:', e);
  }
  return built.game;
}

function build(
  app: express.Express,
  httpServer: HttpServer,
  store: RoomStore,
  options: Pick<ServerOptions, 'distDir' | 'socketPath'> & { notify?: TurnNotifier },
): Built {
  // Twinned under the base path because that is the only route the game-host
  // front door forwards — a bare `/health` is unreachable through the proxy.
  app.get(`${BASE_PATH}/health`, health);

  // The built client, served under its base path so one process can be the
  // whole game on a LAN (the game-host repo's front door points here). No
  // build present is the ordinary dev case — Vite serves the client then —
  // so it's a boot note, not an error.
  const dist = options.distDir ?? DEFAULT_DIST;
  if (existsSync(join(dist, 'index.html'))) {
    app.use(BASE_PATH, express.static(dist));
    // SPA fallback: a refresh on a client-side route under the base path is
    // a route, not a file — hand it back to the router. Prefix-scoped, which
    // used to be an accident of being alone in a process and is now a
    // cross-package invariant: unscoped it would answer for the other two
    // games and for the menu.
    app.use(BASE_PATH, (req, res, next) => {
      if (req.method !== 'GET') { next(); return; }
      res.sendFile(join(dist, 'index.html'));
    });
    console.log(`Serving built client at ${BASE_PATH}/ from ${dist}`);
  } else {
    console.log(`No built client (${join(dist, 'index.html')} missing) — ${BASE_PATH}/ not served. Run \`npm run build\` to host the client from this server.`);
  }

  // Mounted under the base path so sockets ride the same front-door route as
  // pages and assets. Overridden via the boot block's SOCKET_PATH (the
  // options seam): Render sets /socket.io because its Pages client keeps
  // socket.io's default path when talking to a separate origin (see
  // src/net/connection.ts). dev:server leaves SOCKET_PATH unset, so it falls
  // through to the prefixed default below — which is what the dev client
  // expects too, now that base is uniform and it requests the same
  // BASE_URL-prefixed path in dev as in a build.
  const io = new SocketServer(httpServer, {
    path: options.socketPath ?? `${BASE_PATH}/socket.io`,
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
  const rooms = createRoomRegistry(store);

  // Dev only, and absent rather than guarded — see `devSeed.ts`. Fail
  // closed: an unset NODE_ENV is not "probably dev", it is unknown, and the
  // route that installs arbitrary game state does not run on unknown.
  //
  // Read here rather than at the boot seam, unlike PORT/GAMES_DIR/SOCKET_PATH:
  // ambient env is the actual input to this decision, and `devSeed.test.ts`
  // exercises it by setting NODE_ENV around this constructor. Hoisting the
  // read to the boot block would move the real decision somewhere no test can
  // reach. The route it registers is already prefixed (`${BASE_PATH}/dev/rooms`),
  // so composition changes nothing about it.
  const devSeed = process.env.NODE_ENV === 'development';
  if (devSeed) registerDevSeed(app, rooms);

  // Turn notifications, when the host runs the service. Registration hands
  // it three closures over things this file already holds; the game's only
  // other duty is the one `turnChanged` call in `deliver`'s commit branch.
  // `segmentStart` is the turnKey: it moves exactly when a commit happens,
  // so it is distinct per turn and survives a restart with the room.
  const notifier: GameTurnReporter | undefined = options.notify?.registerGame({
    gameId: 'acquire',
    title: TITLE,
    roomPath: (roomId) => `${BASE_PATH}/room/${roomId}`,
    isConnected: (roomId, playerId) => lobby.socketsFor(roomId, playerId).length > 0,
    verifySeat: (roomId, playerId, token) => {
      const seat = rooms.get(roomId)?.players.find((p) => p.id === playerId);
      return seat !== undefined && seat.token === token;
    },
  });

  const lobby = createLobbyHandlers<GameRoom>(io, rooms, {
    protocolVersion: PROTOCOL_VERSION,
    onBegin(room) {
      const delivery = room.begin(randomSeed());
      lobby.broadcastRoster(room);
      deliver(room, delivery);
    },
    onSeated(room, playerId) {
      // `resume`, not `commit`: this socket may belong to the player the game
      // is waiting on, mid-segment, with work the server still holds.
      if (room.lifecycle() !== 'lobby') sendState(room, playerId, 'resume');
    },
  });

  /**
   * Save without waiting — a player should not wait on a disk — but not
   * without handling the failure.
   *
   * A bare `void rooms.persist(room)` is a floating promise, and an unhandled
   * rejection ends the process. Alone that cost Acquire a restart it recovers
   * from, since the rooms are on disk. Composed it ends a live Marco Polo
   * round, which persists nothing and cannot be restored at all — the same
   * line of code with a much larger blast radius.
   */
  function save(room: GameRoom): void {
    void rooms.persist(room).catch((error: unknown) => {
      console.error('[acquire] save failed', error);
    });
  }

  /** The one send site. Everything a client ever sees is projected here. */
  function sendState(room: GameRoom, playerId: string, reason: StateReason): void {
    // A draft belongs to exactly one player: the one the game is waiting on.
    // `reset` follows a rejection, and a rejection can be addressed to someone
    // who is *not* the actor — an out-of-turn intent, or an undo from the
    // wrong player. Sending them the draft hands over the actor's uncommitted
    // board, cash and log, which is the leak this rule exists to prevent.
    // They get the committed state: it is what they already had, which is what
    // "reset" should mean for them.
    //
    // `resume` rides the same rule, and that is the point of it being a
    // separate reason: a reconnecting actor is by definition the player the
    // game is waiting on, so they get their own open draft back, and every
    // other reconnecting player gets the committed state — the same privacy
    // boundary, applied to a new arrival rather than a rejection.
    const ownsDraft = reason !== 'commit' && playerId === room.actorId();
    const source = ownsDraft ? room.draft() : room.committed();
    const message: StateMessage = {
      state: project(source, playerId),
      reason,
      segmentStart: room.segmentStart(),
      previousSegmentStart: room.previousSegmentStart(),
    };
    for (const socket of lobby.socketsFor(room.id, playerId)) {
      socket.emit(GAME_SERVER_EVENTS.state, message);
    }
  }

  /**
   * Turns the room's verdict into sends.
   *
   * A commit is the only thing the whole table hears. Corrections and
   * rejections go to one player, which is what keeps an open segment private:
   * there is no branch here that broadcasts a draft.
   */
  function deliver(room: GameRoom, delivery: Delivery): void {
    switch (delivery.kind) {
      case 'none':
        return;
      case 'commit':
        for (const p of room.players) sendState(room, p.id, 'commit');
        save(room);
        // After the sends: the notifier's debounce re-checks presence when it
        // fires, so a player who hears this commit on a live socket is never
        // notified at all.
        notifier?.turnChanged(room.id, room.actorId(), String(room.segmentStart()));
        return;
      case 'correction':
        sendState(room, delivery.to, 'correction');
        return;
      case 'rejected':
        for (const socket of lobby.socketsFor(room.id, delivery.to)) {
          socket.emit(LOBBY_SERVER_EVENTS.rejected, { code: delivery.code, message: delivery.message });
        }
        sendState(room, delivery.to, 'reset');
        return;
    }
  }

  io.on('connection', (socket) => {
    // Guard first: it patches `on`, so it covers every handler registered
    // after it — the lobby's included, which nothing here could otherwise
    // reach, and `ping-settle` too, which hundreds of tests order their
    // assertions with and which therefore belongs inside the boundary rather
    // than beside it.
    guardSocket(socket, 'acquire');

    /**
     * Answers immediately, and does nothing else.
     *
     * socket.io delivers a connection's messages in order, so an acknowledged
     * round trip that arrives after an intent proves the intent was handled.
     * Tests need this because the accepted mid-segment path is deliberately
     * silent — there is no reply to await, and without an ordering point an
     * assertion runs before the server has processed anything and passes
     * vacuously.
     */
    socket.on('ping-settle', (ack: () => void) => { if (typeof ack === 'function') ack(); });

    lobby.attach(socket);

    socket.on(GAME_CLIENT_EVENTS.intent, (wire: WireIntent) => {
      const bound = lobby.seatOf(socket.id);
      const room = bound && rooms.get(bound.roomId);
      if (!bound || !room) return;
      if (room.lifecycle() === 'lobby') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'wrongStage',
          message: 'the game has not begun',
        });
        return;
      }
      // `bound.playerId` — never anything the client sent. The wire type has no
      // `playerId` field for it to have sent one in.
      //
      // A missing or wholly malformed `wire` is not the hazard here — that
      // spreads as `{...undefined}`, which is `{}`, and the engine's
      // `applyIntent` rejects an object with no recognised `type` through its
      // own default branch. The hazard is a payload with a *valid* `type` and
      // a malformed field: `{ type: 'buyShares' }` with no `picks`, or
      // `{ type: 'tradeInDeadTiles', coords: 5 }`. Every such handler in
      // `engine/intents.ts` dereferences that field before validating it
      // (`.length`, a `for...of`, a spread into `Set`), which throws
      // synchronously. The host's socket guard now contains such a throw
      // rather than letting it end the process — but this check is what turns
      // it into a clean rejection with a reason, which a contained crash is
      // not. Defence in depth, and this is the layer that can say why.
      if (!isWireIntent(wire)) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'unknownIntent',
          message: 'malformed intent payload',
        });
        return;
      }
      deliver(room, room.dispatch(bound.playerId, wire));
    });

    socket.on(GAME_CLIENT_EVENTS.undo, (msg: UndoMessage) => {
      const bound = lobby.seatOf(socket.id);
      const room = bound && rooms.get(bound.roomId);
      if (!bound || !room) return;
      if (room.lifecycle() === 'lobby') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'wrongStage',
          message: 'the game has not begun',
        });
        return;
      }
      if (typeof msg?.stepId !== 'number') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'undoOutOfSegment',
          message: 'undo requires a numeric stepId',
        });
        return;
      }
      deliver(room, room.undo(bound.playerId, msg.stepId));
    });
  });

  return {
    rooms,
    devSeed,
    game: {
      basePath: BASE_PATH,
      title: TITLE,
      version: () => ({ protocolVersion: PROTOCOL_VERSION, saveVersion: SAVE_VERSION }),
      io,
      async close() {
        // Saves before sockets. Handlers do not await persist, so a room
        // whose last commit is still being written would otherwise be
        // restored a move behind — or not at all. Rail Baron drained from
        // its first day; Acquire gained this on 2026-08-20, when the store
        // moved to @game-host/room-store and closeDrains.test.ts went red
        // against the old close.
        await store.settled();
        // Not io.close(): that would close the HTTP server, which composed
        // belongs to the host and to two other games. See close.ts.
        closeSockets(io);
      },
    },
  };
}

/**
 * Acquire alone in a process: its own app, its own HTTP server, and the bare
 * `/health` that only makes sense that way.
 *
 * A host with one game in it. Deliberately does *not* restore — the boot
 * block below owns that, and `recovery.test.ts` calls `rooms.restore()`
 * itself on a second server to prove a save survives a restart. `mount` is
 * where the restore is awaited, because that is where it can be.
 */
export function createServer(options: ServerOptions = {}): ServerHandle {
  const app = express();
  // Unreachable through the front door, which forwards only the prefix — but
  // it is how `curl localhost:4002/health` answers, and that is the situation
  // you are in when you are asking. Composed, the host owns this route and
  // answers for all three games at once.
  app.get('/health', health);

  const httpServer = createHttpServer(app);
  const built = build(app, httpServer, options.store ?? createNullStore(), {
    distDir: options.distDir,
    socketPath: options.socketPath,
  });

  return {
    app,
    httpServer,
    io: built.game.io,
    rooms: built.rooms,
    devSeed: built.devSeed,
    game: built.game,
  };
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Where rooms are persisted.
 *
 * `server/games/` is right for development and wrong for the deployment: on
 * Render that path lives on the instance's ephemeral filesystem, so every
 * deploy and every restart empties it. That — not the plan, and not any
 * shortcoming of the file store — is why the gone-room ending is the *normal*
 * prod case rather than an edge one.
 *
 * `GAMES_DIR` points it at a mounted persistent disk instead, which turns out
 * to be the whole change: the file store was already durable, it was simply
 * writing somewhere that is not. No second `RoomStore` implementation is
 * needed unless a disk proves insufficient. `createFileStore` creates the
 * directory itself, so the mount point needs no preparation.
 *
 * Exported, and taking its environment as an argument, so the fallback is
 * testable — it is reached only from the run-directly block below, which no
 * test executes. Composed, the host allocates `${DATA_DIR}/acquire` and hands
 * it to `mount` instead, and this function goes with the boot block.
 */
export function gamesDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GAMES_DIR?.trim();
  return configured ? configured : join(process.cwd(), 'server', 'games');
}

// Started only when run directly, so tests can boot their own on port 0.
if (process.argv[1]?.endsWith('index.ts')) {
  const store = createFileStore(gamesDir());
  // SOCKET_PATH is read here, not inside createServer, so a test server's
  // mount can never be moved by ambient env — same seam as PORT below and
  // GAMES_DIR above. Only Render sets it (to /socket.io); the dev:server
  // script leaves it unset, so local runs fall through to createServer's
  // prefixed default.
  const { httpServer, io, rooms, devSeed } = createServer({ store, socketPath: process.env.SOCKET_PATH });
  // 4002 is Acquire's slot in the cross-game port registry (the game-host
  // repo's PORTS.md). Render injects PORT, so this default is local-only.
  // Must agree with vite.config.ts's dev proxy target.
  const port = Number(process.env.PORT ?? 4002);

  // launchd/`brew services stop` speak SIGTERM, Ctrl-C speaks SIGINT.
  // Persists are awaited inside handlers, so closing the sockets and the
  // listener is enough for an orderly exit; a second signal skips the wait.
  let closing = false;
  const stop = (): void => {
    if (closing) process.exit(1);
    closing = true;
    // Deliberately not awaited: the callback is what exits, and socket.io's
    // close() returning a promise is a 4.x signature detail, not a wait we
    // owe anyone. Persists are already awaited inside the handlers above.
    void io.close(() => { process.exit(0); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  // Before `listen`, not after: a client that connects into a half-restored
  // registry would be told its room does not exist and would clear the very
  // identity that was about to work.
  //
  // `listen` runs whichever way `restore()` settles — inside `.then` on
  // success, inside `.catch` on rejection — so a restore failure can never
  // keep the process from booting. `restore()` already guards each *record*
  // (see `rooms.ts`), but the store read underneath it (`loadAll`, or a
  // future store implementation) is not guarded the same way, and an
  // ungated `.then` here would mean the one unhandled rejection of a boot
  // takes the whole server down with no `listen` and no log line.
  void rooms.restore()
    .then((count) => {
      if (count > 0) console.log(`✓ Restored ${count} room(s)`);
    })
    .catch((e: unknown) => {
      console.warn('! Restore failed, starting with no rooms:', e);
    })
    .finally(() => {
      // The socket path is in the banner because a misconfigured SOCKET_PATH
      // — most concretely, a Render deploy that fails to set it to
      // /socket.io — leaves clients unable to connect with no other visible
      // symptom, and this line is where that mismatch would show itself.
      // `devSeed` joins the socket path here for the same reason it is: a
      // process whose environment no longer matches its code has no other
      // visible symptom, and this line reprints on every watch reload.
      httpServer.listen(port, () =>
        console.log(
          `✓ Server listening on ${port}, sockets at ${io.path()}, dev seed ${devSeed ? 'on' : 'off'}`
        ));
    });
}
