import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterMessage } from '../../vendor/lobby/protocol/protocol';
import { useLobbyRoom } from '../../vendor/lobby/client/useLobbyRoom';
import { getConnection, type Connection, type ConnectionStatus } from './connection';
import { createNetworkSession, type NetworkSession } from './NetworkSession';
import { acquireIdentity, loadIdentity } from './identity';

export type RoomPhase =
  | 'connecting'
  | 'joining'
  | 'lobby'
  | 'playing'
  | 'error'
  | 'gone'
  /** This client and this server do not speak the same protocol. */
  | 'stale';

export interface Room {
  phase: RoomPhase;
  status: ConnectionStatus;
  roster: RosterMessage | null;
  playerId: string | null;
  session: NetworkSession | null;
  message: string | null;
  /**
   * Join again after a refusal. The name is optional — omitting it asks the
   * server to name the seat, which is what every ordinary arrival now does.
   */
  join(name?: string): void;
  begin(): void;
  /** Rename your own seat, lobby-only. The roster broadcast is the answer. */
  rename(name: string): void;
  /**
   * Give up your own seat, lobby-only — the lobby's `Leave`. Clears the stored
   * identity too: the seat is gone, so the token is dead, and keeping it
   * would make the next visit attempt a rejoin the server must refuse.
   */
  leaveSeat(): void;
}

/**
 * connect → join → lobby → playing.
 *
 * `connect` is injectable so screen tests can drive a fake connection; every
 * caller in the app uses the real one. The lobby half — connect, join,
 * roster, refusals — belongs to `useLobbyRoom`; this wrapper's own job is
 * building the `NetworkSession` once a game starts, and ranking the two
 * terminal lobby states (`gone`, `stale`) above `playing`.
 */
export function useRoom(roomId: string, connect: () => Connection = getConnection): Room {
  const connection = useMemo(() => connect(), [connect]);
  const lobby = useLobbyRoom(roomId, connection, acquireIdentity);

  const [session, setSession] = useState<NetworkSession | null>(null);
  const sessionRef = useRef<NetworkSession | null>(null);
  const playerIdRef = useRef<string | null>(loadIdentity(roomId)?.playerId ?? null);

  useEffect(() => connection.onJoined((m) => { playerIdRef.current = m.playerId; }), [connection]);

  // The first state message is what turns a lobby into a game.
  useEffect(() => {
    const off = connection.transport.onState((msg) => {
      if (sessionRef.current !== null) return;
      const id = playerIdRef.current;
      if (id === null) return;

      const built = createNetworkSession({ transport: connection.transport, playerId: id, initial: msg });
      sessionRef.current = built;
      setSession(built);
    });

    return () => {
      off();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [connection]);

  // Terminal states tear the game down — in an effect, one render after the
  // phase has already moved off 'playing'. The ranking below is what covers
  // that render; the test in useRoom.test.ts pins both halves.
  useEffect(() => {
    if (!lobby.gone && !lobby.stale) return;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
  }, [lobby.gone, lobby.stale]);

  // The transport cannot hear its own socket die; tell the session directly.
  // (Moved from the old status subscription; the lobby keeps its own copy for
  // the rejoin resend.)
  useEffect(() => {
    let wasOpen = connection.status() === 'open';
    return connection.subscribe(() => {
      const open = connection.status() === 'open';
      if (wasOpen && !open) sessionRef.current?.connectionLost();
      wasOpen = open;
    });
  }, [connection]);

  const phase: RoomPhase =
    lobby.stale ? 'stale'
      : lobby.gone ? 'gone'
        : session !== null ? 'playing'
          : lobby.phase;

  return {
    phase,
    status: lobby.status,
    roster: lobby.roster,
    playerId: lobby.playerId,
    session,
    message: lobby.message,
    join: lobby.join,
    begin: lobby.begin,
    rename: lobby.rename,
    leaveSeat: lobby.leaveSeat,
  };
}
