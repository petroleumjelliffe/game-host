// The game half of the socket wire: inputs in, snapshots and events out, and
// the 20Hz loop per room. All rules live in game.ts/sim.ts — this file only
// routes bytes and enforces WHO may say what (marco calls, host advances).

import type { Server as SocketServer, Socket } from 'socket.io';
import { guardTick } from '@game-host/host/guard.js';
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol.js';
import type { LobbyRegistry } from '@game-host/lobby/server/rooms.js';
import type { LobbyWiring } from '@game-host/lobby/server/handlers.js';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  MIN_PLAYERS,
  TUNING,
  type GameEvent,
  type GameEventEnvelope,
} from '../protocol/game.js';
import { snapshotFor } from './snapshot.js';
import { applyInput, tryCall } from './sim/sim.js';
import { startMatch, startNextRound, stepRound, type MarcoPoloRoom } from './game.js';

export interface GameWiring {
  begin(room: MarcoPoloRoom): void;
  seat(room: MarcoPoloRoom, playerId: string): void;
  attach(socket: Socket): void;
  stop(): void;
}

export function createGameHandlers(
  io: SocketServer,
  registry: Pick<LobbyRegistry<MarcoPoloRoom>, 'get'>,
  wiring: LobbyWiring<MarcoPoloRoom>,
  opts: { tickMs?: number } = {},
): GameWiring {
  const tickMs = opts.tickMs ?? 1000 / TUNING.tickHz;
  const loops = new Map<string, NodeJS.Timeout>();

  function broadcastSnapshots(room: MarcoPoloRoom): void {
    // Per-socket, not per-room: every player's snapshot differs (their own
    // meter at least, and Marco's is missing everyone).
    for (const socket of io.sockets.sockets.values()) {
      const b = wiring.seatOf(socket.id);
      if (b?.roomId === room.id) {
        socket.emit(GAME_SERVER_EVENTS.state, snapshotFor(room, b.playerId));
      }
    }
  }

  function emitEvents(room: MarcoPoloRoom, events: GameEvent[]): void {
    for (const ev of events) {
      io.to(room.id).emit(GAME_SERVER_EVENTS.event, {
        roomId: room.id,
        event: ev,
      } satisfies GameEventEnvelope);
    }
  }

  function startLoop(room: MarcoPoloRoom): void {
    if (loops.has(room.id)) return;
    loops.set(
      room.id,
      // guardTick because this is the one entry point a socket guard cannot
      // see: a throw inside a timer callback reaches nothing but the top of
      // the stack, and composed that ends Rail Baron's and Acquire's evening
      // too. 20 times a second per active room makes it the likeliest place
      // for one to happen, not the least.
      setInterval(guardTick('marcopolo', () => {
        emitEvents(room, stepRound(room, tickMs / 1000));
        broadcastSnapshots(room);
        // The round just ended: one final snapshot/event pair already went
        // out above (so clients render the final positions plus the
        // betweenRounds phase) — now pause until nextRound restarts us.
        if (room.between) {
          clearInterval(loops.get(room.id));
          loops.delete(room.id);
        }
      }), tickMs),
    );
  }

  function begin(room: MarcoPoloRoom): void {
    if (room.begun) return;
    if (room.players.length < MIN_PLAYERS) {
      const host = room.players.find((p) => p.isHost);
      for (const s of host ? wiring.socketsFor(room.id, host.id) : []) {
        s.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'notEnoughPlayers',
          message: `Marco Polo needs at least ${MIN_PLAYERS} players`,
        });
      }
      return;
    }
    emitEvents(room, [startMatch(room)]);
    wiring.broadcastRoster(room);
    broadcastSnapshots(room);
    startLoop(room);
  }

  function seat(room: MarcoPoloRoom, playerId: string): void {
    if (!room.begun || !room.sim) return;
    for (const s of wiring.socketsFor(room.id, playerId)) {
      s.emit(GAME_SERVER_EVENTS.state, snapshotFor(room, playerId));
    }
  }

  function boundRoom(socket: Socket): { room: MarcoPoloRoom; playerId: string } | null {
    const b = wiring.seatOf(socket.id);
    const room = b && registry.get(b.roomId);
    return room ? { room, playerId: b.playerId } : null;
  }

  function attach(socket: Socket): void {
    socket.on(GAME_CLIENT_EVENTS.input, (msg: unknown) => {
      const found = boundRoom(socket);
      if (found?.room.sim && !found.room.between) {
        applyInput(found.room.sim, found.playerId, msg);
      }
    });

    socket.on(GAME_CLIENT_EVENTS.call, () => {
      const found = boundRoom(socket);
      if (!found?.room.sim || found.room.between) return;
      if (found.playerId !== found.room.sim.marcoId) return; // polos have no MARCO
      const ev = tryCall(found.room.sim);
      if (ev) emitEvents(found.room, [ev]);
    });

    socket.on(GAME_CLIENT_EVENTS.nextRound, () => {
      const found = boundRoom(socket);
      if (!found) return;
      const host = found.room.players.find((p) => p.isHost);
      if (host?.id !== found.playerId) return;
      const ev = startNextRound(found.room);
      if (ev) {
        emitEvents(found.room, [ev]);
        broadcastSnapshots(found.room);
        startLoop(found.room);
      }
    });

    // Registered before the lobby's own disconnect handler (see app.ts):
    // that one deletes the binding this one reads. A vanished player stops
    // swimming and floats in place, still catchable.
    socket.on('disconnect', () => {
      const found = boundRoom(socket);
      if (found?.room.sim && !found.room.between) {
        applyInput(found.room.sim, found.playerId, { tx: null, ty: null, turbo: false });
      }
    });
  }

  return {
    begin,
    seat,
    attach,
    stop() {
      for (const loop of loops.values()) clearInterval(loop);
      loops.clear();
    },
  };
}
