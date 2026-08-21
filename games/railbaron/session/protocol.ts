// session/protocol.ts
// The game half of the wire, beside the lobby's. Node-safe: imported by the
// server and the client alike, so no React and no DOM. The only import is a
// type, so nothing here pulls the engine into a bundle that did not want it.
import type { GameEvent } from '../src/state/events.js';

/** The wire. Bump on any change to message shapes or append semantics. */
export const RB_PROTOCOL_VERSION = 1;
/** The stored-room record format. Independent of the wire. */
export const RB_SAVE_VERSION = 1;

export interface AppendMessage { event: GameEvent }

/**
 * The full log, every time. Self-healing by construction: a client that missed
 * a broadcast, slept, or reconnected is repaired by the next one, because the
 * message is the whole truth rather than a delta against a position the server
 * would otherwise have to track per socket.
 */
export interface LogMessage { roomId: string; events: GameEvent[] }

export const GAME_CLIENT_EVENTS = {
  append: 'append',
  undo: 'undo',
} as const;

export const GAME_SERVER_EVENTS = {
  log: 'log',
} as const;

/**
 * Why an append or an undo was refused. Sent on the lobby's `rejected`
 * channel, which passes codes it does not recognise straight through to the
 * game side — that is its documented contract, and it is what lets the game
 * add refusals without touching the lobby.
 */
export type GameRejectionCode =
  | 'malformedEvent'   // failed isGameEvent
  | 'notYourSeat'      // event.seat is not the sender's seat
  | 'notNow'           // structurally fine, illegal at this point in the log
  | 'notYourUndo'      // the action that would be popped belongs to someone else
  | 'nothingToUndo';

export interface GameRejection { code: GameRejectionCode; message: string }
