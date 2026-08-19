import type { Coord, GameState, StartupId } from './gameTypes';
import { getAdjacentCoords, floodFillUnclaimed, getStartupSize } from './gameHelpers';
import { SAFE_SIZE, getSharePriceAtSize } from './startups';

export type PlacementKind = 'isolated' | 'found' | 'grow' | 'merge';
export type PlacementBlock = 'notInHand' | 'occupied' | 'mergesSafeChains' | 'noBrandAvailable';

export interface ChainPriceChange {
  size: number;
  price: number;
  nextSize: number;
  nextPrice: number;
}

export interface PlacementPreview {
  coord: Coord;
  legal: boolean;
  block?: PlacementBlock;
  kind: PlacementKind;
  touchingIds: StartupId[];
  loneAdj: Coord[];
  survivorId?: StartupId;
  tiedSurvivorIds?: StartupId[];
  absorbedIds: StartupId[];
  prices: Record<string, ChainPriceChange>;
}

function tierOf(state: GameState, id: StartupId): 0 | 1 | 2 {
  return (state.startups[id]?.tier ?? 0) as 0 | 1 | 2;
}

function change(state: GameState, id: StartupId, nextSize: number): ChainPriceChange {
  const tier = tierOf(state, id);
  const size = getStartupSize(state, id);
  return {
    size,
    price: getSharePriceAtSize(tier, size),
    nextSize,
    nextPrice: getSharePriceAtSize(tier, nextSize),
  };
}

export function previewPlacement(state: GameState, coord: Coord, playerId?: string): PlacementPreview {
  const adj = getAdjacentCoords(coord);
  const touchingIds = [...new Set(
    adj.map((c) => state.board[c]?.startupId).filter((id): id is StartupId => !!id),
  )];
  const loneAdj = adj.filter((c) => state.board[c]?.placed && !state.board[c]?.startupId);

  const preview: PlacementPreview = {
    coord,
    legal: true,
    kind: 'isolated',
    touchingIds,
    loneAdj,
    absorbedIds: [],
    prices: {},
  };

  if (state.board[coord]?.placed) {
    return { ...preview, legal: false, block: 'occupied' };
  }
  if (playerId !== undefined) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.hand.includes(coord)) {
      return { ...preview, legal: false, block: 'notInHand' };
    }
  }

  if (touchingIds.length === 0) {
    preview.kind = loneAdj.length > 0 ? 'found' : 'isolated';
    if (preview.kind === 'found' && Object.values(state.startups).every((s) => s.isFounded)) {
      preview.legal = false;
      preview.block = 'noBrandAvailable';
    }
    return preview;
  }

  const sized = touchingIds
    .map((id) => ({ id, size: getStartupSize(state, id) }))
    .sort((a, b) => b.size - a.size);

  // Tiles reachable through the placement's own unclaimed neighbours (not
  // through `coord` itself, since `coord` isn't actually on the board yet —
  // this is a preview, so nothing is mutated).
  const absorbedLoners = floodFillUnclaimed(loneAdj, state.board).length;

  const [largest] = sized;
  // Unreachable: `touchingIds.length === 0` returned above and `sized` is a
  // map over it, so this only tells the compiler what the early return proved.
  if (!largest) return preview;

  if (sized.length === 1) {
    preview.kind = 'grow';
    // +1 for the placed tile itself, which isn't on the board to be counted.
    preview.prices[largest.id] = change(state, largest.id, largest.size + 1 + absorbedLoners);
    return preview;
  }

  preview.kind = 'merge';

  if (sized.filter((s) => s.size >= SAFE_SIZE).length > 1) {
    preview.legal = false;
    preview.block = 'mergesSafeChains';
    return preview;
  }

  const top = largest.size;
  const tied = sized.filter((s) => s.size === top);
  const total = sized.reduce((n, s) => n + s.size, 0) + 1 + absorbedLoners;

  if (tied.length > 1) {
    // Survivor identity is undecided, but the resulting combined size is
    // deterministic regardless of which tied chain wins — so report each
    // tied candidate's price if it survives, paired with tiedSurvivorIds
    // to signal the ambiguity to the caller.
    preview.tiedSurvivorIds = tied.map((s) => s.id);
    for (const s of tied) preview.prices[s.id] = change(state, s.id, total);
  } else {
    preview.survivorId = largest.id;
    preview.absorbedIds = sized.slice(1).map((s) => s.id);
    preview.prices[largest.id] = change(state, largest.id, total);
    for (const s of sized.slice(1)) preview.prices[s.id] = change(state, s.id, 0);
  }
  return preview;
}

export function isDeadTile(state: GameState, coord: Coord): boolean {
  return previewPlacement(state, coord).block === 'mergesSafeChains';
}

export function getDeadTilesInHand(state: GameState, playerId: string): Coord[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  return player.hand.filter((c) => isDeadTile(state, c));
}
