import { useState } from 'react';
import type { GameSession } from '../../session/GameSession';
import type { Intent } from '../../engine/intents';
import type { Coord } from '../../engine/gameHelpers';
import { useGameSession } from './session/useGameSession';
import { Board } from './Board';
import { Panel } from './panel/Panel';
import { StepStack } from './panel/StepStack';
import { HandZone } from './panel/HandZone';
import { PlayersStrip } from './panel/PlayersStrip';
import { RevealOverlay } from './RevealOverlay';
import { FinalScoring } from './FinalScoring';
import { useTurnPanel } from './screen/useTurnPanel';
import { TurnToast } from './online/TurnToast';
import { stepsOf } from './screen/stepsOf';
import { ownerBadges, foundingTiles, lastPlacedTile } from './screen/boardMarks';
import { getDeadTilesInHand } from '../../engine/placement';
import { isStartupId } from '../../engine/startups';
import { getSharePrice } from '../../engine/gameLogic';
import { finalScore } from '../../engine/endGame';

/**
 * The composed game: board left, panel right, one curtain over both.
 *
 * The curtain covers the whole surface rather than just the board because the
 * two secrets live in different columns — the actor's tiles are on the board,
 * their shares are in the panel's hand zone — while cash is public either way
 * through the players strip. Covering one column would leak the other.
 *
 * Every panel slot is passed on every render so the zone order and the zone
 * heights never depend on the stage.
 *
 * Composition only. New interaction beats belong in `./screen/`.
 */
export interface GameScreenProps {
  session: GameSession;
  /**
   * The player at this device. Absent in pass-and-play, where one device is
   * shared and the viewer is therefore whoever is acting; present online,
   * where the viewer never changes and the curtain has nothing to protect.
   */
  viewerId?: string;
  /**
   * False while the transport backing `session` is down. Pass-and-play never
   * passes this — there is no transport to be down, so `canAct` there is
   * never affected by it. This is the belt to `NetworkSession.connectionLost`'s
   * suspenders: even if a drop were somehow never reported to the session
   * directly, threading connection status through here still forces the
   * panel inert rather than leaving stale controls live over a dead socket.
   */
  connected?: boolean;
  /**
   * Who has a live socket, by player id. Omitted — pass-and-play — means
   * everyone: there is no transport for anyone to be missing from.
   */
  presence?: Record<string, boolean>;
  /**
   * Finish the game for good — final scoring's own action, never shown
   * mid-game. Pass-and-play clears its save here; online never passes it,
   * because a room belongs to everyone in it and ending is not one player's
   * to do.
   */
  onEndGame?: () => void;
  /** Leave the game entirely. Omitted when nothing is hosting the screen. */
  onExit?: () => void;
  /** The floating back control in the board margin. Absent = no control. */
  onBack?: () => void;
}

export function GameScreen({ session, viewerId, connected = true, presence, onEndGame, onExit, onBack }: GameScreenProps) {
  const view = useGameSession(session);
  const { state, actorId, awaitingReveal, undoableSteps, pending } = view;

  /** This turn and the one before it. See `stepsOf`. */
  const historyFrom = view.previousSegmentStart ?? view.segmentStart;

  // Inert while someone else is acting, while an answer only the server can
  // give is in flight, or while the socket itself is down — otherwise the buy
  // panel stays live after "End turn" and the next click is a rejection
  // waiting to happen, or an intent nobody is there to receive.
  const canAct = (viewerId === undefined || viewerId === actorId) && !pending && connected;

  const actor = state.players.find((p) => p.id === actorId);

  /**
   * Whose private state the screen shows — their tiles on the board, their
   * shares in the hand zone.
   *
   * Nobody's, until the draw has decided who goes first — online as much as
   * pass-and-play (owner ruling): a hand highlighted under the draw button
   * reads as a turn already begun, whichever device it is on. The engine now
   * deals no hands until the last draw lands, so at the draw there is usually
   * nothing to hide — this branch is the belt for any state that still has
   * one, such as a save written before the deal moved. After the draw,
   * online shows me and pass-and-play shows the actor.
   */
  const viewer = state.stage === 'draw'
    ? undefined
    : viewerId === undefined
      ? actor
      : state.players.find((p) => p.id === viewerId);

  /** Nobody is "up" until the draw has decided who is. */
  const turnKnown = state.stage !== 'draw';

  /**
   * Whether a click on a hand tile can succeed at all.
   *
   * At `play` it is the move. After a placement, while the open segment holds
   * nothing else, it replaces that placement. Once anything has been built on
   * top — a brand founded, shares bought — it cannot, and the tiles go inert
   * rather than offering a click whose only outcome is an error message. That
   * error was reachable by hand: clicking a tile during the buy step told you
   * off for touching your own tiles.
   */
  const canPlaceNow = state.stage === 'play' || undoableSteps.length === 1;

  /**
   * Playing a tile, from wherever it was tapped.
   *
   * Both the board and the panel's hand call this, so the two are the same
   * move rather than two implementations of it — the catalog has said "on the
   * board or here" since Phase 1b, and the difference between them is where
   * your finger lands.
   *
   * Changing your mind is not an error. Placing a tile moves the stage on, so
   * a second tap used to be refused outright — you had to find the undo in the
   * step stack first, for what reads as one action: "no, that one."
   *
   * `undoThen`, not undo-then-dispatch on the next line: over a wire the undo
   * is the server's to grant, and a second call arriving while it is in flight
   * is dropped. That is how this shipped broken — the first tile came off the
   * board and the second was never played.
   */
  const placeTile = canAct && actorId && canPlaceNow
    ? (coord: Coord) => {
        const intent: Intent = { type: 'placeTile', playerId: actorId, coord };
        if (state.stage !== 'play' && undoableSteps.length === 1) {
          session.undoThen(undoableSteps[0]!, intent); // length === 1, checked above
        } else {
          session.dispatch(intent);
        }
      }
    : undefined;

  // The board's one hover-highlighted cell: the hand tile whose panel twin
  // the pointer is on. Pass-and-play only lights cells this way (owner,
  // hotseat pass — and hotseat only); online keeps its always-on badges via
  // `autoHighlight` below. Not reset on stage or actor changes because it
  // does not need to be — the board ignores a highlight that is not in the
  // current hand.
  const [hoverTile, setHoverTile] = useState<Coord | null>(null);

  // The panel shows the same seat the board does — one resolution of "whose
  // tiles are these", passed to both.
  const { active, staging } = useTurnPanel(view, (intent) => session.dispatch(intent), canAct, {
    viewer,
    onPlaceTile: placeTile,
    onHoverTile: setHoverTile,
  });

  /**
   * Which step is on show, for `StepReveal` to animate between.
   *
   * A prop rather than a React key: the zone has to *observe* the change so it
   * can hold the old step on screen while it collapses, and a key would unmount
   * that step before there was anything to animate away.
   *
   * Stage *and* actor: a merger's liquidation queue moves from one player to
   * the next without the stage changing, and that is a new step to whoever is
   * being asked.
   */
  const activeStepKey = `${state.stage}:${actorId}`;

  const prices = Object.fromEntries(
    Object.values(state.startups)
      .filter((s) => s.isFounded && isStartupId(s.id))
      .map((s) => [s.id, getSharePrice(state, s.id)]),
  );

  return (
    <div
      data-testid="game-surface"
      className="relative flex h-screen w-full overflow-hidden bg-gray-50"
    >
      {/* The way back, for the installed app — standalone chrome has no
          browser back (owner, from the first real install). Floated in the
          board's own margin, per the owner's placement: "upper left in
          margin next to board, not a whole empty row above it" — absolute,
          so it adds no row and moves no layout. Above the curtain (z-20)
          deliberately: between turns is exactly when whoever holds the
          device may want to put it down. */}
      {onBack && (
        <button
          type="button"
          aria-label="Back to the lobby"
          onClick={onBack}
          className="absolute left-3 top-3 z-20 m-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-600 shadow hover:bg-white hover:text-gray-900"
        >
          ←
        </button>
      )}
      <div className="flex min-w-0 flex-1 items-center justify-center p-4">
        <Board
          board={state.board}
          hand={viewer?.hand ?? []}
          placed={viewer?.lastPlacedTile ?? null}
          blocked={viewer ? getDeadTilesInHand(state, viewer.id) : []}
          owners={ownerBadges(state)}
          hqTiles={foundingTiles(state)}
          landed={lastPlacedTile(state)}
          highlight={hoverTile}
          autoHighlight={viewerId !== undefined}
          onCellClick={placeTile}
        />
      </div>

      <Panel
        stepstack={
          <StepStack
            entries={stepsOf(state, undoableSteps, historyFrom, viewer?.id)}
            onUndo={(stepId) => session.undoTo(stepId)}
          />
        }
        active={active}
        activeStep={activeStepKey}
        staging={staging}
        hand={
          <HandZone
            name={viewer?.name ?? ''}
            portfolio={viewer?.portfolio ?? {}}
            cash={viewer?.cash}
            prices={prices}
          />
        }
        players={
          <PlayersStrip
            players={state.players.map((p) => ({
              id: p.id,
              emoji: p.emoji,
              name: p.name,
              cash: p.cash,
              active: turnKnown && p.id === actorId,
              connected: presence?.[p.id] ?? true,
            }))}
          />
        }
      />

      {/*
        Online only. Pass-and-play has the curtain, which already says whose
        turn it is at full-screen size; showing both would be saying it twice.

        Keyed on the segment, so every handoff mounts a fresh toast: the
        your-turn form announces itself and leaves, and without the key it
        would announce once per game rather than once per turn.
      */}
      {viewerId !== undefined && actor && (
        <TurnToast
          key={`${actorId}-${view.segmentStart}`}
          name={actor.name}
          emoji={actor.emoji}
          mine={actorId === viewerId}
          disconnected={actorId !== null && presence?.[actorId] === false}
        />
      )}

      {viewerId === undefined && awaitingReveal && actor && (
        <div data-testid="curtain" className="absolute inset-0 z-20">
          <RevealOverlay
            playerName={actor.name}
            emoji={actor.emoji}
            onReveal={() => session.reveal()}
          />
        </div>
      )}

      {state.stage === 'end' && (
        <div
          data-testid="final-overlay"
          className="absolute inset-0 z-30 overflow-y-auto bg-white/95 p-6"
        >
          {/*
            The scoreboard is `finalScore(state)` spread straight in — its
            props *are* the engine's report, which is why there is no adapter
            here and no figure written down in `src/`. `actions` is a plain
            slot: `FinalScoring` renders whatever node it is given and still
            owns no routes or click handlers of its own. It used to be a
            sibling of `FinalScoring` instead — found by hand at 768px to sit
            on top of the winner banner, because `FinalScoring`'s root is
            `absolute inset-0` and contributes no flow height, so a "next"
            sibling anchors to the scrim's top edge rather than the card's
            bottom. Passing it as `actions` keeps it in the card's own flow,
            below the table, at every width.
          */}
          <FinalScoring
            {...finalScore(state)}
            actions={
              (onEndGame || onExit) && (
                <>
                  {onEndGame && (
                    <button
                      type="button"
                      onClick={onEndGame}
                      className="m-0 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                    >
                      End game
                    </button>
                  )}
                  {onExit && (
                    <button
                      type="button"
                      onClick={onExit}
                      className="m-0 rounded-lg border border-gray-300 px-4 py-2 font-semibold hover:bg-gray-50"
                    >
                      Back to menu
                    </button>
                  )}
                </>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
