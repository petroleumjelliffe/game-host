// packages/host/guard.ts
// The error boundary. One process means an uncaught throw anywhere ends
// everything, so this is what keeps one game's bad payload from ending the
// other two games' evenings.
//
// This is not theoretical. Acquire's server/index.ts carries a long comment
// explaining why `isWireIntent` exists: a malformed intent with a valid
// `type` and a malformed field is dereferenced before it is validated, which
// "throws synchronously and takes the whole process down for every room, not
// just this one". Composed, every room becomes every game — and the game with
// most to lose is Marco Polo, which persists nothing, so a crash costs a live
// round outright while the other two restore from disk.

import type { Socket } from 'socket.io';
import { LOBBY_SERVER_EVENTS } from '@game-host/lobby/protocol/protocol.js';

type Listener = (...args: never[]) => void;

/**
 * Contains a throw from any handler registered on this socket after this call.
 *
 * The patch replaces `on` and `once` **on the socket instance**. It is not a
 * Proxy, and the difference matters: `lobby.socketsFor()` and Marco Polo's
 * `io.sockets.sockets` iteration both hand back the socket socket.io itself
 * holds, so a wrapper object would leave half the process carrying the
 * guarded socket and half carrying the raw one. There is one object here, and
 * it is guarded everywhere it appears. (A Proxy also has a `this`-binding
 * hazard — `Reflect.get(target, prop, receiver)` returns methods bound to the
 * proxy, which breaks any class method reaching for private state.)
 *
 * Call it at `io.on('connection')`, **before** any `attach`. That ordering is
 * the whole reach of this function: it covers every handler registered
 * afterwards, by anyone — including the lobby's seven, which no game can get
 * at to wrap individually — and covers nothing registered before, which is
 * socket.io's own transport plumbing and not what this exists for.
 */
export function guardSocket(socket: Socket, game: string): Socket {
  // Captured and bound now, so the wrappers below call the real methods
  // rather than recursing into the patched ones.
  const on = socket.on.bind(socket);
  const once = socket.once.bind(socket);

  const contain = (event: string, handler: Listener): Listener =>
    (...args: never[]): void => {
      try {
        handler(...args);
      } catch (error) {
        report(socket, game, event, error);
      }
    };

  // The casts are because socket.io types `on`/`once` as overload sets over
  // its reserved events; the runtime shape is the ordinary EventEmitter one.
  socket.on = ((event: string, handler: Listener) =>
    on(event as never, contain(event, handler) as never)) as unknown as Socket['on'];
  socket.once = ((event: string, handler: Listener) =>
    once(event as never, contain(event, handler) as never)) as unknown as Socket['once'];

  return socket;
}

/**
 * Contains a throw from a scheduled callback — the half a socket guard cannot
 * see.
 *
 * Marco Polo's simulation does not arrive on a socket: `gameHandlers.ts` runs
 * a `setInterval` per active room at `TUNING.tickHz` = 20, and a throw inside
 * a timer callback reaches nothing but the top of the stack. It is the
 * highest-frequency code in the composed process and the only scheduled entry
 * point in any game, which makes it the boundary's most likely trigger rather
 * than an afterthought to it.
 *
 * Logs and swallows. A tick that throws twenty times a second will say so
 * twenty times a second — the right amount of noise for a game that is now
 * broken, and nothing at all for the two beside it that are not.
 */
export function guardTick<A extends unknown[]>(
  game: string,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A): void => {
    try {
      fn(...args);
    } catch (error) {
      console.error(`[${game}] tick threw`, error);
    }
  };
}

function report(socket: Socket, game: string, event: string, error: unknown): void {
  console.error(`[${game}] handler for '${event}' threw`, error);
  // Nobody is listening on the way out, and socket.io has already begun
  // tearing the connection down — an emit here goes nowhere by definition.
  if (event === 'disconnect' || event === 'disconnecting') return;
  // `rejected` is the one refusal channel all three games already speak, and
  // `RejectedMessage.code` is typed `string` rather than a union precisely so
  // consumers can add codes (see the lobby's protocol comment). So a contained
  // throw reaches the player as a refusal rather than as a socket that goes
  // quiet and a page that waits forever.
  socket.emit(LOBBY_SERVER_EVENTS.rejected, {
    code: 'serverError',
    message: 'the server failed to handle that',
  });
}
