import { RB_PROTOCOL_VERSION } from '../../session/protocol';
import { createLobbyConnection, type LobbyConnection } from '../../vendor/lobby/client/connection';
import { SERVER_URL, SOCKET_PATH } from '../config';

let current: LobbyConnection | null = null;

/**
 * One socket for the whole app, opened on first use.
 *
 * This is the lobby's proven consumer pattern (Acquire's `net/connection.ts`),
 * adopted after building without it produced two bugs by hand:
 *
 * - **Shared**, because the create screen and the room screen are two views of
 *   one connection. The server's rejoin shortcut keys on the *socket's own
 *   binding* — so the creator arriving at `/room/:code` on the same socket is
 *   handed the seat they just bound, before any stored identity exists.
 *   Opening a second socket instead arrives as a stranger and takes a second
 *   seat.
 *
 * - **Module-owned**, because component lifecycles cannot be trusted with it.
 *   StrictMode mounts, unmounts and remounts every component in development; a
 *   connection closed in an effect cleanup dies on that pass and nothing
 *   rebuilds it — `close()` is `socket.disconnect()`, which is permanent. The
 *   symptom is a room stuck on "Reconnecting" with six empty seats and not one
 *   console error.
 *
 * - **Lazy**, because pass-and-play has no server by design. Nothing should
 *   open a socket until someone actually goes online.
 */
export function getConnection(): LobbyConnection {
  if (current === null) {
    current = createLobbyConnection({
      serverUrl: SERVER_URL,
      protocolVersion: RB_PROTOCOL_VERSION,
      socketPath: SOCKET_PATH,
    });
  }
  return current;
}

/**
 * Leaving is a real disconnect, not just a route change: the socket the room
 * depended on closes, and the next online visit opens a fresh one rather than
 * finding this one dead.
 */
export function closeConnection(): void {
  current?.close();
  current = null;
}
