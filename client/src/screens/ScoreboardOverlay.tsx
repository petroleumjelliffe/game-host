import type { GameEvent, StateMessage } from '../../../protocol/game';
import { playerColor } from '../render/creatures';

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
      <h2>
        {roundEnd?.reason === 'catch'
          ? `Caught! ${nameOf(roundEnd.caughtId!)} is Marco next.`
          : roundEnd
            ? `Time! The polos escaped — ${nameOf(roundEnd.nextMarcoId)} is Marco next.`
            : 'Round over'}
      </h2>
      <ol className="scores">
        {rows.map((p) => (
          <li key={p.id}>
            <span className="chip" style={{ background: playerColor(p.id) }} />
            {p.name} — {snapshot.scores[p.id] ?? 0}
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="big" onClick={onNext}>Next round</button>
      ) : (
        <p>Waiting for the host…</p>
      )}
    </div>
  );
}
