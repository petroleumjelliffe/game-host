import { useEffect, useState, type ReactNode } from 'react';
import { hasLegalTile, type Intent } from '../../../engine/intents';
import type { GameState, Player, StartupId } from '../../../engine/gameTypes';
import type { SessionView } from '../../../session/GameSession';
import type { Coord } from '../../../engine/gameHelpers';
import { getDeadTilesInHand } from '../../../engine/placement';
import { getEndCondition } from '../../../engine/endGame';
import { reasonText } from '../FinalScoring';
import { ActiveStep } from '../panel/ActiveStep';
import { StagingZone } from '../panel/StagingZone';
import { FoundGroups } from '../FoundGroups';
import { floodFillUnclaimed } from '../../../engine/gameHelpers';
import { isStartupId, MAX_BUYS_PER_TURN, TRADE_RATIO } from '../../../engine/startups';
import { StockStack } from '../atoms/StockStack';
import { StockCard } from '../atoms/StockCard';
import { foundedThisTurn } from './boardMarks';
import { getSharePrice } from '../../../engine/gameLogic';
import { LiqQueue } from '../merger/LiqQueue';
import { LiqActions } from '../merger/LiqActions';
import { Brand } from '../atoms/Brand';
import { Tile } from '../atoms/Tile';

/**
 * The panel's two interactive slots for the current stage.
 *
 * They are returned together because they share state — the buy buttons sit in
 * `active` while the confirm button sits in `staging` — but they must render in
 * separate `Panel` slots, because the zone order is fixed and a staging zone
 * that came and went would resize every zone beneath it.
 */
export interface TurnPanelSlots {
  active: ReactNode;
  staging: ReactNode;
}

/** What the screen around the panel knows that the view alone does not. */
export interface TurnPanelContext {
  /**
   * Whose hand the panel shows — the seat this device holds, which is not
   * always the actor.
   *
   * Resolved by `GameScreen` and passed down rather than derived here: online
   * it is my own seat at every stage, pass-and-play it is the actor at every
   * stage but the draw, and that rule already lives in one place. Deriving it
   * a second time is how the panel and the board come to disagree about whose
   * tiles are on screen. Reading `state.players[actorId]` instead would be
   * worse than wrong online — a watcher's projected state has the actor's hand
   * blanked, so it renders an empty row for everyone who is not up.
   */
  viewer?: Player;
  /**
   * Play a tile. The board's handler, so tapping a tile here and tapping it
   * there are one move — including the undo-and-replace path a second tap
   * takes. Absent when a placement cannot succeed, which is what makes these
   * tiles inert rather than a click that only produces an error.
   */
  onPlaceTile?: (coord: Coord) => void;
  /**
   * The pointer entering (coord) or leaving (null) a hand tile here. The
   * screen turns it into the board's one highlighted cell — nothing on the
   * board lights up on its own (owner, hotseat pass). Wired whether or not
   * the viewer can act: "where is my A1" is worth answering while watching.
   */
  onHoverTile?: (coord: Coord | null) => void;
}

/** Everything a turn stages locally before committing it as one intent. */
interface Staged {
  picks: StartupId[];
  sell: number;
  trade: number;
  /**
   * The buy step's "I mean to buy nothing." `endTurn` closes the segment —
   * the undo floor — so ending over an empty basket must be said once, the
   * same way staging a share says it. Reset with the rest of the staging
   * whenever the actor or stage moves.
   */
  passed: boolean;
}

const NOTHING_STAGED: Staged = { picks: [], sell: 0, trade: 0, passed: false };

/**
 * How big the chain being founded will be: the placed tile plus every
 * unclaimed tile it connects to. During `foundStartup` the tile is already on
 * the board, so the whole group is one flood fill from it — `previewPlacement`
 * would report `occupied` for a coord that is already placed.
 */
function foundingSize(state: GameState, coord: Coord): number {
  return floodFillUnclaimed([coord], state.board).length;
}

/**
 * The label for the step a stage is asking for.
 *
 * One map rather than one string per branch, because the waiting panel shows
 * the same label the actor sees — a second copy would drift the moment a
 * label is reworded.
 */
export function stageLabel(stage: GameState['stage']): string {
  switch (stage) {
    case 'draw': return 'Open the game';
    case 'foundStartup': return 'Found a startup';
    case 'chooseSurvivor': return 'Which chain survives?';
    case 'mergerLiquidation': return 'Liquidate shares';
    case 'buy': return 'Buy shares';
    default: return 'Place a tile';
  }
}

export function useTurnPanel(
  view: SessionView,
  dispatch: (intent: Intent) => void,
  canAct: boolean = true,
  { viewer, onPlaceTile, onHoverTile }: TurnPanelContext = {},
): TurnPanelSlots {
  const { state, actorId, error, pending } = view;
  /** Founded this turn, so its shares are new to the table. */
  const freshBrand = foundedThisTurn(state, view.segmentStart);
  const [staged, setStaged] = useState<Staged>(NOTHING_STAGED);

  // An abandoned basket must never survive into another player's turn, or into
  // a different decision by the same player.
  useEffect(() => { setStaged(NOTHING_STAGED); }, [actorId, state.stage]);

  const problem = error ? (
    <div role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
      {error.message}
    </div>
  ) : null;

  // The default staging slot: present and reserving its height, holding
  // nothing. Stages that stage something replace it below.
  const idleStaging = <StagingZone label="Staging" />;

  // Derived every render, never latched: 'every founded chain is safe' stops
  // being true the moment a merger makes one unsafe again, and an affordance
  // remembered from an earlier render would offer an end the engine refuses.
  const endCondition = getEndCondition(state);
  const declareEnd = endCondition.met && actorId ? (
    <div className="mt-2 flex flex-col gap-1 rounded-md bg-amber-50 px-2 py-1.5">
      <span className="text-[13px] font-semibold text-amber-900">
        {`${reasonText(endCondition.reasons[0] ?? null)}. You may end the game now.`}
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: 'declareEnd', playerId: actorId })}
        className="m-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
      >
        End the game
      </button>
    </div>
  ) : null;

  /**
   * The panel never stops showing this player their own step.
   *
   * It used to: when it was not your turn, every branch below was replaced by
   * "Waiting for Alex." in one line of grey. Played by hand, that read as the
   * screen going blank — the step you were in the middle of understanding was
   * taken away and nothing said whose turn it was in any way you would notice.
   * Whose turn it is now belongs to `TurnToast`, which is unmissable; the
   * panel's job is to keep showing the step, minus the controls that are not
   * yours to press.
   *
   * `pending` is this player's own action in flight, not someone else's turn,
   * so it stays a caption on the step rather than a toast.
   */
  const waiting = pending ? (
    <span className="text-[13px] font-semibold text-gray-500">Sending…</span>
  ) : null;

  if (state.stage === 'draw') {
    // Everyone draws, one at a time, in seat order. `getCurrentActor` is what
    // moves the turn along, so this step needs to say only two things: whose
    // draw it is, and what has been drawn so far.
    const draws = state.turnOrderDraws ?? [];
    const drawn = draws.map((d) => ({
      ...d,
      name: state.players.find((p) => p.id === d.playerId)?.name ?? d.playerId,
    }));
    const remaining = state.players.length - draws.length;

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label={stageLabel(state.stage)}
          body={
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-gray-600">
                One tile each — the highest plays first.
              </span>
              {/* Derived, never hardcoded: the tiles come from the state that
                  the engine wrote, so this cannot drift from the board. */}
              {drawn.length > 0 && (
                <ul data-draw-list className="flex flex-col gap-1">
                  {drawn.map((d) => (
                    <li key={d.playerId} className="flex items-center gap-1.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-gray-600">{d.name}</span>
                      {/* The same atom the log uses for a tile token, so a
                          drawn tile reads identically wherever it appears. */}
                      <Tile coord={d.tile} state="filled" />
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-[12px] text-gray-500">
                {remaining > 0
                  ? `${remaining} still to draw`
                  : 'Everyone has drawn.'}
              </span>
            </div>
          }
          button={
            <>
              {canAct && (
                <button
                  type="button"
                  onClick={() => actorId && dispatch({ type: 'drawTurnOrderTile', playerId: actorId })}
                  className="m-0 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Draw your tile
                </button>
              )}
              {waiting}
              {problem}
            </>
          }
        />
      ),
    };
  }

  if (state.stage === 'play') {
    const canPlace = actorId ? hasLegalTile(state, actorId) : false;
    const dead = actorId ? getDeadTilesInHand(state, actorId) : [];
    // The viewer's own tiles, which are the actor's only when the viewer is
    // acting. `dead` above stays the actor's: it drives the trade-in button,
    // which is the actor's move to make.
    const viewerHand = viewer?.hand ?? [];
    const viewerDead = viewer ? getDeadTilesInHand(state, viewer.id) : [];

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label={stageLabel(state.stage)}
          body={
            <>
              {/*
                The hand the step is asking you to play from — playable here or
                on the board, which is what the catalog's `place · active` card
                has shown since Phase 1b and the port quietly dropped.

                A dead tile takes no handler, so it is inert: `Tile` treats
                `onClick != null` as the whole of its affordance, and a click
                whose only outcome is an error message is the thing Phase 3b
                went through the panel removing.

                No prose about your own tiles either. They are here and on the
                board, lit in both — the "no tile you hold can be played" line
                was telling you something the board and the End turn button
                already told you.
              */}
              {viewerHand.length > 0 && (
                <div data-panel-hand className="flex flex-wrap items-center gap-1.5">
                  {viewerHand.map((coord) => {
                    const isDead = viewerDead.includes(coord);
                    return (
                      <Tile
                        key={coord}
                        coord={coord}
                        state={isDead ? 'blocked' : 'hand'}
                        onClick={
                          onPlaceTile && !isDead ? () => onPlaceTile(coord) : undefined
                        }
                        onMouseEnter={onHoverTile ? () => onHoverTile(coord) : undefined}
                        onMouseLeave={onHoverTile ? () => onHoverTile(null) : undefined}
                      />
                    );
                  })}
                </div>
              )}
              {dead.length > 0 && (
                <span className="text-[13px] text-gray-600">
                  {`${dead.join(', ')} can never be played — ${dead.length === 1 ? 'it joins' : 'they join'} two safe chains.`}
                </span>
              )}
              {!canPlace && canAct && declareEnd}
              {waiting}
              {problem}
            </>
          }
          button={
            !actorId || !canAct ? undefined : (
              <div className="flex w-full flex-col gap-2">
                {dead.length > 0 && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'tradeInDeadTiles', playerId: actorId, coords: dead })}
                    className="m-0 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {`Trade in ${dead.length} dead tile${dead.length === 1 ? '' : 's'}`}
                  </button>
                )}
                {!canPlace && (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'endTurn', playerId: actorId })}
                    className="m-0 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                  >
                    End turn
                  </button>
                )}
              </div>
            )
          }
        />
      ),
    };
  }

  if (state.stage === 'foundStartup') {
    const coord = state.pendingFoundTile;
    const available = Object.values(state.startups)
      .filter((s) => !s.isFounded).map((s) => s.id).filter(isStartupId);
    const taken = Object.values(state.startups)
      .filter((s) => s.isFounded).map((s) => s.id).filter(isStartupId);

    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label={stageLabel(state.stage)}
          body={
            <>
              <FoundGroups
                available={available}
                taken={taken}
                foundSize={coord ? foundingSize(state, coord) : 2}
                onSelect={
                  canAct
                    ? (startupId) =>
                        actorId && dispatch({ type: 'chooseFoundingBrand', playerId: actorId, startupId })
                    : undefined
                }
              />
              {waiting}
              {problem}
            </>
          }
        />
      ),
    };
  }

  if (state.stage === 'chooseSurvivor' && actorId) {
    const tied = (state.pendingTiedStartups ?? []).filter(isStartupId);
    return {
      staging: idleStaging,
      active: (
        <ActiveStep
          label={stageLabel(state.stage)}
          body={
            <>
              {/*
                `mode="select"` because Brand renders its own <button> in that
                mode — wrapping it in another would nest buttons, which is
                invalid HTML and breaks getByRole('button', { name }).
              */}
              <div className="flex flex-wrap gap-2">
                {tied.map((id) => (
                  <Brand
                    key={id}
                    id={id}
                    mode={canAct ? 'select' : 'static'}
                    onClick={
                      canAct
                        ? () => dispatch({ type: 'chooseSurvivor', playerId: actorId, startupId: id })
                        : undefined
                    }
                  />
                ))}
              </div>
              {waiting}
              {problem}
            </>
          }
        />
      ),
    };
  }

  if (state.stage === 'mergerLiquidation' && actorId) {
    const ctx = state.mergerContext;
    const absorbedId = ctx?.absorbedIds[ctx.currentLiquidationIndex];
    const player = state.players.find((p) => p.id === actorId);

    if (ctx && absorbedId && isStartupId(absorbedId) && player && isStartupId(ctx.survivorId)) {
      const survivorId = ctx.survivorId;
      const held = player.portfolio[absorbedId] ?? 0;
      const keep = held - staged.sell - staged.trade;
      const unitPrice = ctx.absorbedPrices[absorbedId] ?? 0;

      // Survivor shares still claimable, staged trades already deducted. Two
      // things read this and they must not disagree: whether a trade is
      // possible, and whether the panel says the pool is empty.
      const survivorPoolLeft =
        (state.startups[survivorId]?.availableShares ?? 0) - staged.trade / TRADE_RATIO;

      const holders = ctx.shareholderQueue.map((id, i) => {
        const p = state.players.find((x) => x.id === id);
        return {
          emoji: p?.emoji,
          name: p?.name ?? id,
          qty: p?.portfolio[absorbedId] ?? 0,
          status: (i < ctx.currentShareholderIndex
            ? 'done'
            : i === ctx.currentShareholderIndex
              ? 'current'
              : 'pending') as 'done' | 'current' | 'pending',
        };
      });

      return {
        active: (
          <ActiveStep
            /*
              The chain and the shareholder, not just the verb. A queue works
              through several holders one at a time, and "Liquidate shares"
              says neither which chain is being sorted nor whose turn in the
              queue it is — which online leaves a watcher with a liquidation
              step and no sign that it is not theirs. Built here rather than in
              `stageLabel`, which takes a stage and should not reach for state.
            */
            label={`Liquidate ${absorbedId} — ${player.name}`}
            body={
              <>
                <LiqQueue holders={holders} />
                <LiqActions
                  absorbedId={absorbedId}
                  survivorId={survivorId}
                  unitPrice={unitPrice}
                  canSell={canAct && keep >= 1}
                  canTrade={canAct && keep >= TRADE_RATIO && survivorPoolLeft > 0}
                  // Named separately from `canTrade` because it is the one
                  // reason a trade can be unavailable that nothing else on the
                  // panel shows. Staged trades count against the pool, so this
                  // goes true on the click that claims the last share — which
                  // is exactly when the button goes inert.
                  survivorSoldOut={survivorPoolLeft <= 0}
                  onSell={() => setStaged({ ...staged, sell: staged.sell + 1 })}
                  onTrade={() => setStaged({ ...staged, trade: staged.trade + TRADE_RATIO })}
                />
                {waiting}
                {problem}
              </>
            }
          />
        ),
        staging: (
          <StagingZone
            label={`Keeping ${keep}`}
            cashDelta={staged.sell * unitPrice}
            shares={
              <>
                {/*
                  The remainder, not a staged thing — so no `×`. Taking a share
                  off "what I am keeping" is not a move; putting a sold or
                  traded one back is, and those two stacks carry the affordance.
                */}
                <StockStack id={absorbedId} count={keep} size="sm" />
                {/*
                  Shares sold for cash, shown leaving. Without this the sale
                  appeared only as a number in `Net`, which left the one staged
                  decision in this step with nothing to click to undo it.
                */}
                {staged.sell > 0 && (
                  <StockStack
                    id={absorbedId}
                    count={staged.sell}
                    size="sm"
                    leaving
                    onRemove={canAct ? () => setStaged({ ...staged, sell: staged.sell - 1 }) : undefined}
                  />
                )}
                {/*
                  What you are getting, not only what you are giving up. A
                  trade hands in `TRADE_RATIO` absorbed shares for one survivor
                  share, and the pile showed the absorbed side alone — so the
                  staging zone answered "what am I losing" and left "what am I
                  gaining" to arithmetic. Derived from `TRADE_RATIO` rather
                  than written down, because it is a rule.

                  Removing one hands back the whole trade it came from, which is
                  why it moves by `TRADE_RATIO`: half a trade is not a state the
                  rules have.
                */}
                {staged.trade > 0 && (
                  <StockStack
                    id={survivorId}
                    count={staged.trade / TRADE_RATIO}
                    size="sm"
                    onRemove={
                      canAct
                        ? () => setStaged({ ...staged, trade: staged.trade - TRADE_RATIO })
                        : undefined
                    }
                  />
                )}
              </>
            }
            action={
              canAct ? (
                <button
                  type="button"
                  onClick={() => {
                    dispatch({
                      type: 'liquidate',
                      playerId: actorId,
                      startupId: absorbedId,
                      sell: staged.sell,
                      trade: staged.trade,
                      keep,
                    });
                    setStaged(NOTHING_STAGED);
                  }}
                  className="m-0 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Confirm
                </button>
              ) : undefined
            }
          />
        ),
      };
    }
  }

  if (state.stage === 'buy' && actorId) {
    const player = state.players.find((p) => p.id === actorId);
    const spent = staged.picks.reduce((sum, id) => sum + getSharePrice(state, id), 0);
    const remaining = MAX_BUYS_PER_TURN - (state.currentBuyCount ?? 0) - staged.picks.length;

    // Every founded brand, sold out or not. Filtering on `availableShares > 0`
    // made a brand vanish from the row the moment its last share was bought —
    // and sold out is information: it is how you learn the brand is locked and
    // what everyone else has been spending on. A row that quietly gets shorter
    // says none of that.
    const founded = Object.values(state.startups).filter((s) => s.isFounded);

    // Whether any purchase is possible at all: something founded, with shares
    // left past what is already staged, at a price the remaining cash covers,
    // inside the per-turn limit. When it is not, the pass below starts
    // pressed — asking a player to confirm an omission they had no way to
    // avoid is a dead end wearing a safety feature's clothes.
    const canBuySomething =
      remaining > 0 &&
      founded.some((s) => {
        const id = s.id;
        if (!isStartupId(id)) return false;
        const alreadyStaged = staged.picks.filter((p) => p === id).length;
        return (
          s.availableShares - alreadyStaged > 0 &&
          getSharePrice(state, id) <= (player?.cash ?? 0) - spent
        );
      });
    const passed = staged.passed || !canBuySomething;

    const basket = Object.entries(
      staged.picks.reduce<Record<string, number>>(
        (acc, id) => ({ ...acc, [id]: (acc[id] ?? 0) + 1 }),
        {},
      ),
    );

    return {
      active: (
        <ActiveStep
          /*
            The cap, which is otherwise a rule you discover by hitting it: the
            cards simply stop responding at three. Counted from what the turn
            has already committed plus what is staged, against
            `MAX_BUYS_PER_TURN` — the same two numbers `remaining` above is
            derived from, never a literal.
          */
          label={`${stageLabel(state.stage)} (${
            (state.currentBuyCount ?? 0) + staged.picks.length
          }/${MAX_BUYS_PER_TURN})`}
          body={
            <>
              {/*
                Nothing founded yet, so the step is asking for something that
                cannot be given. It says what would change that rather than
                leaving a heading over an empty row.

                Keyed on nothing being *founded*, not on nothing being buyable:
                a founded brand whose pool is empty renders a sold-out card, so
                those two conditions came apart the moment sold-out cards
                stayed in the row.
              */}
              {founded.length === 0 && (
                <span className="text-[13px] text-gray-600">Found a startup to buy shares.</span>
              )}
              <div className="flex flex-wrap gap-2">
                {founded.map((s) => {
                  // Bound to a const so the `isStartupId` narrowing survives
                  // into the click handler; narrowing a mutable property does
                  // not reach inside a closure.
                  const id = s.id;
                  if (!isStartupId(id)) return null;
                  const price = getSharePrice(state, id);
                  const soldOut = s.availableShares === 0;
                  // The atom, not a bare button: shares are portrait
                  // certificates everywhere else in this UI — in the staging
                  // pile, in the hand zone, in the payout lines — and the buy
                  // row was the one place they appeared as unstyled text. It
                  // carries its own ticker, price and disabled treatment, so
                  // there is nothing here to restyle.
                  return (
                    <StockCard
                      key={id}
                      id={id}
                      price={price}
                      size="sm"
                      mode="add"
                      // The pill has room for one short word at 9px on a 40px
                      // card, so the badge says "sold" and the accessible name
                      // carries the whole phrase — a card nobody can press
                      // should not be announced as "Buy one Messla".
                      label={soldOut ? `${id} — sold out` : `Buy one ${id}`}
                      badge={soldOut ? 'sold' : id === freshBrand ? 'new' : undefined}
                      badgeTone={soldOut ? 'muted' : 'info'}
                      // Sold out is a third, independent reason to be inert.
                      // Folding it into the cash or buy-count test would make
                      // an empty pool look like an affordability problem.
                      disabled={
                        soldOut || !canAct || remaining <= 0 || (player?.cash ?? 0) < spent + price
                      }
                      onClick={() => setStaged({ ...staged, picks: [...staged.picks, id] })}
                    />
                  );
                })}
              </div>
              {canAct && declareEnd}
              {waiting}
              {problem}
            </>
          }
        />
      ),
      staging: (
        <StagingZone
          label="Buying"
          cashDelta={-spent}
          shares={basket.map(([id, n]) =>
            isStartupId(id) ? (
              <StockStack
                key={id}
                id={id}
                count={n}
                size="sm"
                // The pile is not a receipt: a share put there by mistake comes
                // back out, one at a time, and the handler is what lights the
                // atom's `×`. Nothing said the stack was clickable before this,
                // because nothing was.
                onRemove={
                  canAct
                    ? () => {
                        const at = staged.picks.lastIndexOf(id);
                        if (at < 0) return;
                        const picks = [...staged.picks];
                        picks.splice(at, 1);
                        setStaged({ ...staged, picks });
                      }
                    : undefined
                }
              />
            ) : null,
          )}
          action={!canAct ? undefined : staged.picks.length === 0 ? (
            /*
              An empty basket does not arm the turn-ending press by itself.
              `endTurn` closes the segment — the undo floor — and "one button
              that always works" shipped exactly the mistake it invited: an
              accidental press past the buy, with nothing to undo (owner,
              2026-08-07). Passing is now said once, the way staging a share
              is said once; when no purchase is possible at all, Pass starts
              pressed, because confirming an unavoidable omission is a dead
              end wearing a safety feature's clothes. Two buttons in one row,
              so the action zone's height never moves.
            */
            <div className="flex w-full gap-2">
              <button
                type="button"
                aria-pressed={passed}
                disabled={!canBuySomething}
                onClick={() => setStaged({ ...staged, passed: !staged.passed })}
                className={
                  passed
                    ? 'm-0 flex-1 rounded-lg border border-blue-600 bg-blue-50 px-3 text-sm font-semibold text-blue-700'
                    : 'm-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50'
                }
              >
                Pass
              </button>
              <button
                type="button"
                disabled={!passed}
                onClick={() => {
                  dispatch({ type: 'endTurn', playerId: actorId });
                  setStaged(NOTHING_STAGED);
                }}
                className="m-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                End turn
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'buyShares', playerId: actorId, picks: staged.picks });
                dispatch({ type: 'endTurn', playerId: actorId });
                setStaged(NOTHING_STAGED);
              }}
              className="m-0 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {'Confirm purchase'}
            </button>
          )}
        />
      ),
    };
  }

  return { active: null, staging: idleStaging };
}
