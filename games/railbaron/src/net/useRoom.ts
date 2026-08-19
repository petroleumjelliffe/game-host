import { useEffect, useMemo, useState } from 'react';
import type { LobbyConnection } from '../../vendor/lobby/client/connection';
import { createIdentityStore } from '../../vendor/lobby/client/identity';
import { useLobbyRoom, type LobbyPhase, type LobbyRoomState } from '../../vendor/lobby/client/useLobbyRoom';
import { SEATS, type GameEvent, type SeatId } from '../state/events';
import { getConnection } from './connection';
import { createGameTransport, type GameTransport } from './transport';

export type RoomPhase =
  | 'connecting' | 'joining' | 'lobby' | 'playing' | 'error' | 'gone' | 'stale';

export interface RoomState {
  phase: RoomPhase;
  lobby: LobbyRoomState;
  log: GameEvent[];
  /** Your colour, or null before you are seated. */
  seat: SeatId | null;
  transport: GameTransport;
}

/**
 * Namespaced: both games share the GitHub Pages origin, so an unprefixed key
 * would have Acquire and Rail Baron overwriting each other's identities.
 */
const identity = createIdentityStore('railbaron');

/**
 * Which phase wins when the lobby and the log disagree.
 *
 * Pure and exported so it can be table-tested. `stale` and `gone` are terminal
 * facts about the connection itself — a client that cannot speak the server's
 * protocol does not get to render a game just because it once saw a `started`
 * — so they outrank everything. Below them, a log that has begun outranks a
 * lobby phase still saying `lobby`, which is what carries every client from
 * the roster to the board the moment Begin's broadcast lands.
 */
export function rankPhase(lobbyPhase: LobbyPhase, logHasStarted: boolean): RoomPhase {
  if (lobbyPhase === 'stale' || lobbyPhase === 'gone') return lobbyPhase;
  return logHasStarted ? 'playing' : lobbyPhase;
}

/**
 * `connect` is injectable, exactly as the reference consumer's `useRoom` is —
 * tests hand in a fake and observe lifecycle without a socket anywhere.
 */
export function useRoom(
  roomId: string,
  connect: () => LobbyConnection = getConnection,
): RoomState {
  // The connection is the module's, not this mount's — see net/connection.ts
  // for why (StrictMode, and the creator's seat riding the socket binding).
  // Deliberately nothing here closes it: an earlier draft owned a connection
  // per mount and closed it in an effect cleanup, and StrictMode's
  // mount-unmount-remount pass killed the socket permanently — the cleanup
  // ran, `useMemo` never re-ran, and the room sat on "Reconnecting" forever.
  // `useState`'s lazy initializer keeps the reference stable per mount; the
  // singleton keeps it one socket across the app.
  const [connection] = useState(connect);

  const lobby = useLobbyRoom(roomId, connection, identity);
  const transport = useMemo(() => createGameTransport(connection), [connection]);

  const [log, setLog] = useState<GameEvent[]>([]);
  useEffect(() => transport.onLog((msg) => {
    // The server broadcasts the full log every time, so this is an assignment
    // rather than a merge: whatever arrives last is the truth, and a client
    // that missed one is repaired by the next.
    if (msg.roomId === roomId) setLog(msg.events);
  }), [transport, roomId]);

  // The lobby's seat ids ARE the colours, so this is a narrowing, not a lookup.
  const seat = SEATS.find((s) => s === lobby.playerId) ?? null;

  return {
    phase: rankPhase(lobby.phase, log.some((e) => e.type === 'started')),
    lobby,
    log,
    seat,
    transport,
  };
}
