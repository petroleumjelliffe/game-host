import { Cash } from '../atoms/Cash';
import { StockCard } from '../atoms/StockCard';
import { StockStack } from '../atoms/StockStack';
import { TRADE_RATIO } from '../../../engine/startups';
import type { BrandKey } from '../tokens';

/**
 * The two exchanges a holder of an absorbed chain can make: sell one share for
 * cash, or hand in `TRADE_RATIO` shares for one survivor share.
 *
 * The ratio comes from the engine — it is a rule, not a layout constant.
 */
export interface LiqActionsProps {
  absorbedId: BrandKey;
  survivorId: BrandKey;
  unitPrice: number;
  canSell: boolean;
  canTrade: boolean;
  /**
   * The survivor has no shares left to trade for.
   *
   * Separate from `canTrade` because a trade can be unavailable for several
   * reasons — not your turn, fewer than `TRADE_RATIO` shares in hand, an empty
   * pool — and only this one is invisible in the rest of the panel. Without it
   * the button simply greyed out and the player had no way to learn why.
   */
  survivorSoldOut?: boolean;
  onSell?: () => void;
  onTrade?: () => void;
}

// `min-w-0` so a grid child may shrink below its content's natural width;
// without it the two actions cannot share a row in a 264px panel and the
// second wraps underneath, which is what they did.
const ACTION =
  'flex min-w-0 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-2 disabled:cursor-not-allowed disabled:opacity-50';

export function LiqActions({
  absorbedId,
  survivorId,
  unitPrice,
  canSell,
  canTrade,
  survivorSoldOut = false,
  onSell,
  onTrade,
}: LiqActionsProps) {
  return (
    // Two columns, not a wrapping row. These are a pair of alternatives — sell
    // or trade — and reading them side by side is what makes them read as a
    // choice rather than a list. `data-liq-actions` is how `verify:layout`
    // finds them to check they actually share a row at 264px, which jsdom
    // cannot see.
    <div data-liq-actions className="grid grid-cols-2 gap-2">
      {/* The buttons carry explicit labels: their content is cards and arrows,
          which would otherwise leave them with an unreadable accessible name. */}
      <button
        type="button"
        aria-label="Sell one share for cash"
        className={ACTION}
        disabled={!canSell}
        onClick={onSell}
      >
        <StockCard id={absorbedId} price={unitPrice} size="sm" />
        <span className="text-gray-400">→</span>
        <Cash amount={unitPrice} />
      </button>

      {/* The badge and its wording are the buy step's, not a second vocabulary
          for the same fact: that row already says `sold` on a muted badge when
          a brand's pool is empty. */}
      <button
        type="button"
        aria-label={
          survivorSoldOut
            ? `${survivorId} — sold out`
            : `Trade ${TRADE_RATIO} shares for one survivor share`
        }
        className={ACTION}
        disabled={!canTrade}
        onClick={onTrade}
      >
        <StockStack id={absorbedId} count={TRADE_RATIO} price={unitPrice} size="sm" />
        <span className="text-gray-400">→</span>
        <StockCard
          id={survivorId}
          size="sm"
          badge={survivorSoldOut ? 'sold' : undefined}
          badgeTone="muted"
        />
      </button>
    </div>
  );
}
