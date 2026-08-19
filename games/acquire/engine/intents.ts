import type { GameState, Player, Stage, StartupId } from './gameTypes';
import type { Coord } from './gameHelpers';
import { compareTiles, turnPlayer } from './gameHelpers';
import { previewPlacement, isDeadTile } from './placement';
import { getEndCondition } from './endGame';
import { tok, pushLog } from './log';
import { MAX_BUYS_PER_TURN, HAND_SIZE, TRADE_RATIO } from './startups';
import {
  handleTilePlacement,
  completeSurvivorSelection,
  finalizeMergerPayout,
  foundStartup,
  completePlayerMergerLiquidation,
  buyShares,
  getSharePrice,
  endBuyPhase,
} from './gameLogic';
import { dealStartingHands } from './gameInit';

/**
 * The single server-authoritative vocabulary of player actions. Field names are
 * fixed by the roadmap spec — do not rename them.
 */
export type Intent =
  | { type: 'drawTurnOrderTile';   playerId: string }
  | { type: 'placeTile';           playerId: string; coord: Coord }
  | { type: 'chooseFoundingBrand'; playerId: string; startupId: StartupId }
  | { type: 'chooseSurvivor';      playerId: string; startupId: StartupId }
  | { type: 'liquidate';           playerId: string; startupId: StartupId; sell: number; trade: number; keep: number }
  | { type: 'buyShares';           playerId: string; picks: StartupId[] }
  | { type: 'tradeInDeadTiles';    playerId: string; coords: Coord[] }
  | { type: 'declareEnd';          playerId: string }
  | { type: 'endTurn';             playerId: string };

export type IllegalIntentCode =
  | 'wrongStage' | 'notYourTurn' | 'tileNotInHand' | 'illegalPlacement'
  | 'brandUnavailable' | 'notATiedSurvivor' | 'shareCountMismatch'
  | 'oddTradeCount' | 'notEnoughShares' | 'notEnoughCash'
  | 'tooManyPicks' | 'notADeadTile' | 'endNotAvailable' | 'unknownIntent';

export class IllegalIntentError extends Error {
  readonly code: IllegalIntentCode;
  constructor(code: IllegalIntentCode, message?: string) {
    super(message ?? code);
    this.name = 'IllegalIntentError';
    this.code = code;
  }
}

function reject(code: IllegalIntentCode, message?: string): never {
  throw new IllegalIntentError(code, message);
}

function requireStage(state: GameState, ...stages: Stage[]): void {
  if (!stages.includes(state.stage)) {
    reject('wrongStage', `expected ${stages.join(' | ')}, got ${state.stage}`);
  }
}

function requireCurrentPlayer(state: GameState, playerId: string): Player {
  const player = turnPlayer(state);
  if (!player || player.id !== playerId) reject('notYourTurn');
  return player;
}

/**
 * `handleTilePlacement` / `completeSurvivorSelection` park an uncontested merger
 * on the legacy `mergerPayout` stage so a modal can acknowledge it. The intent
 * machine has no such stage: a payout the player cannot decline is not a
 * decision point, so we settle it immediately. `finalizeMergerPayout` pays the
 * bonuses that were computed from pre-merger prices, then lands on
 * `mergerLiquidation` (someone still holds absorbed shares) or `buy`.
 */
function settleMergerPayout(state: GameState): void {
  if (state.stage === 'mergerPayout') finalizeMergerPayout(state);
}

function doPlaceTile(state: GameState, intent: Extract<Intent, { type: 'placeTile' }>): void {
  requireStage(state, 'play');
  const player = requireCurrentPlayer(state, intent.playerId);
  if (!player.hand.includes(intent.coord)) reject('tileNotInHand');

  const preview = previewPlacement(state, intent.coord, player.id);
  if (!preview.legal) reject('illegalPlacement', preview.block);

  // Board work, chain classification and stage transition all live in
  // gameLogic. It leaves the played tile pending so the legacy modal path can
  // cancel; the intent path commits immediately instead.
  handleTilePlacement(state, intent.coord);

  // INVARIANT: the hand is settled here and nowhere else on the intent path —
  // the played tile is gone and `pendingTileToRemove` is cleared. The
  // replacement draw is `endTurn`'s job.
  //
  // Do NOT reach for `completeTileTransaction` to do that draw. It is the
  // obvious existing "remove from hand + draw" helper, but it early-returns
  // when `pendingTileToRemove` is unset — which is always, here. It would
  // silently draw nothing, and the failure would only surface once hands ran
  // dry. `endTurn` must shift from `state.bag` itself.
  player.hand = player.hand.filter((c) => c !== intent.coord);
  state.pendingTileToRemove = undefined;

  settleMergerPayout(state);
}

function doChooseFoundingBrand(
  state: GameState,
  intent: Extract<Intent, { type: 'chooseFoundingBrand' }>,
): void {
  requireStage(state, 'foundStartup');
  requireCurrentPlayer(state, intent.playerId);

  const startup = state.startups[intent.startupId];
  if (!startup || startup.isFounded) reject('brandUnavailable');

  const coord = state.pendingFoundTile;
  if (!coord) reject('illegalPlacement', 'no pending founding tile');

  // Claims the connected unclaimed group, grants the founder share, logs, and
  // moves to `buy`.
  foundStartup(state, startup.id, coord);
}

function doChooseSurvivor(
  state: GameState,
  intent: Extract<Intent, { type: 'chooseSurvivor' }>,
): void {
  requireStage(state, 'chooseSurvivor');
  requireCurrentPlayer(state, intent.playerId);

  const tied = state.pendingTiedStartups ?? [];
  if (!tied.includes(intent.startupId)) reject('notATiedSurvivor');

  // `completeSurvivorSelection` reads these two siblings and bails with a bare
  // console.error if either is missing. Without this guard that bail would
  // surface as a *successful* intent that changed nothing, wedging the game in
  // `chooseSurvivor` forever. The authoritative reducer must reject instead.
  if (!state.pendingMergerTile || !state.pendingMergerStartups) {
    reject('illegalPlacement', 'no pending merger');
  }

  // Absorbs every touching chain — the tied losers and any smaller ones —
  // capturing pre-merger prices before the board is repainted.
  completeSurvivorSelection(state, intent.startupId);
  settleMergerPayout(state);
}

/**
 * Resolves one absorbed-chain holder's shares: sell for cash at the
 * pre-merger price, trade two-for-one into survivor shares, or keep the
 * rest. Players resolve one at a time, in the order `finalizeMergerPayout` /
 * `advanceToNextAbsorbedStartup` queued them (`mergerContext.shareholderQueue`).
 * Validation happens here; the bookkeeping (cash, portfolios, share pools,
 * logging, and advancing to the next shareholder or absorbed chain) is
 * entirely `completePlayerMergerLiquidation`'s job — it already knows how to
 * walk `shareholderQueue`/`currentLiquidationIndex` and hand off to
 * `advanceToNextAbsorbedStartup` when a chain's queue empties, including the
 * multi-absorbed-chain case (moving on to the next chain's liquidation, or
 * to `buy` once every absorbed chain is settled).
 */
function doLiquidate(state: GameState, intent: Extract<Intent, { type: 'liquidate' }>): void {
  requireStage(state, 'mergerLiquidation');
  const ctx = state.mergerContext;
  if (!ctx) reject('wrongStage', 'no merger in progress');

  const head = ctx.shareholderQueue[ctx.currentShareholderIndex];
  if (!head || head !== intent.playerId) reject('notYourTurn');

  const currentAbsorbed = ctx.absorbedIds[ctx.currentLiquidationIndex];
  if (currentAbsorbed !== intent.startupId) {
    reject('wrongStage', 'wrong chain for this queue entry');
  }

  const player = state.players.find((p) => p.id === intent.playerId)!;
  const held = player.portfolio[intent.startupId] ?? 0;
  const { sell, trade, keep } = intent;

  if (sell < 0 || trade < 0 || keep < 0) reject('shareCountMismatch');
  if (sell + trade + keep !== held) reject('shareCountMismatch', `holds ${held}`);
  if (trade % TRADE_RATIO !== 0) reject('oddTradeCount');

  const survivor = state.startups[ctx.survivorId];
  if (!survivor) reject('notEnoughShares', `unknown survivor ${ctx.survivorId}`);
  const gained = trade / TRADE_RATIO;
  if (gained > survivor.availableShares) reject('notEnoughShares');

  // `completePlayerMergerLiquidation`'s own `trade` param is the number of
  // *survivor* shares gained (it derives its 2-for-1 cost internally), not
  // the number of absorbed shares handed in — so pass `gained`, not `trade`.
  completePlayerMergerLiquidation(state, intent.playerId, {
    absorbedId: intent.startupId,
    trade: gained,
    sell,
  });
}

/**
 * Up to 3 shares per turn, cumulative across calls. The whole basket is
 * priced and validated against founding/stock/cash *before* anything is
 * charged — a basket the player can't afford must leave state untouched.
 * The actual bookkeeping (cash, portfolio, share pool, currentBuyCount,
 * logging) is delegated to gameLogic's `buyShares`, once per distinct
 * startup in the basket; the pre-check below guarantees each call succeeds.
 */
function doBuyShares(state: GameState, intent: Extract<Intent, { type: 'buyShares' }>): void {
  requireStage(state, 'buy');
  const player = requireCurrentPlayer(state, intent.playerId);

  const already = state.currentBuyCount ?? 0;
  if (already + intent.picks.length > MAX_BUYS_PER_TURN) reject('tooManyPicks');

  const wanted: Partial<Record<StartupId, number>> = {};
  let total = 0;
  for (const id of intent.picks) {
    const startup = state.startups[id];
    if (!startup || !startup.isFounded) reject('brandUnavailable');
    wanted[id] = (wanted[id] ?? 0) + 1;
    if (wanted[id]! > startup.availableShares) reject('notEnoughShares');
    total += getSharePrice(state, id);
  }
  if (total > player.cash) reject('notEnoughCash');

  for (const [id, count] of Object.entries(wanted) as [StartupId, number][]) {
    // `buyShares` returns false when *it* refuses the basket — a different
    // rule copy saying no after ours said yes. The validation above is
    // supposed to make that unreachable, so a false here is an engine-
    // invariant violation, not a player error: there is no IllegalIntentCode
    // that honestly describes it, and reporting one would tell the client to
    // fix an input that was fine. Assert instead, loudly. `applyIntent`
    // clones before delegating, so the throw still leaves the caller's state
    // untouched. Silently discarding this return is how a MAX_BUYS_PER_TURN
    // divergence would ship a partially-applied basket as a full success.
    if (!buyShares(state, player.id, id, count)) {
      throw new Error(
        `engine invariant: buyShares refused ${count}x ${id} for ${player.id} ` +
        `after doBuyShares validated the basket — the buy rules in intents.ts ` +
        `and gameLogic.ts have diverged`,
      );
    }
  }
}

/**
 * Whether this player can legally place anything they hold.
 *
 * Exported because the UI must gate the pass affordance on exactly the
 * predicate `doEndTurn` gates on. Recomputing it in the screen would let the
 * two drift, and a disagreement shows up as a button that rejects when
 * pressed, or no button at all for a player who genuinely cannot move.
 */
export function hasLegalTile(state: GameState, playerId: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  return !!player && player.hand.some((c) => previewPlacement(state, c, playerId).legal);
}

/** Draws straight from `state.bag` up to `size`. See the note on
 * `completeTileTransaction` in `doPlaceTile` above — that helper is a
 * permanent no-op on the intent path, so `endTurn` must do its own drawing.
 */
function drawUpTo(state: GameState, playerId: string, size = HAND_SIZE): Coord[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const drawn: Coord[] = [];
  while (player.hand.length < size && state.bag.length > 0) {
    const tile = state.bag.shift()!;
    player.hand.push(tile);
    drawn.push(tile);
  }
  return drawn;
}

/**
 * Legal from `buy` always. Legal from `play` only when the current player
 * has no legal placement anywhere in hand — otherwise they must place.
 * Draws the hand back up to 6 from the bag (never past what it holds),
 * resets `currentBuyCount`, and advances to the next player's `play` stage.
 */
function doEndTurn(state: GameState, intent: Extract<Intent, { type: 'endTurn' }>): void {
  const player = requireCurrentPlayer(state, intent.playerId);

  if (state.stage === 'play') {
    if (hasLegalTile(state, intent.playerId)) {
      reject('wrongStage', 'a legal placement exists — you must place a tile');
    }
  } else {
    requireStage(state, 'buy');
  }

  const drawn = drawUpTo(state, player.id);
  if (drawn.length > 0) {
    pushLog(state, 'Drew tiles', [tok.text(`${drawn.length} tile${drawn.length === 1 ? '' : 's'}`)], player.id);
  }
  pushLog(state, 'Ended turn', [], player.id);

  // Resets currentBuyCount, advances turnIndex, and lands on 'play' —
  // exactly what ending a turn needs, whether we arrived here from 'buy'
  // or from a dead-ended 'play'. This is also the fix for the stale
  // currentBuyCount hazard: gameLogic's foundStartup and
  // advanceToNextAbsorbedStartup enter 'buy' without resetting it, relying
  // on it already being 0 — which only holds if every path out of a turn
  // resets it here, unconditionally, regardless of how 'buy' was entered.
  endBuyPhase(state);
}

/**
 * Swaps genuinely dead tiles (would merge two safe chains) for fresh ones
 * from the bag. The turn continues — stage stays 'play'. Validates every
 * coord before mutating any of them, so a bad coord in the batch leaves the
 * hand and bag untouched.
 */
function doTradeInDeadTiles(state: GameState, intent: Extract<Intent, { type: 'tradeInDeadTiles' }>): void {
  requireStage(state, 'play');
  const player = requireCurrentPlayer(state, intent.playerId);

  // Dedupe before validating/mutating: a client sending the same coord twice
  // must not surrender one tile and draw two.
  const coords = [...new Set(intent.coords)];

  for (const c of coords) {
    if (!player.hand.includes(c)) reject('tileNotInHand');
    if (!isDeadTile(state, c)) reject('notADeadTile', c);
  }

  for (const c of coords) {
    player.hand = player.hand.filter((x) => x !== c);
    state.discarded.push(c);
    const replacement = state.bag.shift();
    const detail = [tok.tile(c)];
    if (replacement) {
      player.hand.push(replacement);
      detail.push(tok.text(' → drew '), tok.tile(replacement));
    } else {
      detail.push(tok.text(' → bag empty'));
    }
    pushLog(state, 'Traded a tile', detail, player.id);
  }
}

/**
 * Only legal once `getEndCondition` says the game is over. A player who
 * doesn't want to end declines simply by calling `endTurn` instead — the
 * engine never ends the game on its own.
 *
 * Stage gate, mirroring `doEndTurn`: legal from `buy` always, and from
 * `play` only when the current player has no legal placement anywhere in
 * hand. Restricting it to `buy` alone deadlocked the game: `buy` is
 * reachable only by placing a tile, so once the bag and every hand are
 * empty nobody can ever get back there — `declareEnd` was rejected forever
 * while `endTurn` succeeded forever, and the game could not terminate. G11
 * makes declining explicitly legal, so the engine actively steers play into
 * that state.
 *
 * The gate matters. Allowing `declareEnd` from `play` *ungated* would let a
 * player skip a placement they are able to make in order to freeze the
 * board — a real strategic change, not a bug fix. Gated, it changes nothing
 * about normal play: if you can place, you must (and land in `buy`, where
 * declaring already worked); if you cannot, declaring is the only way the
 * game ever finishes.
 */
function doDeclareEnd(state: GameState, intent: Extract<Intent, { type: 'declareEnd' }>): void {
  requireCurrentPlayer(state, intent.playerId);

  if (state.stage === 'play') {
    if (hasLegalTile(state, intent.playerId)) {
      reject('wrongStage', 'a legal placement exists — place your tile first');
    }
  } else {
    requireStage(state, 'buy');
  }

  const condition = getEndCondition(state);
  if (!condition.met) reject('endNotAvailable');

  // `met` is `reasons.length > 0`, so the first reason always exists.
  const reason = condition.reasons[0]!;
  pushLog(state, 'Game over', reason.kind === 'size41'
    ? [tok.brand(reason.startupId), tok.text(` reached ${reason.size} tiles`)]
    : [tok.text('every founded chain is safe')], intent.playerId);
  state.stage = 'end';
}

/**
 * One player's own turn-order draw.
 *
 * Each seat draws in order and the order is resolved when the last tile lands.
 * This replaced `startGame`, which drew for *everybody* inside one intent so
 * that one player pressed one button and the game was already running — nobody
 * else acted. Reported by the owner: *"the draw to go first was meant to pass
 * turn like any other move."*
 *
 * The turn-passing itself is not implemented here. `getCurrentActor` reads
 * `turnOrderDraws.length` as a cursor, and because that function is the segment
 * seam, the curtain, the hand-off, the toast and the server's per-draw commit
 * all follow from it with nothing added.
 *
 * The drawn tiles stay on the board as unclaimed starting tiles, exactly as in
 * Acquire, and they leave the bag for good. The legacy `resolveInitialDraw`
 * marks them placed *and* pushes them back onto the bag, which counts them
 * twice — `checkInvariants`' tile conservation catches that, and nothing
 * currently runs that code. Do not reproduce it here.
 */
function doDrawTurnOrderTile(
  state: GameState,
  intent: Extract<Intent, { type: 'drawTurnOrderTile' }>,
): void {
  requireStage(state, 'draw');

  const draws = state.turnOrderDraws ?? (state.turnOrderDraws = []);
  const drawer = state.players[draws.length];
  // Not "seat one may open the game" any more: it is whoever the draw has
  // reached. Same shape as every other intent's actor guard, which is what
  // makes a draw a turn.
  if (!drawer || drawer.id !== intent.playerId) {
    reject('notYourTurn', 'it is not your turn to draw');
  }

  const tile = state.bag.shift();
  if (!tile) reject('shareCountMismatch', 'bag exhausted during the opening draw');
  state.board[tile] = { placed: true };
  // Deliberately NOT `drawer.lastPlacedTile = tile`, which is what the legacy
  // `resolveInitialDraw` does. That field means "the tile placed this turn,
  // still undoable": the board gives it a selection ring and keeps it
  // clickable so it can be taken back. A turn-order tile is neither, and
  // marking it put a phantom undoable tile on the opening board that
  // rejected the very click it invited.
  draws.push({ playerId: drawer.id, tile });

  // Every draw is its own step, attributed to whoever drew it.
  //
  // Not cosmetic: `pushLog` is what assigns and advances `nextStepId`, and the
  // segment machinery is built on step ids. A draw that narrated nothing left
  // the undo range and the server's commit boundary with no step to move past,
  // so a closed segment still reported its draw as undoable and `room.ts` and
  // `GameSession` disagreed about whether a commit had happened. Both of those
  // showed up the moment the draw became a turn.
  pushLog(state, 'Drew for turn order', [
    tok.text(`${drawer.name} `),
    tok.tile(tile),
  ], drawer.id);

  // Still going round the table; there is no order to announce yet.
  if (draws.length < state.players.length) return;

  // Highest letter, then highest number, takes the first turn — I12 beats A1.
  // `compareTiles` orders row-then-column ascending, so the winner is the last
  // entry. (Tabletop Acquire gives it to the tile *closest* to A1; this game
  // reverses that deliberately.)
  //
  // Ties are impossible: tiles are unique and `compareTiles` totally orders
  // them. Written down so nobody adds a defensive tie-break that can never run.
  const nameOf = (playerId: string) =>
    state.players.find((p) => p.id === playerId)?.name ?? playerId;
  const sorted = [...draws].sort((a, b) => compareTiles(b.tile, a.tile));
  // Every seat has drawn by the time this runs, so there is always a winner.
  const winner = sorted[0]!;
  state.turnIndex = state.players.findIndex((p) => p.id === winner.playerId);

  // The winner is named rather than merely arrived at, as its own step. With a
  // curtain between draws the table has just passed the device around several
  // times, and the last draw would otherwise slide silently into somebody's
  // turn with no moment saying who won or why. (Owner ruling, 2026-08-08.)
  // Deliberately **unattributed**. `stepsOf` prefixes an entry with its
  // player — "You" when it is the viewer's — so an attributed phase has to
  // read after a name. "Plays first" attributed to the winner rendered as
  // "YOU PLAYS FIRST", seen in a browser. This is a fact about the table
  // rather than a move anyone made, so it carries no `playerId` and the
  // winner is named in the detail instead.
  pushLog(state, 'Turn order', [
    tok.text(`${nameOf(winner.playerId)} drew highest `),
    tok.tile(winner.tile),
    tok.text(' and plays first'),
  ]);

  // Only now do hands exist: drawn from the bag minus the tiles the draw just
  // put on the board, round-robin so the odds stay even. Inside the same
  // intent as the winner's announcement, so no state ever has an order but no
  // hands.
  dealStartingHands(state);

  state.stage = 'play';
}

/**
 * The one entry point for player actions. Pure by contract: it clones the
 * incoming state, then delegates to the (mutating) rules functions.
 * Throws `IllegalIntentError` and leaves the caller's state untouched if the
 * intent is not legal in the current stage.
 */
export function applyIntent(state: GameState, intent: Intent): GameState {
  const next = structuredClone(state);
  switch (intent.type) {
    case 'drawTurnOrderTile':   doDrawTurnOrderTile(next, intent); break;
    case 'placeTile':           doPlaceTile(next, intent); break;
    case 'chooseFoundingBrand': doChooseFoundingBrand(next, intent); break;
    case 'chooseSurvivor':      doChooseSurvivor(next, intent); break;
    case 'liquidate':           doLiquidate(next, intent); break;
    case 'buyShares':           doBuyShares(next, intent); break;
    case 'endTurn':             doEndTurn(next, intent); break;
    case 'tradeInDeadTiles':    doTradeInDeadTiles(next, intent); break;
    case 'declareEnd':          doDeclareEnd(next, intent); break;
    default:                    reject('unknownIntent', `no handler for ${(intent as Intent).type}`);
  }
  return next;
}
