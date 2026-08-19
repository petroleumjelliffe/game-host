import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyConnection } from '../../../vendor/lobby/client/connection';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  type GameEventEnvelope,
  type InputMessage,
  type StateMessage,
} from '../../../protocol/game';
import { initialSession, onEvent, onState, type SessionState } from '../game/sessionState';
import { SnapshotBuffer } from '../game/interpolate';

export interface GameSession {
  session: SessionState;
  buffer: SnapshotBuffer;
  sendInput(msg: InputMessage): void;
  call(): void;
  nextRound(): void;
}

export function useGameSession(conn: LobbyConnection, roomId: string): GameSession {
  const [session, setSession] = useState<SessionState>(initialSession);
  const bufferRef = useRef(new SnapshotBuffer());

  useEffect(() => {
    const sock = conn.socket;
    const onSt = (msg: StateMessage) => {
      bufferRef.current.push(msg.players, Date.now());
      setSession((s) => onState(s, msg));
    };
    // A socket that joined a previous room stays subscribed to that room's
    // socket.io channel (the vendor lobby never leaves it), so envelopes
    // from a stale room must be dropped here rather than trusted blind.
    const onEv = (env: GameEventEnvelope) => {
      if (env.roomId !== roomId) return;
      setSession((s) => onEvent(s, env.event, Date.now()));
    };
    sock.on(GAME_SERVER_EVENTS.state, onSt);
    sock.on(GAME_SERVER_EVENTS.event, onEv);
    return () => {
      sock.off(GAME_SERVER_EVENTS.state, onSt);
      sock.off(GAME_SERVER_EVENTS.event, onEv);
    };
  }, [conn, roomId]);

  const sendInput = useCallback(
    (msg: InputMessage) => conn.socket.emit(GAME_CLIENT_EVENTS.input, msg),
    [conn],
  );
  const call = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.call), [conn]);
  const nextRound = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.nextRound), [conn]);

  return { session, buffer: bufferRef.current, sendInput, call, nextRound };
}
