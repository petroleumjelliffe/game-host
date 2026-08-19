import { Cash } from '../atoms/Cash';
import { StockStack } from '../atoms/StockStack';
import { isStartupId } from '../../../engine/startups';

/**
 * The current player's holdings: their share stacks and their balance.
 *
 * Zero-count holdings are dropped rather than rendered as `×0` — an empty
 * portfolio says "no shares" once instead of seven times.
 */
export interface HandZoneProps {
  /** Empty when no player's hand is on show — during the turn-order draw. */
  name: string;
  portfolio: Record<string, number>;
  /** Omitted when there is no viewing player, so no balance is shown. */
  cash?: number;
  /** Per-share prices, keyed by startup id, when the caller has them. */
  prices?: Record<string, number>;
}

export function HandZone({ name, portfolio, cash, prices = {} }: HandZoneProps) {
  const held = Object.entries(portfolio).filter(([id, n]) => n > 0 && isStartupId(id));
  // Before the turn-order draw there is no viewing player at all. The zone
  // still renders, at its full reserved height, so the panel does not resize
  // the moment play begins — it just has nobody's holdings to show.
  const hasViewer = name.length > 0;

  return (
    <div className="flex-none border-t border-gray-100 px-4 py-3">
      {/*
        The balance rides the header, for the same reason the staging zone's
        net does: as a green card among the share stacks it was the widest
        thing in the row and read as a holding, which it is not. In the corner
        at the header's own size it is a standing figure you can find without
        it competing with the shares. `Cash` supplies the green.
      */}
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.06em]">
        <span className="min-w-0 truncate text-gray-400">{hasViewer ? `${name}'s hand` : 'Hand'}</span>
        {cash !== undefined && (
          <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-gray-500">Balance</span>
            <span className="font-extrabold tracking-normal">
              <Cash amount={cash} />
            </span>
          </span>
        )}
      </div>
      {/*
        A floor, not a fixed height, and it covers **one populated row** — 68px,
        measured on a real page by `npm run verify:layout`, because jsdom
        reports 0 for all of it.

        It was 64px, which is the row *without* a stack in it: the founder's
        free share grew the zone 64 -> 68 and shifted every zone below by 4px,
        which was reported as the players strip moving. Gaining a share is not
        gaining a row, so nothing should move — the 4px was the stack's depth
        margin and its ×N label, neither of which the empty row has.

        Growing past this is still fine and expected — a player can hold all
        seven brands, which needs a second row — and the panel scrolls to suit.
        Re-measure if the stack's size or this zone's padding changes.
      */}
      <div
        data-zone="holdings"
        data-may-grow="true"
        className="flex min-h-[68px] flex-wrap items-end gap-3 transition-[min-height] duration-200 motion-reduce:transition-none"
      >
        {!hasViewer ? (
          <span className="text-xs text-gray-400">Not dealt yet</span>
        ) : held.length === 0 ? (
          <span className="text-xs text-gray-400">no shares</span>
        ) : (
          held.map(([id, n]) =>
            isStartupId(id) ? (
              <StockStack key={id} id={id} count={n} price={prices[id]} size="sm" />
            ) : null,
          )
        )}
      </div>
    </div>
  );
}
