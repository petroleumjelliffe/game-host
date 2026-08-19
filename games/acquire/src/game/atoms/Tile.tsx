import { BRAND_CLASSES, tickerFor, type BrandKey } from '../tokens';
import type { Coord } from '../../../engine/gameHelpers';

/**
 * One vocabulary, shared by board cells and the inline tiles in the log.
 *
 * Background carries affiliation (neutral empty · dark placed · brand chain),
 * border weight carries attention (1px settled · 2px actionable), and a ring
 * marks the tile placed *this* turn — the one still undoable.
 */
export type TileState = 'empty' | 'filled' | 'hand' | 'placed' | 'blocked' | 'chain' | 'founded';

export interface TileProps {
  coord: Coord;
  state: TileState;
  brand?: BrandKey;
  onClick?: () => void;
  /**
   * Board cells fill their grid track; inline tiles keep a fixed 34px box.
   * The label sizes from `--tile-label`, which the board sets in `cqi` so text
   * scales with the board rather than with a breakpoint.
   */
  fill?: boolean;
  /**
   * The "placed this turn, still undoable" ring, as an orthogonal modifier so
   * it composes with brand affiliation — the tile that founds a chain is both
   * the HQ and the undoable tile. The `placed` state is the same cue baked in,
   * for inline use in the log where there is no affiliation to compose with.
   */
  selected?: boolean;
  /**
   * Pointer presence, for the panel's hand tiles: the board highlights a hand
   * cell only while its panel twin is pointed at. Orthogonal to `onClick` —
   * a tile can be worth pointing at (where is it?) with nothing to press.
   */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

// `m-0` is deliberate: a legacy global `button{margin:1px}` in styles/index.css
// would otherwise shrink every interactive cell inside the board's grid track.
const BASE =
  'relative m-0 inline-flex flex-none items-center justify-center rounded border border-solid p-0 align-middle font-semibold leading-none';

const DARK = 'bg-gray-700 border-gray-700 text-gray-50 font-bold';

/** Brand hue is deliberately absent from `blocked`: it is not about any company. */
const STATE_CLASSES: Record<TileState, string> = {
  empty: 'bg-gray-100 border-gray-300 text-gray-500 font-medium',
  filled: DARK,
  placed: `${DARK} outline outline-[3px] -outline-offset-[3px] outline-blue-600 z-[3]`, // == filled + selected
  hand: 'bg-blue-100 border-2 border-blue-500 text-blue-700 font-bold',
  blocked: 'bg-blue-100 border-2 border-blue-500 text-blue-700/30 font-bold cursor-not-allowed',
  chain: `${DARK} z-[1]`,
  founded: 'border-2 font-extrabold z-[2]',
};

const SELECTED = 'outline outline-[3px] -outline-offset-[3px] outline-blue-600 z-[3]';

export function Tile({ coord, state, brand, onClick, fill, selected, onMouseEnter, onMouseLeave }: TileProps) {
  const brandClasses = brand ? BRAND_CLASSES[brand] : null;

  // Chain members wear the brand ring so neighbouring rings overlap into a
  // single group outline; the HQ additionally takes the brand's tint and text.
  const brandPaint =
    brandClasses && state === 'chain'
      ? `ring-[3px] ${brandClasses.ring}`
      : brandClasses && state === 'founded'
        ? `ring-[3px] ${brandClasses.ring} ${brandClasses.tint} ${brandClasses.stroke} ${brandClasses.text}`
        : '';

  const box = fill ? 'h-full w-full' : 'h-[34px] w-[34px]';
  /**
   * A tile is a control only when it has something to do.
   *
   * It used to render as an enabled `<button>` for any hand tile, handler or
   * not — so online, watching someone else's turn, your own six tiles offered
   * a hover, a focus ring and a place in the tab order, and clicking them did
   * nothing at all. That was the first thing reported from a by-hand session:
   * "I'm allowed to click but nothing happens." The affordance has to tell the
   * truth; the *look* of a hand tile does not change, because it is still
   * yours either way.
   */
  // `blocked` keeps its own cursor either way: "yours, and never playable" is
  // a fact about the tile, not about whether this screen offers a handler.
  const interactive = onClick != null;
  const affordance = interactive && state !== 'blocked' ? 'cursor-pointer hover:bg-blue-200' : '';

  const className =
    `${BASE} ${box} ${STATE_CLASSES[state]} ${brandPaint} ${affordance} ${selected ? SELECTED : ''}`.trim();

  // `founded` is the only state whose label is not the coordinate — but the
  // coordinate stays reachable through the title in every state.
  const label = state === 'founded' && brand ? tickerFor(brand) : coord;

  const body = (
    <>
      <span className="text-[length:var(--tile-label,0.875rem)]">{label}</span>
      {state === 'blocked' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-[length:var(--tile-overlay,18px)] [filter:grayscale(0.15)]"
        >
          🚫
        </span>
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        title={coord}
        data-tile-state={state}
        disabled={state === 'blocked'}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className={className}
      title={coord}
      data-tile-state={state}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {body}
    </span>
  );
}
