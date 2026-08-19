import { StockCard } from './StockCard';
import type { BrandKey } from '../tokens';

/**
 * How many card edges peek out behind the front card. Magnitude, not sign: a
 * leaving (negative) stack layers exactly like its positive twin.
 */
export function stackDepth(count: number): 0 | 1 | 2 {
  const n = Math.abs(count);
  if (n >= 6) return 2;
  if (n >= 2) return 1;
  return 0;
}

/**
 * The primary interactive share entity: a `StockCard` with its count rendered
 * *outside* the card. The body increments, the `×` control decrements — and the
 * `×` only exists when there is something to remove.
 */
export interface StockStackProps {
  id: BrandKey;
  count: number;
  price?: number;
  size?: 'sm';
  /** Shares on their way out (a liquidation lane): dimmed, and signed −N. */
  leaving?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

export function StockStack({
  id,
  count,
  price,
  size,
  leaving,
  disabled,
  onClick,
  onRemove,
}: StockStackProps) {
  const isCash = id === 'Cash';
  const small = size === 'sm';

  // Cash is money: the label under the bills is total dollars, not ×N.
  const qtyLabel = isCash
    ? `$${((price ?? 0) * count).toLocaleString('en-US')}`
    : `${leaving ? '−' : '×'}${count}`;

  const qtyTone = count === 0 ? 'text-gray-400' : leaving ? 'text-red-700' : isCash ? 'text-green-700' : 'text-gray-700';
  const qtyClass = `tabular-nums font-semibold leading-none ${small ? 'text-xs' : 'text-sm'} ${qtyTone}`;

  const bodyClass = `inline-flex flex-col items-center rounded-lg border border-transparent ${
    small ? 'gap-0.5 p-0.5' : 'gap-[3px] p-1'
  }`;

  const inner = (
    <>
      <StockCard id={id} price={price} size={size} depth={stackDepth(count)} />
      <span data-qty className={qtyClass}>
        {qtyLabel}
      </span>
    </>
  );

  const body =
    onClick && !disabled ? (
      <button
        type="button"
        className={`${bodyClass} cursor-pointer hover:border-gray-200 hover:bg-gray-100`}
        onClick={onClick}
      >
        {inner}
      </button>
    ) : (
      <span className={bodyClass}>{inner}</span>
    );

  const showRemove = Boolean(onRemove) && count > 0 && !disabled;

  return (
    <span
      className={`relative inline-flex items-start align-bottom ${leaving ? 'opacity-50' : ''} ${
        disabled ? 'opacity-55' : ''
      }`}
    >
      {body}
      {showRemove && (
        <button
          type="button"
          aria-label="Remove one"
          title="Remove one"
          onClick={onRemove}
          className={`absolute -right-0.5 -top-0.5 z-[4] inline-flex items-center justify-center rounded-full bg-black/10 p-0 leading-none hover:bg-black/20 ${
            small ? 'h-[15px] w-[15px] text-[10px]' : 'h-[18px] w-[18px] text-xs'
          }`}
        >
          ×
        </button>
      )}
    </span>
  );
}
