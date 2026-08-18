import type { GameEvent, StateMessage } from '../../../protocol/game';
import { creatureFor, playerColor } from '../render/creatures';

export function ScoreboardOverlay({
  snapshot,
  roundEnd,
  isHost,
  onNext,
}: {
  snapshot: StateMessage;
  roundEnd: Extract<GameEvent, { type: 'roundEnd' }> | null;
  isHost: boolean;
  onNext: () => void;
}) {
  const nameOf = (id: string) => snapshot.players.find((p) => p.id === id)?.name ?? id;
  const rows = [...snapshot.players].sort(
    (a, b) => (snapshot.scores[b.id] ?? 0) - (snapshot.scores[a.id] ?? 0),
  );

  return (
    <div className="overlay">
      <div className="overlay__sheet tiled">
        <span className="deck__label">
          {roundEnd?.reason === 'catch' ? 'CAUGHT' : 'TIME'} · ROUND {snapshot.round}
        </span>
        <h2 className="overlay__headline">
          {roundEnd?.reason === 'catch'
            ? `${nameOf(roundEnd.caughtId!)} IS MARCO NEXT`
            : roundEnd
              ? `THE POLOS ESCAPED — ${nameOf(roundEnd.nextMarcoId)} IS MARCO NEXT`
              : 'ROUND OVER'}
        </h2>
        <ol className="overlay__scores">
          {rows.map((p) => (
            <li key={p.id}>
              <span className="overlay__creature" style={{ color: playerColor(p.id) }}>
                {creatureFor(p.id, p.id === snapshot.marcoId)}
              </span>
              <span className="overlay__name">{p.name}</span>
              <span className="overlay__score">{snapshot.scores[p.id] ?? 0}</span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <button className="btn btn--primary btn--center" onClick={onNext}>
            NEXT ROUND<span className="btn__pip" />
          </button>
        ) : (
          <p className="lobby__note">WAITING FOR THE HOST</p>
        )}
      </div>
    </div>
  );
}
