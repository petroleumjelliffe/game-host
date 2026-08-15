// One identity store and one socket for the whole tab. Module-level because
// remounting a screen must not reconnect the transport.

import { createIdentityStore } from '../../../vendor/lobby/client/identity';
import {
  createLobbyConnection,
  type LobbyConnection,
} from '../../../vendor/lobby/client/connection';
import { APP_ID, PROTOCOL_VERSION } from '../../../protocol/game';

export const identity = createIdentityStore(APP_ID);

let conn: LobbyConnection | null = null;
export function connection(): LobbyConnection {
  conn ??= createLobbyConnection({
    serverUrl: window.location.origin,
    protocolVersion: PROTOCOL_VERSION,
  });
  return conn;
}
