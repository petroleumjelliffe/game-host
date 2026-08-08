// server/lobby/handlers.ts
// The five lobby socket handlers plus the disconnect presence handler, and
// the socket<->seat bindings they share. Generic over the room the game
// builds: this file only ever touches what `LobbyRoomLike` promises.

import type { Server as SocketServer, Socket } from 'socket.io';
import {
  LOBBY_CLIENT_EVENTS,
  LOBBY_SERVER_EVENTS,
  type CreateRoomMessage,
  type JoinRoomMessage,
  type JoinedMessage,
  type RenamePlayerMessage,
  type RosterMessage,
} from '../../lobby/protocol.js';
import type { LobbyRegistry, LobbyRoomLike, Seated } from './rooms.js';

/** Which room and seat a socket is bound to. The client never says. */
export interface SeatBinding {
  roomId: string;
  playerId: string;
}

export interface LobbyHooks<R extends LobbyRoomLike> {
  protocolVersion: number;
  /**
   * The host pressed begin; the lobby has already verified host and
   * lifecycle. The game starts itself and owns the send order — call
   * `wiring.broadcastRoster` yourself when the moment is right.
   */
  onBegin(room: R): void;
  /** A socket was seated (first join or rejoin), `joined` + roster already sent. */
  onSeated(room: R, playerId: string): void;
}

export interface LobbyWiring<R extends LobbyRoomLike> {
  seatOf(socketId: string): SeatBinding | undefined;
  socketsFor(roomId: string, playerId: string): Socket[];
  broadcastRoster(room: R): void;
  /** Register the lobby's handlers on one connection. Call from io.on('connection'). */
  attach(socket: Socket): void;
}

export function createLobbyHandlers<R extends LobbyRoomLike>(
  io: SocketServer,
  registry: Pick<LobbyRegistry<R>, 'create' | 'join' | 'get'>,
  hooks: LobbyHooks<R>,
): LobbyWiring<R> {
  const bindings = new Map<string, SeatBinding>();

  function socketsFor(roomId: string, playerId: string): Socket[] {
    return [...io.sockets.sockets.values()].filter((s) => {
      const b = bindings.get(s.id);
      return b?.roomId === roomId && b.playerId === playerId;
    });
  }

  function roster(room: R): RosterMessage {
    return {
      roomId: room.id,
      lifecycle: room.lifecycle(),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
      })),
    };
  }

  function broadcastRoster(room: R): void {
    io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(room));
  }

  function attach(socket: Socket): void {
    /**
     * Whether this client speaks our protocol, answering the socket if not.
     *
     * Equality, not "at least": the client ships to GitHub Pages and the
     * server to Render, independently, so the client can perfectly well be
     * the *newer* side. A `>=` check here would wave that case through and
     * then fail somewhere deep in a handler, presenting as a game bug.
     *
     * Absent is a mismatch. Clients built before this existed send nothing,
     * and they are precisely what this is for.
     */
    function speaksOurProtocol(version: unknown): boolean {
      if (version === hooks.protocolVersion) return true;
      socket.emit(LOBBY_SERVER_EVENTS.rejected, {
        code: 'versionMismatch',
        message:
          `This client speaks protocol ${String(version)}; this server speaks ${hooks.protocolVersion}`,
      });
      return false;
    }

    socket.on(LOBBY_CLIENT_EVENTS.createRoom, (msg: CreateRoomMessage) => {
      // Before the shape check below, and before anything is created: a
      // client we cannot talk to must not leave a room behind, because an
      // abandoned room is persisted and restored at the next boot.
      if (!speaksOurProtocol(msg?.protocolVersion)) return;

      // `msg` is whatever the client sent, typed only by wishful thinking —
      // a malformed or missing payload dereferenced below would throw
      // synchronously inside this listener and take the whole process down
      // for every room, not just this connection. This socket has not even
      // bound to a room yet, so any connecting client can reach this line.
      // An *absent* name is ordinary — no card asks for one before seating
      // you, and `rooms.create` names you by your seat. A name of the wrong
      // *type* is still a malformed payload and still refused: this listener
      // is reachable by any connected socket before it has bound to a room,
      // so a throw here takes down every room in the process, not just this
      // connection.
      if (msg?.name !== undefined && typeof msg.name !== 'string') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'unknownIntent',
          message: 'createRoom name must be text',
        });
        return;
      }

      const { room, player } = registry.create(msg.name);
      bindings.set(socket.id, { roomId: room.id, playerId: player.id });
      void socket.join(room.id);

      const joined: JoinedMessage = { roomId: room.id, playerId: player.id, token: player.token };
      socket.emit(LOBBY_SERVER_EVENTS.joined, joined);
      io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(room));
    });

    socket.on(LOBBY_CLIENT_EVENTS.joinRoom, (msg: JoinRoomMessage) => {
      // Before the room lookup, so a stale client is told it is stale rather
      // than told the room does not exist — which would send the player
      // hunting for a room that is perfectly fine.
      if (!speaksOurProtocol(msg?.protocolVersion)) return;

      // Same shape hazard as `createRoom`, above: this socket has not bound
      // to anything yet either, so a malformed payload here is just as
      // reachable by any connecting client.
      // The roomId is still required — there is nothing to look up without
      // it. The name is not, for the same reason as `createRoom` above, and
      // a non-string one is refused for the same reason too.
      if (typeof msg?.roomId !== 'string' || (msg.name !== undefined && typeof msg.name !== 'string')) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'unknownIntent',
          message: 'joinRoom requires a roomId, and a name must be text if given',
        });
        return;
      }

      const target = registry.get(msg.roomId);
      if (!target) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'noSuchRoom',
          message: `Room ${msg.roomId} is no longer available`,
        });
        return;
      }

      // One socket holds one seat per room.
      //
      // A `joinRoom` with no `playerId`/`token` seats a *new* player — that is
      // what makes a first join work, and it is why a second one from the same
      // socket used to seat a second. Found by hand: two browsers produced a
      // three-player roster, and the orphaned seat is one the game waits on
      // forever when its turn comes, because nobody is behind it.
      //
      // A client cannot reliably prevent this on its own. It has no token to
      // present until its own `joined` reply lands, so a socket blip during
      // that window leaves it re-joining as a stranger with no way to say who
      // it already is. The binding this server already keeps is the answer:
      // if this socket is bound to a seat in the room it is asking to join,
      // that seat is the answer to the request.
      let seat: Seated<R> | null = null;
      const bound = bindings.get(socket.id);
      if (bound && bound.roomId === msg.roomId) {
        const player = target.players.find((p) => p.id === bound.playerId);
        if (player) seat = { room: target, player };
      }

      seat ??= registry.join(msg.roomId, msg.name, msg.playerId, msg.token);

      if (!seat) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'seatRefused',
          message: `That seat in ${msg.roomId} is no longer yours — join again to take a new one`,
        });
        return;
      }

      seat.player.connected = true;

      bindings.set(socket.id, { roomId: seat.room.id, playerId: seat.player.id });
      void socket.join(seat.room.id);

      const joined: JoinedMessage = {
        roomId: seat.room.id,
        playerId: seat.player.id,
        token: seat.player.token,
      };
      socket.emit(LOBBY_SERVER_EVENTS.joined, joined);
      io.to(seat.room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(seat.room));

      hooks.onSeated(seat.room, seat.player.id);
    });

    socket.on(LOBBY_CLIENT_EVENTS.renamePlayer, (msg: RenamePlayerMessage) => {
      const bound = bindings.get(socket.id);
      const room = bound && registry.get(bound.roomId);
      if (!bound || !room) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'notConnected',
          message: 'No seat to rename — join a room first',
        });
        return;
      }
      // Lobby-only: the engine copies names into `GameState` at startGame,
      // and a rename after that leaves the roster and the log disagreeing
      // about who did what.
      if (room.lifecycle() !== 'lobby') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'wrongStage',
          message: 'Names are settled once the game starts',
        });
        return;
      }
      const name = typeof msg?.name === 'string' ? msg.name.trim() : '';
      if (name === '') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'unknownIntent',
          message: 'renamePlayer requires a name',
        });
        return;
      }

      // The binding names the seat; the payload cannot rename anyone else.
      const player = room.players.find((p) => p.id === bound.playerId);
      if (!player) return;
      player.name = name;
      io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(room));
    });

    socket.on(LOBBY_CLIENT_EVENTS.leaveSeat, () => {
      const bound = bindings.get(socket.id);
      const room = bound && registry.get(bound.roomId);
      if (!bound || !room) return;
      // Mid-game leaving is a disconnect, which keeps the seat and marks it
      // away — the game waits. Only a lobby seat can be given up.
      if (room.lifecycle() !== 'lobby') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'wrongStage',
          message: 'A started game keeps its seats — closing the tab is enough',
        });
        return;
      }

      const at = room.players.findIndex((p) => p.id === bound.playerId);
      if (at === -1) return;
      const wasHost = room.players[at].isHost;
      room.players.splice(at, 1);
      // A lobby with no host is a lobby nobody can ever start.
      if (wasHost && room.players.length > 0) room.players[0].isHost = true;

      bindings.delete(socket.id);
      void socket.leave(room.id);
      io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(room));
    });

    socket.on(LOBBY_CLIENT_EVENTS.beginGame, () => {
      const bound = bindings.get(socket.id);
      const room = bound && registry.get(bound.roomId);
      if (!bound || !room) return;

      const host = room.players.find((p) => p.isHost);
      if (host?.id !== bound.playerId) {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'notYourTurn',
          message: 'only the host may begin the game',
        });
        return;
      }

      // `room.dispatch`, `room.undo` and `room.begin` all THROW rather than
      // reject outside their expected lifecycle, and socket.io does not catch
      // a synchronous throw from a listener — an unguarded call here takes
      // the whole process down for every room, not just this one. These three
      // checks (here, and in `intent` and `undo` below) exist to turn that
      // crash into a clean rejection; they are not redundant with anything
      // upstream.
      if (room.lifecycle() !== 'lobby') {
        socket.emit(LOBBY_SERVER_EVENTS.rejected, {
          code: 'wrongStage',
          message: 'the game has already begun',
        });
        return;
      }

      hooks.onBegin(room);
    });

    socket.on('disconnect', () => {
      const bound = bindings.get(socket.id);
      bindings.delete(socket.id);
      if (!bound) return;

      const room = registry.get(bound.roomId);
      if (!room) return;
      // Presence only, and deliberately thin: the game simply waits. Reconnect
      // handling is Phase 4's.
      if (socketsFor(room.id, bound.playerId).length === 0) {
        const player = room.players.find((p) => p.id === bound.playerId);
        if (player) player.connected = false;
        io.to(room.id).emit(LOBBY_SERVER_EVENTS.roster, roster(room));
      }
    });
  }

  return {
    seatOf: (socketId) => bindings.get(socketId),
    socketsFor,
    broadcastRoster,
    attach,
  };
}
