import { TILE_VALUES, type Tile } from '../../engine/constants';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';
import { EASE_REFLOW, REFLOW_MS, STAGGER_MS } from './motion';

export const RACK_TILE_W = 44;
export const RACK_SLOT_W = 48; // tile + 4px gap; rackSlot() in dragPlan.ts assumes this rhythm

export interface RackProps {
  /** One entry per server rack tile, in display order. `tile: null` is a
   * reserved slot — its tile is on the board this turn and will come back
   * here (the motion spec's "the rack slot stays reserved"). Ids are
   * stable across reorders so slides keep tile identity. */
  entries: { id: number; tile: Tile | null; fresh?: number }[];
  /** Selected indices — one in placement mode, several in exchange mode. */
  selected: number[];
  onTileTap(index: number): void;
  /** Tiles remaining in the bag, drawn as a tile of its own at the row's end. */
  bagCount: number;
  onTilePointerDown?(index: number, e: ReactPointerEvent<HTMLButtonElement>): void;
  /** The tile being dragged: removed from the row entirely (the ghost under
   * the finger is its only representation — nothing dims in place). */
  draggingIndex?: number | null;
  /** Open an insertion gap at this slot; neighbours slide aside. */
  insertionSlot?: number | null;
  /** Ref to the tiles-only wrapper — drop targeting measures this rect. */
  tilesRef?: Ref<HTMLDivElement>;
  /** Entry rendered invisible (still occupying its slot) while a flight
   * carries its tile home — the flight is the tile until it lands. */
  hiddenId?: number | null;
}

/** The viewer's own tiles plus the bag. Tiles sit at fixed 48px slots so a
 * drag can open an insertion gap and the neighbours slide aside (the left
 * transition, the spec's 180ms reflow); the dragged tile is removed
 * outright — the ghost under the finger is its only representation
 * (decided 2026-08-31). */
export function Rack({
  entries, selected, onTileTap, bagCount,
  onTilePointerDown, draggingIndex = null, insertionSlot = null, tilesRef, hiddenId = null,
}: RackProps) {
  // During a rack drag a dashed placeholder HOLDS a slot — the hovered one,
  // else the lifted tile's own — so the row never closes up: the tile can
  // come straight home and neighbours only move when the gap actually
  // relocates (feedback 2026-09-01). Without a drag, insertionSlot keeps its
  // original open-a-gap meaning.
  const dragging = draggingIndex !== null;
  const gapSlot = dragging ? insertionSlot ?? draggingIndex : insertionSlot;
  const visibleCount = entries.length - (dragging ? 1 : 0);
  const slots = visibleCount + (gapSlot === null ? 0 : 1);
  let nextSlot = 0;

  return (
    <div data-testid="rack" className="flex items-center justify-center gap-1">
      <div
        ref={tilesRef}
        data-testid="rack-tiles"
        className="relative h-[50px]"
        style={{ width: Math.max(RACK_TILE_W, slots * RACK_SLOT_W - 4) }}
      >
        {dragging && gapSlot !== null && (
          <div
            data-testid="rack-slot-hold"
            className="absolute top-0 box-border h-[50px] w-11 rounded-md border-[1.5px] border-dashed border-board-frame"
            style={{ left: gapSlot * RACK_SLOT_W, transition: `left ${REFLOW_MS}ms ${EASE_REFLOW}` }}
          />
        )}
        {entries.map((entry, index) => {
          if (index === draggingIndex) return null;
          let slot = nextSlot;
          nextSlot += 1;
          if (gapSlot !== null && slot >= gapSlot) slot += 1;
          const slide = {
            left: slot * RACK_SLOT_W,
            // Slot slides at the spec's reflow; transform carries the 90ms
            // tap-pop (the active:scale below acknowledges the press).
            transition: `left ${REFLOW_MS}ms ${EASE_REFLOW}, transform 90ms ${EASE_REFLOW}`,
          };
          if (entry.tile === null) {
            // Reserved: the tile is on the board; the slot waits for it.
            return (
              <div
                key={entry.id}
                data-testid={`rack-slot-reserved-${index}`}
                className="absolute top-0 box-border h-[50px] w-11 rounded-md border-[1.5px] border-dashed border-board-frame"
                style={slide}
              />
            );
          }
          const tile = entry.tile;
          const isSelected = selected.includes(index);
          const shadow = isSelected
            ? 'inset 0 -3px 0 #d9bf8a, 0 0 0 2px #2563eb, 0 2px 6px rgba(37,99,235,.4)'
            : 'inset 0 -3px 0 #d9bf8a, 0 1px 3px rgba(0,0,0,.2)';
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`rack-tile-${index}`}
              onClick={() => { onTileTap(index); }}
              onPointerDown={onTilePointerDown === undefined ? undefined : (e) => { onTilePointerDown(index, e); }}
              className={`absolute top-0 flex h-[50px] w-11 items-center justify-center rounded-md bg-tile font-tile text-lg font-bold active:scale-[1.12] ${
                tile === '_' ? 'text-tile-blank' : 'text-tile-ink'
              } ${entry.fresh === undefined ? '' : 'wg-refill'}`}
              style={{
                ...slide,
                boxShadow: shadow,
                ...(onTilePointerDown === undefined ? {} : { touchAction: 'none' }),
                ...(hiddenId === entry.id ? { opacity: 0 } : {}),
                ...(entry.fresh === undefined ? {} : { animationDelay: `${entry.fresh * STAGGER_MS}ms` }),
              }}
            >
              {tile === '_' ? '·' : tile}
              <span className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none">
                {TILE_VALUES[tile]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="w-2 flex-none" />
      {/* The bag as a quiet counter tile — big count, small LEFT caption
        * (Word Game Hi-Fi.dc.html, linen revision 2026-09-01). Keyed by the
        * count so a draw remounts it and the pulse plays. */}
      <div
        key={bagCount}
        data-testid="bag-tile"
        className="wg-bag-pulse relative box-border flex h-[50px] w-11 flex-none flex-col items-center justify-center gap-[1px] rounded-md border-[1.5px] border-board-frame bg-[#f1ece0]"
        title={`${bagCount} tiles left in the bag`}
      >
        <span className="font-tile text-[15px] font-bold leading-none text-ink-soft">{bagCount}</span>
        <span className="text-[7.5px] font-bold tracking-[.06em] text-ink-ghost">LEFT</span>
      </div>
    </div>
  );
}
