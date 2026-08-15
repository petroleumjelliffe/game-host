import { useLobbyRoom } from '../../../vendor/lobby/client/useLobbyRoom';
import { lobbyView } from '../../../vendor/lobby/client/view';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../protocol/game';
import { connection, identity } from '../net/singletons';
import { LobbyPanel } from './LobbyPanel';

export function RoomScreen({ roomId }: { roomId: string }) {
  const conn = connection();
  const lobby = useLobbyRoom(roomId, conn, identity);
  const view = lobbyView(lobby, { capacity: MAX_PLAYERS, minPlayers: MIN_PLAYERS });

  if (view.terminal === 'gone')
    return <main className="notice">This pool has drained. <a href="#/">Start a new one</a></main>;
  if (view.terminal === 'stale')
    return <main className="notice">New version available — reload this page.</main>;

  if (lobby.roster?.lifecycle === 'playing') {
    {/* GameScreen mounts here in Task 13 */}
    return <main className="notice">diving in…</main>;
  }
  return <LobbyPanel view={view} lobby={lobby} />;
}
