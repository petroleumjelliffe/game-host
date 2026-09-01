import type { GameView, MoveRecord } from '../../session/protocol';

/** "3h ago" -style age; empty when the record predates timestamps. */
export function ago(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return '';
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  // Hours floor rather than round: rounding showed "24h ago" at 23h59m and
  // "2h ago" at 1h31m (2026-08-31). The day boundary stays gated on minutes,
  // not the rounded hour — rounding h first made "yesterday" appear ~30min
  // early (23.5h rounded up to 24h).
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  const d = Math.round(m / 1440);
  return d <= 1 ? 'yesterday' : `${d}d ago`;
}

export interface LastMoveProps {
  view: GameView;
  viewerId: string;
  seatEmoji(index: number): string | null;
}

/** The last committed move as one line — the design's banner over the board.
 * The viewer's own move says "You"; the scoreless-turns countdown rides
 * this line since the turn-status line was retired (2026-09-01). */
export function LastMove({ view, viewerId, seatEmoji }: LastMoveProps) {
  const record: MoveRecord | undefined = view.log[view.log.length - 1];
  if (record === undefined) return null;
  const index = view.players.findIndex((p) => p.id === record.playerId);
  const name = record.playerId === viewerId ? 'You' : view.players[index]?.name ?? '…';
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
      {view.scorelessTurns > 0 && (
        <span className="text-ink-faint" data-testid="scoreless-counter">
          {' '}· Scoreless: {view.scorelessTurns}/6
        </span>
      )}
    </div>
  );
}
