// server/index.ts
// Transport only. The room decides what happened; this file decides who
// hears about it, and is the single place `viewFor` is ever called with a
// live room's state.
//
// Two entry points, same as the other games: `mount` adds this game to an
// app and an HTTP server it does not own; `createServer` owns both and adds
// back the bare `/health` that only makes sense alone in a process.

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
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol.js';
import { createLobbyHandlers } from '@game-host/lobby/server/handlers.js';
import { loadEnableDictionary, type Dictionary } from '../engine/dictionary.js';
import { viewFor } from '../session/view.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  PROTOCOL_VERSION,
  isWireMove,
  type MoveRejectedMessage,
  type StateMessage,
  type StateReason,
} from '../session/protocol.js';
import type { Delivery, GameRoom } from './room.js';
import { createRoomRegistry, type RoomRegistry } from './rooms.js';
import { createFileStore, createNullStore, SAVE_VERSION, type RoomStore } from './store.js';

/** How the menu names this game. Neutral by design — see the spec's non-goals. */
const TITLE = 'Word Game';

export interface ServerOptions {
  store?: RoomStore;
  distDir?: string;
  socketPath?: string;
  /** Tests hand in a tiny dictionary; production loads ENABLE once. */
  dictionary?: Dictionary;
}

export interface ServerHandle {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer;
  rooms: RoomRegistry;
  game: MountedGame;
}

interface Built {
  game: MountedGame;
  rooms: RoomRegistry;
}

// `import.meta.resolve`, not `import.meta.url`: the composed host is shipped
// as one esbuild bundle and a bundle erases module locations, but the
// package.json stays where npm put it. Same pattern as every other game.
const DEFAULT_DIST = join(
  fileURLToPath(import.meta.resolve('@game-host/wordgame/package.json')),
  '..',
  'dist',
);

function health(_req: Request, res: Response): void {
  res.json({ ok: true, protocolVersion: PROTOCOL_VERSION, saveVersion: SAVE_VERSION });
}

/**
 * Adds the word game to somebody else's app and HTTP server. The restore is
 * awaited here, before the host listens, so no socket can race a
 * half-restored registry.
 */
export async function mount(ctx: HostContext): Promise<MountedGame> {
  const store = ctx.dataDir === undefined ? createNullStore() : createFileStore(ctx.dataDir);
  const built = build(ctx.app, ctx.httpServer, store, { notify: ctx.notify });
  try {
    const restored = await built.rooms.restore();
    if (restored > 0) console.log(`✓ Restored ${restored} word game room(s)`);
  } catch (e: unknown) {
    console.warn('! Word game restore failed, starting with no rooms:', e);
  }
  return built.game;
}

function build(
  app: express.Express,
  httpServer: HttpServer,
  store: RoomStore,
  options: Pick<ServerOptions, 'distDir' | 'socketPath' | 'dictionary'> & { notify?: TurnNotifier },
): Built {
  // Twinned under the base path: the only route the front door forwards.
  app.get(`${BASE_PATH}/health`, health);

  const dist = options.distDir ?? DEFAULT_DIST;
  if (existsSync(join(dist, 'index.html'))) {
    app.use(BASE_PATH, express.static(dist));
    // SPA fallback, prefix-scoped — unscoped it would answer for the other
    // games and the menu.
    app.use(BASE_PATH, (req, res, next) => {
      if (req.method !== 'GET') { next(); return; }
      res.sendFile(join(dist, 'index.html'));
    });
    console.log(`Serving built client at ${BASE_PATH}/ from ${dist}`);
  } else {
    console.log(`No built client (${join(dist, 'index.html')} missing) — ${BASE_PATH}/ not served.`);
  }

  const io = new SocketServer(httpServer, {
    path: options.socketPath ?? `${BASE_PATH}/socket.io`,
    // Both flags are mandatory for a game sharing an HTTP server; the story
    // is with Acquire's copy of these lines and in the composition plan.
    destroyUpgrade: false,
    serveClient: false,
  });

  // ENABLE loads once per process (the engine memoises it) and only when the
  // first server is built without an injected dictionary.
  const dictionary = options.dictionary ?? loadEnableDictionary();
  const rooms = createRoomRegistry(store, dictionary);

  // Turn notifications, when the host runs the service. `moveCount` is the
  // turnKey: it increments on every applied move, so it is distinct per turn
  // and survives a restart inside the saved state.
  const notifier: GameTurnReporter | undefined = options.notify?.registerGame({
    gameId: 'wordgame',
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
      // A reconnecting player gets their own view back — their rack rides
      // this message and nobody else's ever could (viewFor cannot represent
      // another player's rack), which covers the rejoin path of the
      // no-leaks rule as structurally as the broadcast path.
      if (room.lifecycle() !== 'lobby') sendState(room, playerId, 'resume');
    },
    // Every durable seating change hits the disk, so a deploy between
    // "friends joined by the shared link" and "host pressed start" cannot
    // eat the room — the lobby's version of one-move-apart.
    onRosterChanged: (room) => save(room),
  });

  function save(room: GameRoom): void {
    void rooms.persist(room).catch((error: unknown) => {
      console.error('[wordgame] save failed', error);
    });
  }

  /** The one send site. Everything a client ever sees goes through viewFor. */
  function sendState(room: GameRoom, playerId: string, reason: StateReason): void {
    const state = room.state();
    if (state === null) return;
    const message: StateMessage = { view: viewFor(state, playerId), reason };
    for (const socket of lobby.socketsFor(room.id, playerId)) {
      socket.emit(GAME_SERVER_EVENTS.state, message);
    }
  }

  function deliver(room: GameRoom, delivery: Delivery): void {
    switch (delivery.kind) {
      case 'none':
        return;
      case 'commit': {
        for (const p of room.players) sendState(room, p.id, 'commit');
        // Persist on every applied move: a multi-day game and a restart must
        // never be more than one move apart.
        save(room);
        notifier?.turnChanged(
          room.id,
          room.actorId(),
          String(room.state()?.moveCount ?? 0),
        );
        return;
      }
      case 'rejected': {
        const message: MoveRejectedMessage = {
          code: delivery.code,
          message: delivery.message,
        };
        if (delivery.words !== undefined) message.words = delivery.words;
        for (const socket of lobby.socketsFor(room.id, delivery.to)) {
          socket.emit(LOBBY_SERVER_EVENTS.rejected, message);
        }
        return;
      }
    }
  }

  io.on('connection', (socket) => {
    // Guard first: it patches `on`, so it covers every handler registered
    // after it, the lobby's included.
    guardSocket(socket, 'wordgame');

    socket.on('ping-settle', (ack: unknown) => {
      if (typeof ack === 'function') (ack as () => void)();
    });

    lobby.attach(socket);

    socket.on(GAME_CLIENT_EVENTS.move, (raw: unknown) => {
      const bound = lobby.seatOf(socket.id);
      if (!bound) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'notSeated',
          message: 'Join a room before moving.',
        });
        return;
      }
      const room = rooms.get(bound.roomId);
      if (!room) return;
      if (!isWireMove(raw)) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'badMove',
          message: 'That move is not one this server understands.',
        });
        return;
      }
      deliver(room, room.dispatch(bound.playerId, raw));
    });
  });

  return {
    rooms,
    game: {
      basePath: BASE_PATH,
      title: TITLE,
      version: () => ({ protocolVersion: PROTOCOL_VERSION, saveVersion: SAVE_VERSION }),
      io,
      async close() {
        // Saves before sockets, so a room whose last commit is still being
        // written is not restored a move behind.
        await rooms.settled();
        closeSockets(io);
      },
    },
  };
}

/** The word game alone in a process — dev, and the standalone tests. */
export function createServer(options: ServerOptions = {}): ServerHandle {
  const app = express();
  app.get('/health', health);
  const httpServer = createHttpServer(app);
  const built = build(app, httpServer, options.store ?? createNullStore(), {
    distDir: options.distDir,
    socketPath: options.socketPath,
    dictionary: options.dictionary,
  });
  return { app, httpServer, io: built.game.io, rooms: built.rooms, game: built.game };
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function gamesDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GAMES_DIR?.trim();
  return configured ? configured : join(process.cwd(), 'server', 'games');
}

// Started only when run directly, so tests can boot their own on port 0.
if (process.argv[1]?.endsWith('index.ts')) {
  const store = createFileStore(gamesDir());
  const { httpServer, io, rooms } = createServer({ store, socketPath: process.env.SOCKET_PATH });
  // 4004 is this game's slot in the cross-game port registry (PORTS.md).
  const port = Number(process.env.PORT ?? 4004);

  let closing = false;
  const stop = (): void => {
    if (closing) process.exit(1);
    closing = true;
    void io.close(() => { process.exit(0); });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  // Restore before listen, listen either way it settles.
  rooms
    .restore()
    .then((count) => {
      if (count > 0) console.log(`✓ Restored ${count} room(s)`);
    })
    .catch((error: unknown) => {
      console.warn('! Restore failed, starting with no rooms:', error);
    })
    .finally(() => {
      httpServer.listen(port, () => {
        console.log(`Word game server listening on ${port} (sockets at ${io.path()})`);
      });
    });
}
