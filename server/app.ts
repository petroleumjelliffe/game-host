// Assembly only: express static + socket.io + lobby wiring + game wiring.

import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { createLobbyRegistry, type SeatSpace } from '../vendor/lobby/server/rooms.js';
import { createLobbyHandlers, type LobbyHooks } from '../vendor/lobby/server/handlers.js';
import { PROTOCOL_VERSION, SEAT_IDS } from '../protocol/game.js';
import { makeRoom, type MarcoPoloRoom } from './game.js';
import { createGameHandlers } from './gameHandlers.js';

export function createAppServer(): {
  httpServer: HttpServer;
  io: SocketServer;
  stop(): Promise<void>;
} {
  const app = express();
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '../client/dist')));
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer);

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
