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
 * - `engine.close()` closes that engine's own clients and its own `ws`
 *   server. Each attached engine has its own, so this is per-game by
 *   construction.
 *
 * **`disconnectSockets(true)` used to be the first line here and had to go**
 * (2026-08-20). Its comment read "clients go away rather than reconnecting
 * into a server that is shutting down", which is true and is not what it
 * costs. A socket.io client that is disconnected *by the server* treats that
 * as final: the reason is `io server disconnect`, `socket.active` goes false,
 * and the manager never retries. Not with a longer backoff — never. So every
 * deploy and every restart left every open page permanently dead, showing a
 * connecting state forever, recoverable only by a manual reload.
 *
 * Observed in a browser against the real build: kill the server, bring it
 * back, and the page sat at `io server disconnect` with `active: false` while
 * a raw websocket to the very same socket.io path opened fine.
 *
 * Closing the engine instead drops the transport without attributing it to
 * the server, so the client sees a transport close, retries on its own
 * backoff, and is back a moment after the new process listens. Clients do
 * briefly retry into a server that is shutting down — which was the original
 * worry — and that is the cheaper failure by a wide margin: a few refused
 * attempts against a page that never comes back at all.
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
  io.engine.close();
}
