import { useNavigate, useParams } from 'react-router-dom';
import { GameScreen } from '../game/GameScreen';
import { RoomLobby } from '../game/lobby/RoomLobby';
import { RoomGone } from '../game/lobby/RoomGone';
import { StaleClient } from '../game/lobby/StaleClient';
import { ConnectionStrip } from '../game/lobby/ConnectionStrip';
import { RoomRefused } from '../game/lobby/RoomRefused';
import { seatEmoji } from '../game/seatEmoji';
import { lobbyView } from '@game-host/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/constants';
import { useRoom } from '../net/useRoom';
import { useNotifyBind } from '../notify/useNotifyBind';
import { getConnection, closeConnection, type Connection } from '../net/connection';

export interface RoomPageProps {
  /** Injectable so screen tests can drive a fake. The app never passes it. */
  connect?: () => Connection;
}

export function RoomPage({ connect = getConnection }: RoomPageProps) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useRoom(roomId ?? '', connect);

  // Whenever the room is playing and this device holds a seat, tell the
  // notification service which seat is ours. Fire-and-forget.
  useNotifyBind(roomId ?? '', room.phase === 'playing');

  // Leaving is a real disconnect: the socket this room depends on closes,
  // and `getConnection()` opens a fresh one wherever the player goes next.
  const leave = () => {
    closeConnection();
    navigate('/');
  };

  // The roster is the only thing that knows who is connected — the game view
  // has no idea a socket exists. Undefined until one arrives, which reads as
  // "everyone present" rather than "everyone away".
  const presence = room.roster
    ? Object.fromEntries(room.roster.players.map((p) => [p.id, p.connected]))
    : undefined;

  if (room.phase === 'playing' && room.view && room.playerId) {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <GameScreen
          view={room.view}
          viewerId={room.playerId}
          connected={room.status === 'open'}
          {...(presence === undefined ? {} : { presence })}
          sendMove={room.sendMove}
          rejection={room.rejection}
          onDismissRejection={room.dismissRejection}
          onExit={leave}
        />
      </>
    );
  }

  if (room.phase === 'stale') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        {/* The worker caches nothing (push only), so a plain reload really
            does fetch the current bundle. */}
        <StaleClient onReload={() => { window.location.reload(); }} onExit={leave} />
      </>
    );
  }

  if (room.phase === 'gone') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomGone roomId={roomId} onExit={leave} />
      </>
    );
  }

  if (room.phase === 'error') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomRefused
          roomId={roomId}
          message={room.message}
          onRetry={() => { room.join(); }}
          onExit={leave}
        />
      </>
    );
  }

  if (room.phase === 'lobby' && room.roster) {
    const view = lobbyView(room, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomLobby
          view={view}
          note={room.message}
          onStart={room.begin}
          onRename={room.rename}
          onLeaveSeat={() => {
            room.leaveSeat();
            leave();
          }}
          seatEmoji={seatEmoji}
          // The lobby lives at /room/:id, so the page's own address IS the
          // share link.
          shareUrl={window.location.href}
          shareText="Join my word game!"
        />
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <ConnectionStrip status={room.status} />
      <p className="text-gray-600">{room.phase === 'joining' ? 'Joining…' : 'Connecting…'}</p>
    </div>
  );
}
