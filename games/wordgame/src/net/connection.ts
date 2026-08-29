import { PROTOCOL_VERSION } from '../../session/protocol';
import { createLobbyConnection, type LobbyConnection } from '@game-host/lobby/client/connection';
import { createSocketTransport, type RoomTransport } from './transport';

export type { ConnectionStatus } from '@game-host/lobby/client/connection';

// Origin-relative (Acquire's pattern, copied exactly): with no
// VITE_SERVER_URL set, pages, assets and sockets all ride the page's own
// origin, sockets at `${BASE_URL}socket.io` — so a phone on the LAN works
// for free, and no client code names a host or port. When VITE_SERVER_URL
// *is* set the server owns its whole origin and socket.io's default path
// applies. `window` is read at module scope: safe while every importer
// lives under src/** (the jsdom vitest project).
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const SOCKET_PATH = import.meta.env.VITE_SERVER_URL
  ? undefined
  : `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}socket.io`;

/** The lobby half of the wire, plus the transport the game half uses. */
export interface Connection extends LobbyConnection {
  transport: RoomTransport;
}

function createConnection(): Connection {
  const lobby = createLobbyConnection({
    serverUrl: SERVER_URL,
    protocolVersion: PROTOCOL_VERSION,
    socketPath: SOCKET_PATH,
  });
  return { ...lobby, transport: createSocketTransport(lobby.socket) };
}

let current: Connection | null = null;

/**
 * One socket for the whole app, opened on first use. Lazy so the home page
 * costs nothing; shared because the create screen and the room screen are
 * two views of one connection — opening a second would drop the seat the
 * first just bound. Never closed in a component lifecycle.
 */
export function getConnection(): Connection {
  if (current === null) current = createConnection();
  return current;
}

export function closeConnection(): void {
  current?.close();
  current = null;
}
