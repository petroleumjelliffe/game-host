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
    return <main className="notice">This pool has drained. <a href="#/">Start a new one</a></main>;
  if (view.terminal === 'stale')
    return <main className="notice">New version available — reload this page.</main>;

  if (game.session.latest && lobby.playerId) {
    return <GameScreen game={game} view={view} youId={lobby.playerId} />;
  }
  if (lobby.roster?.lifecycle === 'playing') {
    return <main className="notice">diving in…</main>;
  }
  return <LobbyPanel view={view} lobby={lobby} />;
}
