import { useNavigate, useParams } from 'react-router-dom';
import { GameScreen } from '../game/GameScreen';
import { RoomLobby } from '../game/lobby/RoomLobby';
import { RoomGone } from '../game/lobby/RoomGone';
import { StaleClient } from '../game/lobby/StaleClient';
import { ConnectionStrip } from '../game/lobby/ConnectionStrip';
import { RoomRefused } from '../game/lobby/RoomRefused';
import { seatEmoji } from '../game/online/seatEmoji';
import { lobbyView } from '../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../engine/startups';
import { useRoom } from '../net/useRoom';
import { forceUpdateAndReload } from '../pwa/update';
import { useDevSeat } from '../net/devSeat';
import { getConnection, closeConnection, type Connection } from '../net/connection';

export interface RoomPageProps {
  /** Injectable so screen tests can drive a fake. The app never passes it. */
  connect?: () => Connection;
}

export function RoomPage({ connect = getConnection }: RoomPageProps) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  // Above `useRoom`, and that ordering is load-bearing: `useRoom` reads the
  // stored identity during its own first render, so a seat handed over in the
  // URL has to be stored before this line. Dev only, compiled out otherwise.
  useDevSeat(roomId ?? '');
  const room = useRoom(roomId ?? '', connect);

  // Leaving is a real disconnect, not just a route change: the socket this
  // room's session and roster depend on closes, and `getConnection()` opens a
  // fresh one for wherever the player goes next.
  const leave = () => {
    closeConnection();
    navigate('/');
  };

  // The roster is the only thing that knows who is connected — the engine
  // state has no idea a socket exists. Undefined until one arrives, which
  // reads as "everyone present" rather than "everyone away".
  const presence = room.roster
    ? Object.fromEntries(room.roster.players.map((p) => [p.id, p.connected]))
    : undefined;

  if (room.phase === 'playing' && room.session && room.playerId) {
    return (
      <>
        <ConnectionStrip status={room.status} />
        {/*
          No `onEndGame`: this room belongs to everyone in it, and ending
          the game is not one player's to do. Leaving is.
        */}
        <GameScreen
          session={room.session}
          viewerId={room.playerId}
          connected={room.status === 'open'}
          presence={presence}
          onExit={leave}
          // Same control as pass-and-play's; online it is the leave flow —
          // the socket closes and the seat survives for a rejoin.
          onBack={leave}
        />
      </>
    );
  }

  if (room.phase === 'stale') {
    return (
      <>
        <ConnectionStrip status={room.status} />
        {/*
          Not a plain reload any more. A service worker caches the shell, so
          location.reload() alone can be served the same stale shell and loop
          — the exact future the old comment here predicted, arrived. The
          forced path activates any waiting worker, checks for a newer one,
          clears every cache, and reloads in a finally, so there is no state
          from which the button does nothing.
        */}
        <StaleClient onReload={() => { void forceUpdateAndReload(); }} onExit={leave} />
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
          onRetry={() => room.join()}
          onExit={leave}
        />
      </>
    );
  }

  if (room.phase === 'lobby' && room.roster) {
    // Seats, who you are and whether you may begin come from the view now.
    // This page used to find itself in the roster and read isHost off the
    // result, which every other consumer would have had to repeat.
    const view = lobbyView(room, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });
    return (
      <>
        <ConnectionStrip status={room.status} />
        <RoomLobby
          view={view}
          note={room.message}
          onStart={room.begin}
          onRename={room.rename}
          // Leaving a *lobby* gives the seat up. A disconnect would keep the
          // seat and leave the room waiting on a player who is not coming back.
          onLeaveSeat={() => {
            room.leaveSeat();
            leave();
          }}
          seatEmoji={seatEmoji}
          // The lobby lives at /room/:id, so the page's own address IS the
          // share link — no base-path arithmetic, one source of truth.
          shareUrl={window.location.href}
          shareText="Join my Acquire game!"
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
