import type { GameView, MoveRecord } from '../../session/protocol';
import { ago } from './LastMove';

export interface MoveLogProps {
  view: GameView;
}

function describe(record: MoveRecord, names: Map<string, string>): string {
  const name = names.get(record.playerId) ?? record.playerId;
  switch (record.kind) {
    case 'play': {
      const words = (record.words ?? []).map((w) => `${w.word} (${w.score})`).join(', ');
      const bingo = record.bingo === true ? ' — bingo!' : '';
      return `${name}: ${words} for ${record.score}${bingo}`;
    }
    case 'exchange':
      return `${name} exchanged ${record.tilesPlayed ?? 0} tile${record.tilesPlayed === 1 ? '' : 's'}`;
    case 'pass':
      return `${name} passed`;
  }
}

/** Latest move first — days can pass between turns, so what just happened
 * belongs at the top. */
export function MoveLog({ view }: MoveLogProps) {
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  if (view.log.length === 0) {
    return <p className="text-sm text-ink-mute">No moves yet.</p>;
  }
  return (
    <ol data-testid="move-log" className="max-h-48 overflow-y-auto text-sm">
      {[...view.log].reverse().map((record, i) => {
        const when = ago(record.at);
        return (
          <li key={view.log.length - i} className="border-b border-line py-1 last:border-0">
            {describe(record, names)}
            {when === '' ? '' : ` · ${when}`}
          </li>
        );
      })}
    </ol>
  );
}
