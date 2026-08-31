import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RosterMessage } from '@game-host/lobby/protocol/protocol';
import { useLobbyRoom } from '@game-host/lobby/client/useLobbyRoom';
import type { GameView, MoveRejectedMessage, WireMove } from '../../session/protocol';
import { getConnection, type Connection, type ConnectionStatus } from './connection';
import { wordgameIdentity } from './identity';

export type RoomPhase =
  | 'connecting'
  | 'joining'
  | 'lobby'
  | 'playing'
  | 'error'
  | 'gone'
  /** This client and this server do not speak the same protocol. */
  | 'stale';

/**
 * The codes this game's server rejects a move with. Everything else on the
 * `rejected` channel is the lobby's business and `useLobbyRoom` already
 * consumes it — surfacing a lobby refusal as a move rejection would put
 * "room is full" over a board.
 */
const MOVE_REJECTION_CODES = new Set([
  'gameOver',
  'notYourTurn',
  'badIntent',
  'badPlacement',
  'notInRack',
  'invalidWord',
  'exchangeBlocked',
  'badMove',
  'notSeated',
]);

export interface Room {
  phase: RoomPhase;
  status: ConnectionStatus;
  roster: RosterMessage | null;
  playerId: string | null;
  /** The latest server view — the whole game state, as this seat sees it. */
  view: GameView | null;
  /** The latest refused move, until dismissed or the next attempt. */
  rejection: MoveRejectedMessage | null;
  message: string | null;
  sendMove(move: WireMove): void;
  dismissRejection(): void;
  join(name?: string): void;
  begin(): void;
  rename(name: string): void;
  leaveSeat(): void;
}

/**
 * connect → join → lobby → playing.
 *
 * Simpler than Acquire's: there is no client-side session model at all — the
 * game state is just the latest `StateMessage.view`, replaced wholesale on
 * every commit. Phase is 'playing' once a view exists, and the two terminal
 * lobby states (`gone`, `stale`) rank above it.
 */
export function useRoom(roomId: string, connect: () => Connection = getConnection): Room {
  const connection = useMemo(() => connect(), [connect]);
  const lobby = useLobbyRoom(roomId, connection, wordgameIdentity);

  const [view, setView] = useState<GameView | null>(null);
  const [rejection, setRejection] = useState<MoveRejectedMessage | null>(null);

  useEffect(
    () => connection.transport.onState((msg) => { setView(msg.view); }),
    [connection],
  );

  useEffect(
    () => connection.transport.onRejected((msg) => {
      if (!MOVE_REJECTION_CODES.has(msg.code)) return;
      setRejection(msg);
    }),
    [connection],
  );

  // Terminal states tear the game down.
  useEffect(() => {
    if (!lobby.gone && !lobby.stale) return;
    setView(null);
    setRejection(null);
  }, [lobby.gone, lobby.stale]);

  const sendMove = useCallback((move: WireMove) => {
    setRejection(null);
    connection.transport.sendMove(move);
  }, [connection]);

  const dismissRejection = useCallback(() => { setRejection(null); }, []);

  const phase: RoomPhase =
    lobby.stale ? 'stale'
      : lobby.gone ? 'gone'
        : view !== null ? 'playing'
          : lobby.phase;

  return {
    phase,
    status: lobby.status,
    roster: lobby.roster,
    playerId: lobby.playerId,
    view,
    rejection,
    message: lobby.message,
    sendMove,
    dismissRejection,
    join: lobby.join,
    begin: lobby.begin,
    rename: lobby.rename,
    leaveSeat: lobby.leaveSeat,
  };
}
