import type { GameView, MoveRecord } from '../../session/protocol';

/** "3h ago" -style age; empty when the record predates timestamps. */
export function ago(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return '';
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export interface LastMoveProps {
  view: GameView;
  seatEmoji(index: number): string | null;
}

/** The last committed move as one line — the design's banner over the board. */
export function LastMove({ view, seatEmoji }: LastMoveProps) {
  const record: MoveRecord | undefined = view.log[view.log.length - 1];
  if (record === undefined) return null;
  const index = view.players.findIndex((p) => p.id === record.playerId);
  const name = view.players[index]?.name ?? '…';
  const when = ago(record.at);
  const suffix = when === '' ? '' : ` · ${when}`;
  const emoji = seatEmoji(index) ?? '';
  const body =
    record.kind === 'play' ? (
      <>
        <b className="text-ink">{name}</b> played{' '}
        <b className="text-warn-accent">{record.words?.[0]?.word ?? '—'}</b> for{' '}
        <b className="text-ink">{record.score}</b>
      </>
    ) : record.kind === 'exchange' ? (
      <>
        <b className="text-ink">{name}</b> swapped {record.tilesPlayed ?? 0} tiles
      </>
    ) : (
      <>
        <b className="text-ink">{name}</b> passed
      </>
    );
  return (
    <div
      data-testid="last-move"
      className="mx-3.5 mt-2.5 rounded-xl border border-hairline bg-white px-3 py-2 text-[13px] text-ink-soft"
    >
      {emoji} {body}
      {suffix}
    </div>
  );
}
