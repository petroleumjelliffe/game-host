import type { GameView } from '../../session/protocol';
import { seatEmoji } from './seatEmoji';

export interface ScorePanelProps {
  view: GameView;
  viewerId: string;
  /** Roster presence by playerId; undefined reads as "everyone present". */
  presence?: Record<string, boolean>;
}

export function ScorePanel({ view, viewerId, presence }: ScorePanelProps) {
  return (
    <ul data-testid="score-panel" className="flex flex-col gap-1">
      {view.players.map((player, index) => {
        const isTurn = view.stage === 'playing' && player.id === view.currentPlayerId;
        const connected = presence?.[player.id] ?? true;
        return (
          <li
            key={player.id}
            data-testid={`score-row-${player.id}`}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
              isTurn ? 'border-yellow-500 bg-yellow-50 font-semibold' : 'border-gray-200 bg-white'
            }`}
          >
            <span aria-hidden>{seatEmoji(index) ?? '·'}</span>
            <span
              data-testid="presence-dot"
              aria-hidden
              className={`h-2 w-2 flex-none rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <span className="min-w-0 flex-1 truncate">
              {player.name}
              {player.id === viewerId && <span className="text-gray-400"> (you)</span>}
            </span>
            {isTurn && <span aria-label="current turn">▶</span>}
            <span className="tabular-nums font-semibold">{player.score}</span>
            <span className="text-xs text-gray-500">🀫{player.rackCount}</span>
          </li>
        );
      })}
    </ul>
  );
}
