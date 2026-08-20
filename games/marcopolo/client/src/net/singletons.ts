// One identity store and one socket for the whole tab. Module-level because
// remounting a screen must not reconnect the transport.

import { createIdentityStore } from '@game-host/lobby/client/identity';
import {
  createLobbyConnection,
  type LobbyConnection,
} from '@game-host/lobby/client/connection';
import { APP_ID, PROTOCOL_VERSION } from '../../../protocol/game';

export const identity = createIdentityStore(APP_ID);

let conn: LobbyConnection | null = null;
export function connection(): LobbyConnection {
  conn ??= createLobbyConnection({
    serverUrl: window.location.origin,
    protocolVersion: PROTOCOL_VERSION,
    // '/marcopolo/socket.io' — base is '/marcopolo/' in dev and build alike,
    // so no branching: whoever serves the page (Vite's proxy in dev, the
    // game server itself hosted) answers at the prefixed path.
    socketPath: `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}socket.io`,
  });
  return conn;
}
