import { BRAND_CLASSES, tickerFor, type BrandKey } from '../tokens';
import { Price } from './Price';

/**
 * One share of a company — an *outlined* portrait certificate showing the
 * ticker and, always, a price. The counterpart to `Brand` (the company, filled).
 *
 * Cash is the exception throughout: money reads landscape, like a bill, shows
 * `$$`, and carries no per-share price.
 */
export interface StockCardProps {
  id: BrandKey;
  price?: number;
  size?: 'sm';
  /** Card edges peeking out behind the front card. See `stackDepth`. */
  depth?: 0 | 1 | 2;
  badge?: string;
  /**
   * What the badge means. `info` is news — a brand founded this turn. `muted`
   * is a state the card is *in*, and must not compete with the live one: two
   * blue pills in the same row read as two things worth acting on, when one of
   * them is a card you cannot press.
   */
  badgeTone?: 'info' | 'muted';
  mode?: 'static' | 'select' | 'add' | 'remove';
  /**
   * What pressing this card does, for anyone not reading it visually. Without
   * it the accessible name is the card's own face — "$M $200" — which names
   * the share but not the action. Ignored in `static` mode, which renders no
   * control to name.
   */
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const BASE =
  'relative inline-flex flex-col items-center justify-between gap-[3px] rounded-md border bg-white text-center align-bottom font-medium leading-tight';

/**
 * The layered edges are pseudo-elements sharing the card's border colour, offset
 * down-and-right and painted behind it. `::before` paints first and therefore
 * sits furthest back, so depth-2 puts it at the larger offset.
 */
const DEPTH_LAYER =
  "after:absolute after:inset-0 after:-z-10 after:rounded-md after:border after:border-inherit after:bg-white after:content-['']";
const DEPTH_LAYER_2 =
  "before:absolute before:inset-0 before:-z-10 before:rounded-md before:border before:border-inherit before:bg-white before:content-['']";

const DEPTH: Record<0 | 1 | 2, string> = {
  0: '',
  1: `mb-1 mr-1 ${DEPTH_LAYER} after:translate-x-[3px] after:translate-y-[3px]`,
  2: `mb-[7px] mr-[7px] ${DEPTH_LAYER} after:translate-x-[3px] after:translate-y-[3px] ${DEPTH_LAYER_2} before:translate-x-[6px] before:translate-y-[6px]`,
};

export function StockCard({
  id,
  price,
  size,
  depth = 0,
  badge,
  badgeTone = 'info',
  mode = 'static',
  label,
  selected,
  disabled,
  onClick,
}: StockCardProps) {
  const brand = BRAND_CLASSES[id];
  const isCash = id === 'Cash';
  const small = size === 'sm';

  const shape = isCash
    ? small
      ? 'w-14 min-h-[34px] flex-row items-center justify-center px-1 py-1'
      : 'w-[74px] min-h-[42px] flex-row items-center justify-center px-1 py-1'
    : small
      ? 'w-10 min-h-[44px] px-[3px] py-1'
      : 'w-[52px] min-h-[58px] px-1 py-1.5';

  const tickerSize = isCash ? (small ? 'text-[13px]' : 'text-base') : small ? 'text-xs' : 'text-sm';

  const state = [
    selected ? 'outline outline-2 outline-offset-1 outline-blue-600' : '',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const className =
    `${BASE} ${shape} ${brand.stroke} ${brand.text} ${DEPTH[depth]} ${state}`.trim();

  const body = (
    <>
      <span className={`font-bold tracking-[0.01em] ${tickerSize}`}>{tickerFor(id)}</span>
      {!isCash && price != null && (
        <span className="text-[11px]">
          <Price value={price} />
        </span>
      )}
      {mode === 'remove' && (
        <span className="absolute -right-1.5 -top-1.5 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-black/10 text-[10px]">
          ×
        </span>
      )}
      {badge && (
        <span
          className={
            'absolute -right-[7px] -top-2 rounded-full px-1 text-[9px] font-bold text-white ' +
            (badgeTone === 'muted' ? 'bg-gray-500' : 'bg-blue-600')
          }
        >
          {badge}
        </span>
      )}
    </>
  );

  const interactive = mode === 'select' || mode === 'add' || mode === 'remove';
  if (interactive) {
    return (
      <button
        type="button"
        className={disabled ? className : `${className} cursor-pointer`}
        title={id}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <span className={className} title={id}>
      {body}
    </span>
  );
}
