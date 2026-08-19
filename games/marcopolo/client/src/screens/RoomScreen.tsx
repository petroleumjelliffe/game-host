import { useLobbyRoom } from '../../../vendor/lobby/client/useLobbyRoom';
import { lobbyView } from '../../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { connection, identity } from '../net/singletons';
import { useGameSession } from '../net/useGameSession';
import { LobbyPanel } from './LobbyPanel';
import { GameScreen } from './GameScreen';

export function RoomScreen({ roomId }: { roomId: string }) {
  const conn = connection();
  const lobby = useLobbyRoom(roomId, conn, identity);
  const view = lobbyView(lobby, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });
  const game = useGameSession(conn, roomId);

  if (view.terminal === 'gone')
    return (
      <main className="notice">
        <p>THIS POOL HAS DRAINED</p>
        <a className="btn btn--ghost btn--center" href="#/">START A NEW ONE</a>
      </main>
    );
  if (view.terminal === 'stale')
    return <main className="notice"><p>NEW VERSION AVAILABLE — RELOAD</p></main>;

  if (game.session.latest && lobby.playerId) {
    return <GameScreen game={game} view={view} youId={lobby.playerId} />;
  }
  if (lobby.roster?.lifecycle === 'playing') {
    return <main className="notice"><p>DIVING IN…</p></main>;
  }
  return <LobbyPanel view={view} lobby={lobby} />;
}
