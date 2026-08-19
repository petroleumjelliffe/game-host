import type { Socket } from 'socket.io-client';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  type StateMessage,
  type UndoMessage,
  type WireIntent,
} from '../../session/protocol';
import { LOBBY_SERVER_EVENTS, type RejectedMessage } from '../../vendor/lobby/protocol/protocol';

/**
 * Everything a session may do to the network, and nothing else.
 *
 * Deliberately narrower than a socket: a session cannot create a room, join
 * one, read the roster, or reconnect. Those belong to `connection.ts`, which
 * is what keeps "the game" and "the lobby" from growing into each other.
 */
export interface RoomTransport {
  sendIntent(wire: WireIntent): void;
  sendUndo(stepId: number): void;
  /** Returns an unsubscribe. */
  onState(handler: (msg: StateMessage) => void): () => void;
  /**
   * Returns an unsubscribe. Shares the socket's `rejected` event with
   * `src/lobby/connection.ts`'s `onRejected` — one channel, two subscribers.
   * The lobby side branches on its own codes (`noSuchRoom`, `versionMismatch`,
   * …); this side interprets the rest. A subscriber added on either side is
   * heard by both.
   */
  onRejected(handler: (msg: RejectedMessage) => void): () => void;
  /** False while the socket is down, so intents are refused rather than dropped. */
  isOpen(): boolean;
}

/**
 * The real one. Untested in isolation on purpose — a stub socket asserting
 * "emit was called" proves only that this file calls the function it plainly
 * calls. `server/clientOverWire.test.ts` drives this adapter over a real
 * socket.io connection against the real server, which is where a wrong event
 * name or payload shape actually shows up.
 */
export function createSocketTransport(socket: Socket): RoomTransport {
  return {
    sendIntent: (wire) => { socket.emit(GAME_CLIENT_EVENTS.intent, wire); },
    sendUndo: (stepId) => {
      const msg: UndoMessage = { stepId };
      socket.emit(GAME_CLIENT_EVENTS.undo, msg);
    },
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
