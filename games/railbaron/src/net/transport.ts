// The game half of the socket, hung off the lobby's connection. The lobby
// owns rooms, seats and presence; this owns the log, and the two never touch
// each other's messages.
import {
  GAME_CLIENT_EVENTS, GAME_SERVER_EVENTS,
  type AppendMessage, type LogMessage,
} from '../../session/protocol';
import type { LobbyConnection } from '../../vendor/lobby/client/connection';
import type { GameEvent } from '../state/events';

export interface GameTransport {
  append(event: GameEvent): void;
  undo(): void;
  /** Returns an unsubscribe. */
  onLog(handler: (msg: LogMessage) => void): () => void;
}

export function createGameTransport(connection: LobbyConnection): GameTransport {
  return {
    append(event) {
      const msg: AppendMessage = { event };
      connection.socket.emit(GAME_CLIENT_EVENTS.append, msg);
    },

    undo() {
      connection.socket.emit(GAME_CLIENT_EVENTS.undo);
    },

    onLog(handler) {
      connection.socket.on(GAME_SERVER_EVENTS.log, handler);
      return () => { connection.socket.off(GAME_SERVER_EVENTS.log, handler); };
    },
  };
}
