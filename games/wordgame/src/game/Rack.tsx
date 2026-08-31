import { TILE_VALUES, type Tile } from '../../engine/constants';

export interface RackProps {
  tiles: Tile[];
  /** Selected indices — one in placement mode, several in exchange mode. */
  selected: number[];
  onTileTap(index: number): void;
}

/** The viewer's own tiles: seven buttons, letter plus value, blank as a
 * dotted question. */
export function Rack({ tiles, selected, onTileTap }: RackProps) {
  return (
    <div data-testid="rack" className="flex justify-center gap-1">
      {tiles.map((tile, index) => (
        <button
          key={`${tile}-${index}`}
          type="button"
          data-testid={`rack-tile-${index}`}
          onClick={() => { onTileTap(index); }}
          className={`relative flex h-11 w-10 items-center justify-center rounded border text-lg font-bold sm:h-12 sm:w-11 ${
            selected.includes(index)
              ? 'border-yellow-600 bg-yellow-200 ring-2 ring-yellow-500'
              : 'border-amber-300 bg-amber-100'
          } ${tile === '_' ? 'text-amber-500' : 'text-amber-950'}`}
        >
          {tile === '_' ? '·' : tile}
          <span className="absolute bottom-0.5 right-1 text-[9px] leading-none">
            {TILE_VALUES[tile]}
          </span>
        </button>
      ))}
    </div>
  );
}
