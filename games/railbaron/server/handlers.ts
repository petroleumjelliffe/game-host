// server/handlers.ts
// The two game handlers. Everything they decide is decided by legal.ts —
// these translate a socket message into (log, event, sender) and the answer
// back into a broadcast or a refusal.
import type { Server as SocketServer, Socket } from 'socket.io';
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS,
  type AppendMessage, type LogMessage,
} from '../session/protocol';
import { isGameEvent, SEATS, type SeatId } from '../src/state/events';
import { undo } from '../src/state/game';
import { appendLegality, undoLegality } from '../src/state/legal';
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol';
import type { LobbyWiring } from '@game-host/lobby/server/handlers';
import type { GameRoom, Rooms } from './rooms';

const asSeat = (id: string): SeatId | undefined => SEATS.find((s) => s === id);

export function attachGameHandlers(
  io: SocketServer, rooms: Rooms, wiring: LobbyWiring<GameRoom>,
): (socket: Socket) => void {
  function broadcastLog(room: GameRoom): void {
    const msg: LogMessage = { roomId: room.id, events: room.log };
    io.to(room.id).emit(GAME_SERVER_EVENTS.log, msg);
  }

  /**
   * Save without waiting — a player should not wait on a disk — but not
   * without handling the failure.
   *
   * A bare `void rooms.persist(room)` is a floating promise, and an unhandled
   * rejection ends the process. Alone that cost Rail Baron a restart it
   * recovers from, since the rooms are on disk. Composed it ends a live Marco
   * Polo round, which persists nothing and cannot be restored at all — the
   * same line of code with a much larger blast radius.
   *
   * `settled()` still sees the save, so `close()` drains it either way.
   */
  function save(room: GameRoom): void {
    void rooms.persist(room).catch((error: unknown) => {
      console.error('[railbaron] save failed', error);
    });
  }

  return (socket: Socket) => {
    const refused = (code: string, message: string): void => {
      socket.emit(LOBBY_SERVER_EVENTS.rejected, { code, message });
    };

    /**
     * The room and seat this socket is bound to, or null after refusing. The
     * client never says which room it means — the binding does, which is what
     * makes speaking for someone else unrepresentable rather than merely
     * checked for.
     */
    function situate(): { room: GameRoom; seat: SeatId } | null {
      const bound = wiring.seatOf(socket.id);
      const room = bound && rooms.registry.get(bound.roomId);
      if (!bound || !room) {
        refused('notConnected', 'join a room first');
        return null;
      }
      const seat = asSeat(bound.playerId);
      if (seat === undefined) {
        refused('notConnected', 'no seat bound');
        return null;
      }
      return { room, seat };
    }

    socket.on(GAME_CLIENT_EVENTS.append, (msg: AppendMessage) => {
      const here = situate();
      if (here === null) return;
      // The payload is untrusted text typed only by wishful thinking. A
      // malformed event must become a refusal, never a throw: socket.io does
      // not catch a synchronous throw from a listener, so one bad append would
      // take the process down for every room in it.
      if (!isGameEvent(msg?.event)) {
        refused('malformedEvent', 'that is not a game event');
        return;
      }
      const illegal = appendLegality(here.room.log, msg.event, here.seat);
      if (illegal !== null) {
        refused(illegal.code, illegal.message);
        return;
      }
      here.room.log.push(msg.event);
      save(here.room);
      broadcastLog(here.room);
      // No roster send: the lifecycle only changes at Begin, which broadcasts
      // its own roster. Nothing a client may append moves a room out of the
      // lobby — `started` is the server's alone.
    });

    socket.on(GAME_CLIENT_EVENTS.undo, () => {
      const here = situate();
      if (here === null) return;
      const illegal = undoLegality(here.room.log, here.seat);
      if (illegal !== null) {
        refused(illegal.code, illegal.message);
        return;
      }
      // One tap takes back one player action, which is often several events —
      // the game's own undo() owns that rule, and asking it here is what keeps
      // the wire agreeing with pass-and-play about what a turn is.
      here.room.log = undo(here.room.log);
      save(here.room);
      broadcastLog(here.room);
    });
  };
}
