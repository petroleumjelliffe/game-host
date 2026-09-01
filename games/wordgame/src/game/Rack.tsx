import { TILE_VALUES, type Tile } from '../../engine/constants';

export interface RackProps {
  tiles: Tile[];
  /** Selected indices — one in placement mode, several in exchange mode. */
  selected: number[];
  onTileTap(index: number): void;
  /** Tiles remaining in the bag, drawn as a tile of its own at the row's end. */
  bagCount: number;
}

/** The viewer's own tiles: seven buttons, letter plus value, blank as a
 * dotted question — plus the bag, drawn as its own dark tile with a count. */
export function Rack({ tiles, selected, onTileTap, bagCount }: RackProps) {
  return (
    <div data-testid="rack" className="flex items-center justify-center gap-1">
      {tiles.map((tile, index) => {
        const isSelected = selected.includes(index);
        const shadow = isSelected
          ? 'inset 0 -3px 0 #d9bf8a, 0 0 0 2px #2563eb, 0 2px 6px rgba(37,99,235,.4)'
          : 'inset 0 -3px 0 #d9bf8a, 0 1px 3px rgba(0,0,0,.2)';
        return (
          <button
            key={`${tile}-${index}`}
            type="button"
            data-testid={`rack-tile-${index}`}
            onClick={() => { onTileTap(index); }}
            className={`relative flex h-[50px] w-11 flex-none items-center justify-center rounded-md bg-tile font-tile text-lg font-bold ${
              tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
            }`}
            style={{ boxShadow: shadow }}
          >
            {tile === '_' ? '·' : tile}
            <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
              {TILE_VALUES[tile]}
            </span>
          </button>
        );
      })}
      <div className="w-2 flex-none" />
      <div
        data-testid="bag-tile"
        className="relative flex h-[50px] w-11 flex-none items-center justify-center rounded-md bg-board"
        style={{ boxShadow: 'inset 0 -3px 0 #143528, 0 1px 3px rgba(0,0,0,.25)' }}
        title={`${bagCount} tiles left in the bag`}
      >
        <span className="h-[22px] w-[22px] rounded border-2 border-white/35" />
        <span className="absolute -right-1.5 -top-1.5 rounded-full border-2 border-paper bg-ink px-1.5 text-[11px] font-bold text-white">
          {bagCount}
        </span>
      </div>
    </div>
  );
}
