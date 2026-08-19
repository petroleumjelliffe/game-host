import type { GameState, Player, MergerContext } from "./gameTypes";
import { Coord,
  compareTiles,
  getAdjacentCoords,
  floodFillUnclaimed,
  getTilesForStartup,
  getStartupSize,
  turnPlayer,
} from "./gameHelpers";
import { tok, pushLog } from "./log";
import {
  getSharePriceAtSize,
  SAFE_SIZE,
  MAX_BUYS_PER_TURN,
  HAND_SIZE,
  TRADE_RATIO,
  isStartupId,
} from "./startups";
import { previewPlacement } from "./placement";
import { computeChainBonuses, type BonusResult } from "./bonuses";

//----------------------------------------------------
// STARTUP CONFIG
//----------------------------------------------------

export { AVAILABLE_STARTUPS } from "./startups";
export type { BonusResult } from "./bonuses";

export function createMergerContext(
  survivorId: string,
  absorbedIds: string[]
): MergerContext {
  return {
    survivorId,
    absorbedIds,
    resolved: false,

    // payout phase defaults
    payoutQueue: [],
    currentChoiceIndex: 0,
    absorbedPrices: {}, // Pre-merger prices for each absorbed startup

    // liquidation phase defaults
    currentLiquidationIndex: -1,
    shareholderQueue: [],
    currentShareholderIndex: -1,
    activePlayerId: undefined,
  };
}

//----------------------------------------------------
// INITIAL DRAW + DEALING
//----------------------------------------------------

export function resolveInitialDraw(state: GameState) {
  const drawn = state.players.map((p) => ({
    name: p.name,
    tile: state.bag.shift()!,
  }));

  for (const d of drawn) state.board[d.tile].placed = true;

  // Set lastPlacedTile for each player to show the indicator during draw phase
  for (const d of drawn) {
    const player = state.players.find((p) => p.name === d.name);
    if (player) {
      player.lastPlacedTile = d.tile;
    }
  }

  // Highest letter, then highest number, goes first — the same rule the
  // `startGame` intent applies. This legacy path still serves online play via
  // `Game.tsx`, and one game cannot have two turn-order rules. (It also still
  // double-counts its tiles a few lines below; that is a separate, documented
  // defect this path takes to the grave in Phase 3.)
  const sorted = [...drawn].sort((a, b) => compareTiles(b.tile, a.tile));
  const firstName = sorted[0]!.name;
  const firstIndex = state.players.findIndex((p) => p.name === firstName);

  // return tiles to bag end
  for (const d of drawn) state.bag.push(d.tile);

  pushLog(state, 'Drew tiles', sorted.flatMap((d, i) => [
    tok.text(i === 0 ? `${d.name}→` : `, ${d.name}→`),
    tok.tile(d.tile),
  ]));
  pushLog(state, 'Drew tiles', [tok.text('will go first')], state.players[firstIndex]!.id);

  return { drawn: sorted, firstIndex };
}

export function dealOneRound(state: GameState) {
  for (const p of state.players) {
    if (p.hand.length < HAND_SIZE && state.bag.length > 0) {
      p.hand.push(state.bag.shift()!);
    }
  }
}

export function allHandsFull(state: GameState) {
  return state.players.every((p) => p.hand.length >= HAND_SIZE);
}

//----------------------------------------------------
// TILE PLACEMENT LOGIC
//----------------------------------------------------

export function handleTilePlacement(state: GameState, coord: Coord): GameState {
  const player = turnPlayer(state);
  const cell = state.board[coord];
  if (!player.hand.includes(coord) || cell.placed) return state;

  const adj = getAdjacentCoords(coord);
  const adjStartups = new Set<string>();
  const adjUnclaimed: Coord[] = [];

  for (const n of adj) {
    const c = state.board[n];
    if (!c?.placed) continue;
    if (c.startupId) adjStartups.add(c.startupId);
    else adjUnclaimed.push(n);
  }

  // Safe-chain rule — delegates to previewPlacement so there is one
  // definition of this rule in the codebase.
  if (adjStartups.size >= 2) {
    const preview = previewPlacement(state, coord, player.id);
    if (!preview.legal) {
      const touching = [...adjStartups];
      const safeChains = touching.filter((id) => getStartupSize(state, id) >= SAFE_SIZE);
      pushLog(state, 'Merger', [
        tok.text('Attempted illegal merge involving safe chain(s): '),
        ...safeChains.flatMap((id, i) => i === 0 ? [tok.brand(id)] : [tok.text(', '), tok.brand(id)]),
      ], player.id);
      return state; // 🚫 block placement
    }
  }

  // Place tile
  cell.placed = true;

  // Track last placed tile for this player
  player.lastPlacedTile = coord;

  if (adjStartups.size === 0) {
    // Found new startup?
    if (adjUnclaimed.length > 0 && getAvailableStartups(state).length > 0) {
      //change state to found, in order to trigger the FoundStartupModal
      state.stage = "foundStartup";
      state.pendingFoundTile = coord;
      pushLog(state, 'Placed a tile', [
        tok.tile(coord),
        tok.text(' — choose a startup to found'),
      ], player.id);

      // The brand choice itself is the client's: the game parks on
      // `foundStartup` and waits for the `chooseFoundingBrand` intent, which
      // calls `foundStartup(state, id, coord)` to claim the group, grant the
      // founder share and move on to `buy`.
    } else {
      // The coordinate alone. Every other branch here says what the placement
      // *did* — grew, founded, merged — and a placement that did none of those
      // has nothing to add; "(isolated)" was jargon for "nothing happened".
      pushLog(state, 'Placed a tile', [tok.tile(coord)], player.id);
      //enter buy stage
      state.stage = "buy";
      state.currentBuyCount = 0;
    }
  } else if (adjStartups.size === 1) {
    // Expand existing startup
    const id = [...adjStartups][0]!; // size === 1, checked above
    const group = floodFillUnclaimed([coord, ...adjUnclaimed], state.board);
    for (const g of group) state.board[g].startupId = id;
    pushLog(state, 'Placed a tile', [
      tok.tile(coord),
      tok.text(' expanded '),
      tok.brand(id),
      tok.text(` to ${getTilesForStartup(state.board, id).length} tiles`),
    ], player.id);
    //enter buy stage
    state.stage = "buy";
    state.currentBuyCount = 0;
  } else {
    // Merge multiple startups
    const touchingIds = [...adjStartups];
    const sizes = touchingIds
      .map((id) => ({
        id,
        size: getTilesForStartup(state.board, id).length,
      }))
      .sort((a, b) => b.size - a.size);

    const top = sizes[0]!; // two or more touching startups, checked above
    const next = sizes[1];

    // Check if there's a tie - if so, show modal to choose survivor
    if (next && top.size === next.size) {
      const tied = sizes.filter((s) => s.size === top.size).map((s) => s.id);

      // Set stage to chooseSurvivor and store pending merger info
      state.stage = "chooseSurvivor";
      state.pendingMergerTile = coord;
      state.pendingTiedStartups = tied;
      state.pendingMergerStartups = touchingIds;
      // Every other board-mutating placement branch logs 'Placed a tile';
      // this one used to log nothing at all, so a tied merger's turn left no
      // trace of the tile that caused it. Phase 1's step stack is built from
      // `state.log`, so a silent segment is a hole in the feature.
      pushLog(state, 'Placed a tile', [
        tok.tile(coord),
        tok.text(' — choose which startup survives'),
      ], player.id);
    } else {
      // No tie - proceed with automatic survivor selection
      const survivorId = top.id;

      const absorbedIds = touchingIds.filter((id) => id !== survivorId);

      // ✅ FIX: Capture pre-merger prices BEFORE modifying board state
      const absorbedPrices: Record<string, number> = {};
      for (const absorbedId of absorbedIds) {
        absorbedPrices[absorbedId] = getSharePrice(state, absorbedId);
      }

      // Claim adjacent unclaimed before merging
      const group = floodFillUnclaimed([coord, ...adjUnclaimed], state.board);
      for (const g of group) state.board[g].startupId = survivorId;

      mergeStartups(state, survivorId, absorbedIds);
      // The played coord, before the merger entry. Without it the log's
      // account of a merger turn read "nothing happened, then two chains
      // merged somewhere" — the merger entry names the chains but never the
      // tile that joined them.
      pushLog(state, 'Placed a tile', [
        tok.tile(coord),
        tok.text(' triggered a merger'),
      ], player.id);
      pushLog(state, 'Merger', [
        ...absorbedIds.flatMap((id, i) => i === 0 ? [tok.brand(id)] : [tok.text(', '), tok.brand(id)]),
        tok.text(' into '),
        tok.brand(survivorId),
      ], player.id);

      state.stage = "mergerPayout";
      prepareMergerPayout(state, survivorId, absorbedIds, absorbedPrices);
    }
  }

  // Store the tile to be removed from hand after confirmation
  // Don't draw a new tile yet - wait for modal confirmation
  state.pendingTileToRemove = coord;

  //don't move to next player yet
  // state.turnIndex = (state.turnIndex + 1) % state.players.length;
  return state;
}

/**
 * Completes the tile transaction by removing the played tile from hand and drawing a new one.
 * Call this after the player confirms their action (after modal closes).
 */
export function completeTileTransaction(state: GameState) {
  if (!state.pendingTileToRemove) return;

  const player = turnPlayer(state);
  const coord = state.pendingTileToRemove;

  // Remove the played tile from hand
  player.hand = player.hand.filter((t) => t !== coord);

  // Draw a new tile from the bag
  const draw = state.bag.shift();
  if (draw) player.hand.push(draw);

  // Clear the pending tile
  state.pendingTileToRemove = undefined;
}

/**
 * Cancels a pending tile placement by reverting board changes.
 * Call this when a modal is cancelled.
 */
export function cancelTilePlacement(state: GameState) {
  if (!state.pendingTileToRemove) return state;

  const coord = state.pendingTileToRemove;
  const player = turnPlayer(state);

  // Unplace the tile
  const cell = state.board[coord];
  cell.placed = false;
  cell.startupId = undefined;

  // Clear last placed tile indicator
  player.lastPlacedTile = undefined;

  // Remove any startup that was founded with this tile
  if (state.pendingFoundTile === coord) {
    // Find and unfound any startup that was founded with this tile
    for (const startup of Object.values(state.startups)) {
      if (startup.foundingTile === coord) {
        startup.isFounded = false;
        startup.foundingTile = null;
        startup.tiles = [];
        // Reset all tiles that were assigned to this startup
        for (const [tileCoord, tileCell] of Object.entries(state.board)) {
          if (tileCell.startupId === startup.id) {
            tileCell.startupId = undefined;
            // If this tile was placed as part of the founding, unplace it
            if (tileCell.placed && tileCoord !== coord) {
              // Leave other placed tiles as they were
            }
          }
        }
      }
    }
    state.pendingFoundTile = undefined;
  }

  // Clear merger context if there was one
  if (state.mergerContext) {
    // Revert any mergers that happened
    // This is complex - for now we'll rely on not calling this during mergers
    state.mergerContext = undefined;
  }

  // Clear pending tile
  state.pendingTileToRemove = undefined;

  // Reset stage to play
  state.stage = "play";

  // Remove the last log entry that was about this placement
  if (state.log.length > 0) {
    state.log.pop();
  }

  return state;
}

//----------------------------------------------------
// STARTUP ASSIGNMENT + MERGER
//----------------------------------------------------

export function assignTilesToStartup(state: GameState, id: string) {
  //assign given tiles to the givien startup id
}

export function returnBrandToAvailable(state: GameState, id: string) {
  // Only return if not already available and not active
  // if (state.startups[id]) return; // still active
  const startup = state.startups[id];
  if (!startup) return;
  startup.isFounded = false;
  startup.foundingTile = null;
}

/**
 * Completes a merger with a chosen survivor after user selects in modal.
 * Called from SurvivorSelectionModal after user confirms their choice.
 */
export function completeSurvivorSelection(state: GameState, survivorId: string) {
  const coord = state.pendingMergerTile;
  const touchingIds = state.pendingMergerStartups;

  if (!coord || !touchingIds) {
    console.error("Missing pending merger data");
    return;
  }

  const player = turnPlayer(state);

  // Get adjacent coords for unclaimed tiles
  const adj = getAdjacentCoords(coord);
  const adjUnclaimed: Coord[] = [];
  for (const n of adj) {
    const c = state.board[n];
    if (c?.placed && !c.startupId) {
      adjUnclaimed.push(n);
    }
  }

  const absorbedIds = touchingIds.filter((id) => id !== survivorId);

  // ✅ FIX: Capture pre-merger prices BEFORE modifying board state
  const absorbedPrices: Record<string, number> = {};
  for (const absorbedId of absorbedIds) {
    absorbedPrices[absorbedId] = getSharePrice(state, absorbedId);
  }

  // Claim adjacent unclaimed before merging
  const group = floodFillUnclaimed([coord, ...adjUnclaimed], state.board);
  for (const g of group) state.board[g].startupId = survivorId;

  mergeStartups(state, survivorId, absorbedIds);
  pushLog(state, 'Merger', [
    ...absorbedIds.flatMap((id, i) => i === 0 ? [tok.brand(id)] : [tok.text(', '), tok.brand(id)]),
    tok.text(' into '),
    tok.brand(survivorId),
  ], player.id);

  // Complete the tile transaction (remove from hand, draw new tile)
  completeTileTransaction(state);

  // Clear pending merger data
  state.pendingMergerTile = undefined;
  state.pendingTiedStartups = undefined;
  state.pendingMergerStartups = undefined;

  state.stage = "mergerPayout";
  prepareMergerPayout(state, survivorId, absorbedIds, absorbedPrices);
}

// `chooseFoundingBrand` and `pickMergeSurvivor` lived here as dev stubs that
// called `window.prompt`. Both were dead — nothing in engine/, src/, server/
// or prototype/ referenced either — but both were exported through the
// engine barrel that server/ imports, so a Node caller reaching for the
// invitingly-named `chooseFoundingBrand` would have hit
// `ReferenceError: window is not defined` at runtime. The live replacements
// are `foundStartup` (below) and `completeSurvivorSelection` (above); the
// *choice* itself belongs to the client, arriving as the
// `chooseFoundingBrand` / `chooseSurvivor` intents. Do not reintroduce a
// browser global in engine/ — the `engine` vitest project runs under
// `environment: 'node'` specifically so that such a call fails a test.

/**
 * Count how many tiles belong to each startup ID.
 */
// export function getStartupSize(state: GameState, id: string): number {
//   let count = 0;
//   for (const cell of Object.values(state.board)) {
//     if (cell.startupId === id) count++;
//   }
//   return count;
// }

/**
 * Returns true if ANY of the given startups are "safe" (>=11 tiles).
 */
// function anySafe(ids: string[], state: GameState): boolean {
//   for (const id of ids) {
//     const size = getStartupSize(state, id);
//     if (size >= 11) return true;
//   }
//   return false;
// }

/**
 * Create a new startup on the board.
 */
export function foundStartup(
  state: GameState,
  id: string,
  foundingTile: Coord
  // tier: number
) {
  const s = state.startups[id];
  if (!s) return;
  s.isFounded = true;
  s.foundingTile = foundingTile;

  // Mark the founding tile and its connected placed neighbors
  const toVisit = [foundingTile];
  const visited = new Set();

  while (toVisit.length) {
    const tile = toVisit.pop()!;
    if (visited.has(tile)) continue;
    visited.add(tile);

    const cell = state.board[tile];
    if (!cell?.placed || cell.startupId) continue;

    cell.startupId = id;

    for (const adj of getAdjacentCoords(tile)) {
      const adjCell = state.board[adj];
      if (adjCell && adjCell.placed && !adjCell.startupId) {
        toVisit.push(adj);
      }
    }
  }

  /*
    The placement told you to choose; now that you have, it says what you
    chose. That entry was written while the game was *asking* — "I12 — choose a
    startup to found" — and leaving it there after the answer left an
    instruction sitting in the history, next to a founding entry repeating the
    same tile.

    Rewritten rather than derived at render time because it is a fact about the
    placement, not a way of displaying it: this tile founded PaperfulPost. Undo
    handles it for free — the log is state, so rewinding to before the founding
    restores the question along with the stage that was asking it.
  */
  const placement = [...state.log].reverse().find(
    (entry) => entry.phase === 'Placed a tile'
      && entry.detail.some((t) => t.kind === 'tile' && t.coord === foundingTile),
  );
  if (placement) {
    placement.detail = [tok.tile(foundingTile), tok.text(' founded '), tok.brand(id)];
  }

  grantFoundingShare(state, turnPlayer(state).id, id);
  // What this step uniquely records: the share the founder is awarded, carried
  // as a payload so the panel can render the certificate itself rather than a
  // sentence about it. The tile and the startup are on the placement above.
  pushLog(
    state,
    'Founded a startup',
    [],
    turnPlayer(state).id,
    { kind: 'founding', startupId: id, shares: 1 },
  );

  state.stage = "buy";
  delete state.pendingFoundTile;
  return state;
}

/**
 * Merge absorbed startups into a surviving one.
 * Board is the source of truth — we just rewrite startupIds.
 */
export function mergeStartups(
  state: GameState,
  survivorId: string,
  absorbedIds: string[]
) {
  // Return absorbed brands to available pool
  for (const id of absorbedIds) {
    const absorbed = state.startups[id];
    if (!absorbed) return;
    returnBrandToAvailable(state, id);

    // Reset player portfolios
    //trigger payouts for majority holders, and sell off stocks back to bank
    // set abosrobed tile to survivor
    for (const [coord, cell] of Object.entries(state.board)) {
      if (absorbedIds.includes(cell.startupId || "")) {
        cell.startupId = survivorId;
      }
    }
  }
}

/**
 * Get all startup IDs adjacent to a given coordinate.
 */
function getTouchingStartups(state: GameState, coord: Coord): string[] {
  const ids = new Set<string>();
  for (const adj of getAdjacentCoords(coord)) {
    const cell = state.board[adj];
    if (cell?.startupId) ids.add(cell.startupId);
  }
  return [...ids];
}

//----------------------------------------------------
// TURN MANAGEMENT
//----------------------------------------------------

export function advanceTurn(state: GameState) {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
}

//get share price based on tier and size
export function getSharePrice(state: GameState, startupId: string): number {
  const startup = state.startups[startupId];
  if (!startup) return 0;
  return getSharePriceAtSize(startup.tier, getStartupSize(state, startupId));
}

export const getAvailableStartups = function (state: GameState) {
  return Object.values(state.startups).filter((s) => !s.isFounded);
};

export function getActiveStartups(state: GameState) {
  return Object.values(state.startups).filter((s) => s.isFounded);
}

export function getBuyableStartups(state: GameState) {
  return Object.values(state.startups)
    .filter((s) => s.isFounded && s.availableShares > 0)
    .map((s) => ({
      id: s.id,
      price: getSharePrice(state, s.id),
      availableShares: s.availableShares,
      tier: s.tier,
    }));
}

export function grantFoundingShare(
  state: GameState,
  playerId: string,
  startupId: string
) {
  const player = state.players.find((p) => p.id === playerId);
  const startup = state.startups[startupId];
  if (!player || !startup) return;

  if (startup.availableShares > 0) {
    startup.availableShares -= 1;
    player.portfolio[startupId] = (player.portfolio[startupId] || 0) + 1;
    // Deliberately silent. Founding is **one** action and gets one step: this
    // used to log "Received a free share of X for founding it" and then
    // `foundStartup` logged "X at C4" straight after, so the stack showed the
    // same step twice under the same phase. The share itself is not lost by
    // saying less — it appears in the player's holdings, which is where every
    // other share they own appears.
  }
}

export function buyShares(
  state: GameState,
  playerId: string,
  startupId: string,
  count: number
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  const startup = state.startups[startupId];
  if (!player || !startup || !startup.isFounded) return false;

  const remainingAllowance = MAX_BUYS_PER_TURN - (state.currentBuyCount || 0);
  const buyCount = Math.min(count, remainingAllowance, startup.availableShares);
  if (buyCount <= 0) return false;

  const price = getSharePrice(state, startupId);
  const total = price * buyCount;
  if (player.cash < total) return false;

  player.cash -= total;
  player.portfolio[startupId] = (player.portfolio[startupId] || 0) + buyCount;
  startup.availableShares -= buyCount;
  state.currentBuyCount = (state.currentBuyCount || 0) + buyCount;

  pushLog(state, 'Bought shares', [
    tok.stack(startupId, buyCount),
    tok.text(' for '),
    tok.cash(total),
  ], player.id);
  return true;
}

export function endBuyPhase(state: GameState) {
  state.stage = "play";
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  state.currentBuyCount = 0;
  return state;
}
export function prepareMergerPayout(
  state: GameState,
  survivorId: string,
  absorbedIds: string[],
  absorbedPrices: Record<string, number>
) {
  const allBonuses: BonusResult[] = [];

  for (const absorbedId of absorbedIds) {
    // ✅ FIX: Use pre-merger price from passed-in prices
    // Every caller fills `absorbedPrices` from `absorbedIds`, so the lookup
    // always hits; asserting keeps the arithmetic identical either way.
    const price = absorbedPrices[absorbedId]!;

    const holdings = state.players.map((p) => ({
      playerId: p.id,
      playerName: p.name,
      shares: p.portfolio[absorbedId] || 0,
    }));

    // `absorbedIds` is `string[]` (see the `todo` on `Startup.id` in
    // gameTypes.ts), but every id here always came from a founded startup —
    // `isStartupId` narrows it for real instead of asserting it away.
    if (isStartupId(absorbedId)) {
      allBonuses.push(...computeChainBonuses(absorbedId, price, holdings));
    }
  }

  // Store merger context for UI
  state.mergerContext = createMergerContext(survivorId, absorbedIds);
  // ✅ FIX: Store pre-merger prices in merger context
  state.mergerContext.absorbedPrices = absorbedPrices;
  state.stage = "mergerPayout";

  // Save the computed bonuses for the modal
  state.pendingBonuses = allBonuses;
}

/**
 * Builds shareholder queue starting from current player and wrapping around.
 * Only includes players who own shares in the given startup.
 */
function buildShareholderQueue(state: GameState, startupId: string): string[] {
  const shareholders: string[] = [];
  const numPlayers = state.players.length;

  // Start from current turn player and wrap around
  for (let i = 0; i < numPlayers; i++) {
    const playerIndex = (state.turnIndex + i) % numPlayers;
    const player = state.players[playerIndex]!;
    if ((player.portfolio[startupId] || 0) > 0) {
      shareholders.push(player.id);
    }
  }

  return shareholders;
}

function bonusLabel(type: 'majority' | 'minority' | 'both'): string {
  return type === 'both' ? 'Majority + minority' : type === 'majority' ? 'Majority' : 'Minority';
}

export function finalizeMergerPayout(state: GameState) {
  const bonuses: BonusResult[] = state.pendingBonuses ?? [];

  // Award bonuses. One log entry for the whole payout, not one per payee:
  // a payout is a single consequence of the merge, so it should be a single
  // step in the stack — and `PayoutLines` renders the set, not a line at a
  // time. The bonuses ride along as a payload because `pendingBonuses` is
  // cleared a few lines below, inside this same `applyIntent` call.
  for (const b of bonuses) {
    const player = state.players.find((p) => p.id === b.playerId);
    if (player) player.cash += b.amount;
  }

  if (bonuses.length > 0) {
    const entry = pushLog(state, 'Merger payout', bonuses.flatMap((b, i) => [
      tok.text(`${i === 0 ? '' : ', '}${b.playerName} ${bonusLabel(b.type).toLowerCase()} `),
      tok.cash(b.amount, true),
    ]));
    entry.payload = { kind: 'payout', bonuses };
  }

  state.pendingBonuses = undefined;

  // Now transition to liquidation phase
  const ctx = state.mergerContext!;
  if (!ctx) {
    state.stage = "buy";
    return;
  }

  // Start processing first absorbed startup
  ctx.currentLiquidationIndex = 0;
  const firstAbsorbed = ctx.absorbedIds[0];
  if (firstAbsorbed === undefined) {
    throw new Error('a merger reached liquidation with no absorbed startups');
  }

  // Build shareholder queue starting from current player
  const shareholders = buildShareholderQueue(state, firstAbsorbed);

  ctx.shareholderQueue = shareholders;
  ctx.currentShareholderIndex = 0;
  // Note: Pre-merger price already stored in ctx.absorbedPrices[firstAbsorbed]

  if (shareholders.length > 0) {
    ctx.activePlayerId = shareholders[0];
    state.stage = "mergerLiquidation";
  } else {
    // No shareholders, skip to next or finish
    advanceToNextAbsorbedStartup(state);
  }
}

/**
 * Helper to advance to the next absorbed startup or finish merger
 */
export function advanceToNextAbsorbedStartup(state: GameState) {
  const ctx = state.mergerContext!;
  if (!ctx) return;

  // Clean up current absorbed startup
  const currentAbsorbed = ctx.absorbedIds[ctx.currentLiquidationIndex];
  if (currentAbsorbed === undefined) {
    throw new Error(
      `merger liquidation index ${ctx.currentLiquidationIndex} is past its ${ctx.absorbedIds.length} absorbed startups`
    );
  }
  const s = state.startups[currentAbsorbed];
  if (!s) throw new Error(`merger absorbed an unknown startup: ${currentAbsorbed}`);
  s.isFounded = false;
  s.foundingTile = null;

  // Shares a player chose to keep are still outstanding — they are not
  // "returned to the bank" the way sold/traded shares are, and the chain may
  // be refounded later with those shares regaining value. So the pool must
  // only reclaim what nobody is holding, mirroring the (already correct)
  // legacy `completeLiquidation` path below. Do NOT zero player portfolios
  // here: that would silently destroy a `keep` choice with no cash and no
  // survivor share in exchange.
  const heldShares = state.players.reduce(
    (sum, p) => sum + (p.portfolio[currentAbsorbed] || 0),
    0
  );
  s.availableShares = s.totalShares - heldShares;

  pushLog(state, 'Liquidated shares', [tok.brand(currentAbsorbed), tok.text(' has been liquidated')]);

  // Move to next absorbed startup
  ctx.currentLiquidationIndex += 1;

  if (ctx.currentLiquidationIndex < ctx.absorbedIds.length) {
    // Process next absorbed startup
    const nextAbsorbed = ctx.absorbedIds[ctx.currentLiquidationIndex]!; // in range, checked above
    // Build shareholder queue starting from current player
    const shareholders = buildShareholderQueue(state, nextAbsorbed);

    ctx.shareholderQueue = shareholders;
    ctx.currentShareholderIndex = 0;
    // Note: Pre-merger price already stored in ctx.absorbedPrices[nextAbsorbed]

    if (shareholders.length > 0) {
      ctx.activePlayerId = shareholders[0];
      state.stage = "mergerLiquidation";
    } else {
      // No shareholders for this one either, recurse
      advanceToNextAbsorbedStartup(state);
    }
  } else {
    // All absorbed startups processed
    delete state.mergerContext;
    state.stage = "buy";
    pushLog(state, 'Merger', [tok.text('Merger complete. Entering buy phase.')]);
  }
}

export function completePlayerMergerLiquidation(
  state: GameState,
  playerId: string,
  {
    absorbedId,
    trade,
    sell,
  }: {
    absorbedId: string;
    trade: number;
    sell: number;
  }
) {
  const ctx = state.mergerContext;
  if (!ctx) return;

  const player = state.players.find((p) => p.id === playerId)!;
  const survivor = state.startups[ctx.survivorId];
  const absorbed = state.startups[absorbedId];
  if (!survivor) throw new Error(`merger survivor is an unknown startup: ${ctx.survivorId}`);
  if (!absorbed) throw new Error(`merger absorbed an unknown startup: ${absorbedId}`);
  // ✅ FIX: Use pre-merger price from merger context
  const sharePrice = ctx.absorbedPrices[absorbedId] || 0;

  const tradeCost = trade * TRADE_RATIO;
  const sellGain = sell * sharePrice;
  const beforeHolding = player.portfolio[absorbedId] || 0;
  const hold = beforeHolding - tradeCost - sell;

  // Deduct absorbed shares, clamped at zero — the same two steps as before,
  // said once now that the pre-deduction holding is already in `beforeHolding`.
  player.portfolio[absorbedId] = Math.max(0, beforeHolding - tradeCost - sell);

  // Conservation: credit the bank with exactly what left the portfolio above
  // (`beforeHolding - portfolio[absorbedId]`), not the requested `tradeCost +
  // sell` — if the clamp two lines up ever fires (a holding smaller than
  // requested), crediting the requested amount would manufacture shares.
  // Doing this here, at the moment the shares leave the portfolio, keeps
  // `held + availableShares === totalShares` true after *every* intent, not
  // only once `advanceToNextAbsorbedStartup`'s end-of-chain reconciliation
  // runs; that reconciliation stays in place as a backstop and is now
  // idempotent given this line already keeps the pool correct.
  absorbed.availableShares += beforeHolding - player.portfolio[absorbedId]!;

  // Add survivor shares if traded
  if (trade > 0) {
    player.portfolio[ctx.survivorId] = (player.portfolio[ctx.survivorId] || 0) + trade;
    survivor.availableShares -= trade;
    pushLog(state, 'Liquidated shares', [
      tok.stack(absorbedId, tradeCost),
      tok.text(' for '),
      tok.stack(ctx.survivorId, trade),
    ], player.id);
  }

  // Add cash from sells
  if (sell > 0) {
    player.cash += sellGain;
    pushLog(state, 'Liquidated shares', [
      tok.stack(absorbedId, sell),
      tok.text(' sold for '),
      tok.cash(sellGain),
    ], player.id);
  }

  if (hold > 0) {
    pushLog(state, 'Liquidated shares', [tok.stack(absorbedId, hold), tok.text(' held')], player.id);
  }

  // Advance to next shareholder
  ctx.currentShareholderIndex += 1;

  if (ctx.currentShareholderIndex < ctx.shareholderQueue.length) {
    // Next player for same absorbed startup
    ctx.activePlayerId = ctx.shareholderQueue[ctx.currentShareholderIndex];
  } else {
    // All shareholders done for this absorbed startup, move to next
    advanceToNextAbsorbedStartup(state);
  }
}

//----------------------------------------------------
// POST-MERGER LIQUIDATION LOGIC
//----------------------------------------------------

/**
 * Initialize the liquidation phase after bonuses have been distributed.
 * Handles multiple absorbed startups sequentially.
 */
export function startLiquidations(
  state: GameState,
  survivorId: string,
  absorbedIds: string[]
) {
  state.pendingLiquidations = [...absorbedIds];
  state.currentLiquidation = null;
  state.mergerContext = createMergerContext(
    survivorId,
    absorbedIds)
    // resolved: false,
    // payoutQueue: [],
    // sharePrice: 0, // to be set per absorbed startup
    // currentLiquidationIndex: -1,
    // shareholderQueue: [],
    // currentShareholderIndex: -1,
  
  state.stage = "liquidation";
  nextLiquidation(state);
}

/**
 * Moves to the next absorbed startup in the queue.
 */
export function nextLiquidation(state: GameState) {
  if (!state.pendingLiquidations?.length) {
    finalizeAllLiquidations(state);
    return;
  }

  const absorbedId = state.pendingLiquidations.shift()!;
  state.currentLiquidation = absorbedId;

  const shareholders = getShareholders(state, absorbedId);
  if (shareholders.length === 0) {
    // No shareholders → auto cleanup
    completeLiquidation(state, absorbedId);
    return;
  }

  // Initialize shareholder queue
  state.mergerContext!.shareholderQueue = shareholders.map((p) => p.id);
  state.mergerContext!.currentShareholderIndex = 0;
  const currentPlayerId = shareholders[0]!.id; // non-empty, checked above

  // Move to modal stage
  state.stage = "liquidationPrompt";
  state.mergerContext!.activePlayerId = currentPlayerId;
}

/**
 * Returns a list of players who hold shares in a startup.
 */
export function getShareholders(state: GameState, startupId: string): Player[] {
  return state.players.filter((p) => (p.portfolio[startupId] || 0) > 0);
}

/**
 * Applies a player's liquidation choice and advances to the next shareholder.
 *
 * @deprecated — not on the intent path; see completePlayerMergerLiquidation.
 * This legacy path has the same share-conservation bug that was fixed there
 * (it credits `tradeCount * 2` / `shares` back to `availableShares` from the
 * requested amount rather than from the portfolio's actual before/after
 * delta), and it parks the game in `stage: "liquidationPrompt"`, which no
 * intent accepts. Only `engine/gameLogic.test.ts` still reaches this
 * function. Do not patch this one expecting it to affect real play — patch
 * `completePlayerMergerLiquidation` instead.
 */
export function handleLiquidationChoice(
  state: GameState,
  playerId: string,
  absorbedId: string,
  survivorId: string,
  choice: "sell" | "trade" | "hold"
) {
  const player = state.players.find((p) => p.id === playerId)!;
  const absorbed = state.startups[absorbedId];
  const survivor = state.startups[survivorId];
  if (!absorbed) throw new Error(`liquidating an unknown startup: ${absorbedId}`);
  if (!survivor) throw new Error(`liquidating into an unknown startup: ${survivorId}`);
  const shares = player.portfolio[absorbedId] || 0;

  // ✅ FIX: Use pre-merger price from merger context
  const price = state.mergerContext?.absorbedPrices[absorbedId] || getSharePrice(state, absorbedId);

  switch (choice) {
    case "sell": {
      const proceeds = shares * price;
      player.cash += proceeds;
      player.portfolio[absorbedId] = 0;
      pushLog(state, 'Liquidated shares', [
        tok.stack(absorbedId, shares),
        tok.text(' sold for '),
        tok.cash(proceeds),
      ], player.id);
      break;
    }
    case "trade": {
      const tradeable = Math.floor(shares / 2);
      const tradeCount = Math.min(tradeable, survivor.availableShares);
      if (tradeCount > 0) {
        player.portfolio[absorbedId] = (player.portfolio[absorbedId] ?? 0) - tradeCount * 2;
        player.portfolio[survivorId] =
          (player.portfolio[survivorId] || 0) + tradeCount;
        survivor.availableShares -= tradeCount;
        pushLog(state, 'Liquidated shares', [
          tok.stack(absorbedId, tradeCount * 2),
          tok.text(' for '),
          tok.stack(survivorId, tradeCount),
        ], player.id);
      }
      break;
    }
    case "hold": {
      pushLog(state, 'Liquidated shares', [
        tok.text('Chose to hold '),
        tok.stack(absorbedId, shares),
      ], player.id);
      break;
    }
  }

  advanceLiquidationTurn(state);
}

/**
 * Move to next shareholder in the liquidation sequence.
 */
export function advanceLiquidationTurn(state: GameState) {
  const ctx = state.mergerContext!;
  if (!ctx) return;
  ctx.currentShareholderIndex += 1;

  if (ctx.currentShareholderIndex >= ctx.shareholderQueue.length) {
    // Finished all shareholders → cleanup absorbed startup
    completeLiquidation(state, state.currentLiquidation!);
  } else {
    // Prompt next player
    const nextPlayerId = ctx.shareholderQueue[ctx.currentShareholderIndex];
    ctx.activePlayerId = nextPlayerId;
    state.stage = "liquidationPrompt";
  }
}

/**
 * Final cleanup for one absorbed startup.
 */
export function completeLiquidation(state: GameState, absorbedId: string) {
  const absorbed = state.startups[absorbedId];
  if (!absorbed) return;

  // ✅ FIX: Count how many shares are held by players (not sold or traded)
  const heldShares = state.players.reduce(
    (sum, p) => sum + (p.portfolio[absorbedId] || 0),
    0
  );

  absorbed.isFounded = false;
  absorbed.foundingTile = null;

  // ✅ FIX: Only reset available shares accounting for held shares
  // This preserves held shares in player portfolios
  absorbed.availableShares = absorbed.totalShares - heldShares;

  // Remove all tiles from board for this startup
  for (const cell of Object.values(state.board)) {
    if (cell.startupId === absorbedId) cell.startupId = undefined;
  }

  pushLog(state, 'Liquidated shares', [
    tok.brand(absorbedId),
    tok.text(' has been liquidated. '),
    tok.stack(absorbedId, heldShares),
    tok.text(' held by players'),
  ]);

  // ✅ NOTE: We do NOT clear player portfolios here - held shares persist!

  // Proceed to next liquidation if any remain
  nextLiquidation(state);
}

/**
 * Once all liquidations are complete, clean up merger context and move to next phase.
 */
export function finalizeAllLiquidations(state: GameState) {
  state.currentLiquidation = null;
  state.pendingLiquidations = [];
  delete state.mergerContext;
  state.stage = "buy"; // or next phase depending on your flow
  pushLog(state, 'Liquidated shares', [tok.text('All liquidations complete. Returning to buy phase.')]);
}
