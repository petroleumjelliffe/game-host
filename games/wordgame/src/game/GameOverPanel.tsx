import type { GameView } from '../../session/protocol';

export interface GameOverPanelProps {
  view: GameView;
}

/** Final scores with rack adjustments, winner(s) called out. */
export function GameOverPanel({ view }: GameOverPanelProps) {
  const final = view.final;
  if (final === undefined) return null;
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const winners = final.winnerIds.map((id) => names.get(id) ?? id);

  return (
    <div data-testid="game-over" className="rounded-xl border border-yellow-400 bg-yellow-50 p-4">
      <h2 className="mb-1 text-center text-xl font-bold">Game over</h2>
      <p className="mb-3 text-center font-semibold">
        {winners.length === 1 ? `${winners[0]} wins!` : `Tied: ${winners.join(' and ')}`}
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {view.players.map((player) => {
          const adj = final.adjustments.find((a) => a.playerId === player.id);
          return (
            <li key={player.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{player.name}</span>
              {adj !== undefined && adj.rackValue > 0 && (
                <span className="text-red-700">−{adj.rackValue} rack</span>
              )}
              {adj !== undefined && adj.playedOutBonus > 0 && (
                <span className="text-green-700">+{adj.playedOutBonus} played out</span>
              )}
              <span className="font-bold tabular-nums">{player.score}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
