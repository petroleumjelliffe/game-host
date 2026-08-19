import type { ReactNode } from 'react';
import { Cash } from './atoms/Cash';
import { Price } from './atoms/Price';
import { Brand } from './atoms/Brand';
import { tickerFor } from './tokens';
import type { FinalScoreReport } from '../../engine/endGame';

/**
 * The terminal game-over overlay: a scrim over the game, one column per player,
 * sorted by final total so the winner reads leftmost. Each chain contributes a
 * stock row and a bonus row.
 *
 * Props are `finalScore(state)`'s report, spread — including `reason`, which is
 * the engine's `EndReason` object rather than the plan's `string`. The plan asked
 * for both; the report shape wins, because the catalog feeds this real engine
 * output and a string would need every caller to invent the same sentence.
 *
 * Sorting and totals are derived here (`stock + bonus + cash`). Bonus
 * *resolution* is a rules concern and arrives already computed.
 *
 * Deliberately terminal: no dismiss, no "New game" of its own — `actions` is
 * a plain slot the caller fills, not a route this component knows about.
 *
 * `actions` renders *inside* the card's own normal-flow column, below the
 * table, rather than as a sibling of this component's root. The root is
 * itself `absolute inset-0` (so the card can centre in whatever surface
 * hosts it), which takes it out of flow — a caller that rendered its own
 * button row as a following sibling found that row anchored to the *scrim's*
 * top edge instead of the card's bottom, overlapping the winner banner
 * whenever the vertically-centred card was tall enough to reach that high.
 * Worse at narrow widths, where the banner has less width to spread into and
 * the overlap became a full cover. Keeping the slot inside the card's own
 * flow is what avoids that regardless of card height or viewport width.
 */
export type FinalScoringProps = FinalScoreReport & { actions?: ReactNode };

const BONUS_MARK = {
  majority: { mark: 'M', title: 'Majority shareholder', className: 'text-sm font-bold' },
  minority: { mark: 'm', title: 'Minority shareholder', className: 'text-xs font-medium' },
  both: {
    mark: 'Mm',
    title: 'Sole holder — majority and minority combined',
    className: 'text-sm font-bold',
  },
} as const;

/**
 * One sentence describing why a game ended.
 *
 * Exported so the panel's declare-end prompt and the final scoreboard cannot
 * describe the same ending in two different ways.
 */
export function reasonText(reason: FinalScoreReport['reason']): string {
  if (reason == null) return 'Game over';
  if (reason.kind === 'size41') return `${reason.startupId} reached ${reason.size} tiles`;
  return 'Every founded startup is safe';
}

const Dash = () => <span className="text-gray-300">—</span>;

export function FinalScoring({ reason, players, chains, holdings, bonuses, actions }: FinalScoringProps) {
  const columns = players
    .map((player) => {
      const held = holdings[player.id] ?? {};
      const rows = chains.map((ch) => {
        const qty = held[ch.id] ?? 0;
        return {
          chainId: ch.id,
          qty,
          stock: qty * ch.price,
          bonus: bonuses.find((b) => b.chainId === ch.id && b.playerId === player.id) ?? null,
        };
      });
      const stock = rows.reduce((n, r) => n + r.stock, 0);
      const bonus = rows.reduce((n, r) => n + (r.bonus?.amount ?? 0), 0);
      return { player, rows, stock, bonus, total: stock + bonus + player.cash };
    })
    .sort((a, b) => b.total - a.total);

  const winner = columns[0];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/60 p-6">
      <div className="max-h-full w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        {winner && (
          <div data-fs-banner className="mb-4 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xl font-extrabold">
              <span className="text-2xl leading-none">{winner.player.emoji || '•'}</span>
              <span>{`${winner.player.name} wins with `}</span>
              <Cash amount={winner.total} />
            </div>
            <div className="text-[13px] text-gray-500">{`${reasonText(reason)} — game over`}</div>
          </div>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-24 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400" />
              {columns.map((c) => (
                <th key={c.player.id} data-fs-player={c.player.id} className="px-2 py-1 text-left">
                  <span className="mr-1.5 text-base leading-none">{c.player.emoji || '•'}</span>
                  <span className="font-semibold">{c.player.name}</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {chains.map((ch, i) => (
              <ChainRows key={ch.id} index={i} chain={ch} columns={columns} />
            ))}

            <tr>
              <th className="border-t border-gray-100 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
                Cash
              </th>
              {columns.map((c) => (
                <td
                  key={c.player.id}
                  data-fs-row="cash"
                  data-fs-col={c.player.id}
                  className="border-t border-gray-100 px-2 py-1"
                >
                  <Cash amount={c.player.cash} />
                </td>
              ))}
            </tr>

            <tr>
              <th className="border-t-2 border-gray-300 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.05em] text-gray-600">
                Total
              </th>
              {columns.map((c) => (
                <td
                  key={c.player.id}
                  data-fs-row="total"
                  data-fs-col={c.player.id}
                  className="border-t-2 border-gray-300 px-2 py-1.5 text-base font-extrabold"
                >
                  <Cash amount={c.total} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {actions && <div className="mt-6 flex justify-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}

type Column = {
  player: FinalScoreReport['players'][number];
  rows: { chainId: string; qty: number; stock: number; bonus: { type: keyof typeof BONUS_MARK; amount: number } | null }[];
};

function ChainRows({
  chain,
  columns,
  index,
}: {
  chain: FinalScoreReport['chains'][number];
  columns: Column[];
  index: number;
}) {
  return (
    <>
      <tr>
        <th colSpan={columns.length + 1} className="pt-4 text-left">
          <span className="mr-2 font-bold text-gray-500">{tickerFor(chain.id)}</span>
          <Brand id={chain.id} size="sm" />
          <span className="ml-2 text-xs text-gray-500">
            {`${chain.size} tiles · `}
            <Price value={chain.price} />
          </span>
        </th>
      </tr>

      <tr>
        <th className="py-1 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
          stock
        </th>
        {columns.map((c) => {
          const r = c.rows[index]!; // every column's rows map the same chain list
          return (
            <td
              key={c.player.id}
              data-fs-row={`stock-${chain.id}`}
              data-fs-col={c.player.id}
              className="px-2 py-1"
            >
              {r.qty ? (
                <>
                  <span className="mr-1.5 tabular-nums text-gray-500">{`×${r.qty}`}</span>
                  <Cash amount={r.stock} />
                </>
              ) : (
                <Dash />
              )}
            </td>
          );
        })}
      </tr>

      <tr>
        <th className="py-1 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
          bonus
        </th>
        {columns.map((c) => {
          const r = c.rows[index]!; // every column's rows map the same chain list
          const mark = r.bonus ? BONUS_MARK[r.bonus.type] : null;
          return (
            <td
              key={c.player.id}
              data-fs-row={`bonus-${chain.id}`}
              data-fs-col={c.player.id}
              className="px-2 py-1"
            >
              {r.bonus && mark ? (
                <>
                  {/* M and m differ only in case, so weight and size carry the
                      distinction visually while the title carries the word. */}
                  <abbr title={mark.title} className={`mr-1.5 no-underline text-gray-600 ${mark.className}`}>
                    {mark.mark}
                  </abbr>
                  <Cash amount={r.bonus.amount} sign="delta" />
                </>
              ) : (
                <Dash />
              )}
            </td>
          );
        })}
      </tr>
    </>
  );
}
