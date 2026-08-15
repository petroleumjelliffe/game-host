import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyConnection } from '../../../vendor/lobby/client/connection';
import {
  GAME_CLIENT_EVENTS,
  GAME_SERVER_EVENTS,
  type GameEvent,
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

export function useGameSession(conn: LobbyConnection): GameSession {
  const [session, setSession] = useState<SessionState>(initialSession);
  const bufferRef = useRef(new SnapshotBuffer());

  useEffect(() => {
    const sock = conn.socket;
    const onSt = (msg: StateMessage) => {
      bufferRef.current.push(msg.players, Date.now());
      setSession((s) => onState(s, msg));
    };
    const onEv = (ev: GameEvent) => setSession((s) => onEvent(s, ev, Date.now()));
    sock.on(GAME_SERVER_EVENTS.state, onSt);
    sock.on(GAME_SERVER_EVENTS.event, onEv);
    return () => {
      sock.off(GAME_SERVER_EVENTS.state, onSt);
      sock.off(GAME_SERVER_EVENTS.event, onEv);
    };
  }, [conn]);

  const sendInput = useCallback(
    (msg: InputMessage) => conn.socket.emit(GAME_CLIENT_EVENTS.input, msg),
    [conn],
  );
  const call = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.call), [conn]);
  const nextRound = useCallback(() => conn.socket.emit(GAME_CLIENT_EVENTS.nextRound), [conn]);

  return { session, buffer: bufferRef.current, sendInput, call, nextRound };
}
