// packages/host/close.ts
// How a game stops its own sockets without stopping anyone else's.

import type { Server as SocketServer } from 'socket.io';

/**
 * Ends every connection on this socket.io server, and nothing beyond it.
 *
 * The obvious call — `io.close()` — is wrong in a composed process, and
 * silently so. `Server.close()` finishes with `this.httpServer.close()`, and
 * `initEngine` sets `this.httpServer` to whichever server it attached to, so
 * the first game to shut down would close the listener for every game sharing
 * it. Verified in `node_modules/socket.io/dist/index.js`: the assignment at
 * the end of `initEngine`, the close at the end of `close`.
 *
 * This does the part that is genuinely this game's:
 *
 * - `disconnectSockets(true)` closes the underlying connections, not just the
 *   socket.io sessions — clients go away rather than reconnecting into a
 *   server that is shutting down.
 * - `engine.close()` closes that engine's own clients and its own `ws`
 *   server. Each attached engine has its own, so this is per-game by
 *   construction.
 *
 * What it deliberately leaves behind: the `request` and `upgrade` listeners
 * engine.io added to the shared HTTP server. Nothing removes those, and
 * nothing needs to — a closed engine's request listener delegates down the
 * chain exactly as it did when its path did not match.
 *
 * One thing closes the shared HTTP server: whoever created it, after every
 * game has been through here.
 */
export function closeSockets(io: SocketServer): void {
  io.disconnectSockets(true);
  io.engine.close();
}
