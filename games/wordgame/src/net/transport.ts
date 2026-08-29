import type { Socket } from 'socket.io-client';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  type MoveRejectedMessage,
  type StateMessage,
  type WireMove,
} from '../../session/protocol';
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol';

/**
 * Everything the game half may do to the network, and nothing else — the
 * lobby half (create, join, roster) belongs to `connection.ts`. Deliberately
 * simpler than Acquire's: no drafts, no undo, one atomic move per turn.
 */
export interface RoomTransport {
  sendMove(move: WireMove): void;
  /** Returns an unsubscribe. */
  onState(handler: (msg: StateMessage) => void): () => void;
  /**
   * Returns an unsubscribe. Shares the socket's `rejected` event with the
   * lobby connection's `onRejected` — one channel, two subscribers. The
   * lobby side branches on its own codes (`noSuchRoom`, `versionMismatch`,
   * …); this side interprets the game's.
   */
  onRejected(handler: (msg: MoveRejectedMessage) => void): () => void;
  isOpen(): boolean;
}

export function createSocketTransport(socket: Socket): RoomTransport {
  return {
    sendMove: (move) => { socket.emit(GAME_CLIENT_EVENTS.move, move); },
    onState(handler) {
      socket.on(GAME_SERVER_EVENTS.state, handler);
      return () => { socket.off(GAME_SERVER_EVENTS.state, handler); };
    },
    onRejected(handler) {
      socket.on(LOBBY_SERVER_EVENTS.rejected, handler);
      return () => { socket.off(LOBBY_SERVER_EVENTS.rejected, handler); };
    },
    isOpen: () => socket.connected,
  };
}
