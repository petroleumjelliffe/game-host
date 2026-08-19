import { PROTOCOL_VERSION } from '../../session/protocol';
import { createLobbyConnection, type LobbyConnection } from '../../vendor/lobby/client/connection';
import { createSocketTransport, type RoomTransport } from './transport';

export type { ConnectionStatus } from '../../vendor/lobby/client/connection';

// `window` is read at module scope here, which throws on import in an
// environment with no `window` — a node test, most concretely. Safe today:
// every importer of this module lives under `src/**`, which vitest always
// runs under the `app` (jsdom) project. It stops being safe the moment
// something under `server/**` or `session/**` (the `node` project) imports
// this module, directly or transitively — that import would fail before a
// single test in the file runs, with a stack trace pointing here.
//
// A deployed build sets VITE_SERVER_URL (Pages → Render) and that wins, with
// socket.io's default path — that server owns its whole origin. Otherwise the
// page's own origin: in dev Vite proxies the socket path to the game server,
// hosted the game server IS the origin's answerer. No host or port appears
// here — see game-host specs/2026-08-17-origin-relative-clients.md — and a
// phone on the LAN works for free: its origin is whatever page it loaded.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const SOCKET_PATH = import.meta.env.VITE_SERVER_URL
  ? undefined
  : `${import.meta.env.BASE_URL}socket.io`;

/**
 * The lobby half of the wire, plus the transport the game half uses.
 *
 * Untested in isolation, deliberately: `server/clientOverWire.test.ts` proves
 * the transport against the real server, and the create/join/start path is
 * covered by the by-hand pass. A test that stubs `io()` and asserts `emit`
 * was called would restate this file rather than check it.
 */
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
 * One socket for the whole app, opened on first use.
 *
 * Lazy because pass-and-play and the catalog have no server by design — the
 * previous provider connected at page load and reported "Disconnected from
 * server" across a game that never needed one. Shared because the create
 * screen and the room screen are two views of one connection: opening a
 * second would drop the seat the first just bound.
 */
export function getConnection(): Connection {
  if (current === null) current = createConnection();
  return current;
}

export function closeConnection(): void {
  current?.close();
  current = null;
}
