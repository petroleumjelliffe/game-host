import type { GameView } from '../../session/protocol';

export interface PlayerChipsProps {
  view: GameView;
  viewerId: string;
  /** Roster presence by playerId; undefined reads as "everyone present". */
  presence?: Record<string, boolean>;
  seatEmoji(index: number): string | null;
}

/** The roster as pills — the current player's is solid accent. Replaces the
 * old ScorePanel list; the bag count moved to the rack's bag tile, and a
 * disconnected player dims rather than growing a dot. */
export function PlayerChips({ view, viewerId, presence, seatEmoji }: PlayerChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-3.5 pt-2.5">
      {view.players.map((player, index) => {
        const current = view.stage === 'playing' && player.id === view.currentPlayerId;
        const connected = presence?.[player.id] ?? true;
        return (
          <div
            key={player.id}
            data-testid={`player-chip-${player.id}`}
            data-current={current ? '' : undefined}
            className={`flex items-center gap-1.5 rounded-full border-[1.5px] py-1 pl-2 pr-2.5 text-[13px] ${
              current
                ? 'border-accent bg-accent font-bold text-white'
                : 'border-line bg-white font-medium text-ink-soft'
            } ${connected ? '' : 'opacity-60'}`}
          >
            <span aria-hidden>{seatEmoji(index) ?? '·'}</span>
            <span>{player.id === viewerId ? 'You' : player.name}</span>
            <span className={`rounded-full px-1.5 text-xs font-bold ${current ? 'bg-white/20' : 'bg-page'}`}>
              {player.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}
