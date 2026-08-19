// Assembly only: express static + socket.io + lobby wiring + game wiring.

import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { createLobbyRegistry, type SeatSpace } from '@game-host/lobby/server/rooms.js';
import { createLobbyHandlers, type LobbyHooks } from '@game-host/lobby/server/handlers.js';
import { PROTOCOL_VERSION, SEAT_IDS } from '../protocol/game.js';
import { makeRoom, type MarcoPoloRoom } from './game.js';
import { createGameHandlers } from './gameHandlers.js';

// The proxy path the game-host repo's Caddyfile routes; the client is built
// with base '/marcopolo/' to match.
const BASE_PATH = '/marcopolo';

/**
 * Where socket.io mounts: the same front-door route as pages and assets, so
 * one proxied prefix carries the whole game — this retires the root
 * /socket.io claim in game-host's Caddyfile. A constant, not a knob: Marco
 * Polo has no remote deploy, so nothing needs to move it. Exported for the
 * wire suite — its clients must ask for this path or hang on socket.io's
 * bare default.
 */
export const SOCKET_PATH = `${BASE_PATH}/socket.io`;

export function createAppServer(): {
  httpServer: HttpServer;
  io: SocketServer;
  stop(): Promise<void>;
} {
  const app = express();
  // "Which server is this?" has to be answerable without reading a deploy
  // log. Twinned under the base path because that prefix is the only route
  // the game-host front door forwards — a bare /health is unreachable
  // through the proxy. No save version here: Marco Polo persists nothing.
  const health = (_req: express.Request, res: express.Response): void => {
    res.json({ ok: true, protocolVersion: PROTOCOL_VERSION });
  };
  app.get('/health', health);
  app.get(`${BASE_PATH}/health`, health);
  // The built client, mounted at its base path — and at the root too, so
  // hitting the bare port still lands on the game: `/` serves index.html,
  // whose asset URLs resolve via the prefixed mount.
  const dist = join(dirname(fileURLToPath(import.meta.url)), '../client/dist');
  app.use(BASE_PATH, express.static(dist));
  app.use(express.static(dist));
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { path: SOCKET_PATH });

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
    // Game first: its disconnect handler must read the seat binding before
    // the lobby's disconnect handler deletes it. Do not reorder.
    game.attach(socket);
    wiring.attach(socket);
  });

  return {
    httpServer,
    io,
    async stop() {
      game.stop();
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
