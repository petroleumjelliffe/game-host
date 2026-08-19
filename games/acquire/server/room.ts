import type { GameState } from '../engine/gameTypes.js';
import type { Intent } from '../engine/intents.js';
import { createInitialGame } from '../engine/gameInit.js';
import { createGameSession, type GameSession } from '../session/GameSession.js';
import { DRAWS, type RejectionCode, type WireIntent } from '../session/protocol.js';
import type { Lifecycle } from '../vendor/lobby/protocol/protocol.js';
import type { SeatHolder } from '../vendor/lobby/server/rooms.js';

export type RoomPlayer = SeatHolder;

export type { Lifecycle };

/**
 * What the transport must do next. The room computes it and sends nothing:
 * every socket call, and every call to `project`, lives in `server/index.ts`.
 * Keeping them apart is what lets the whole authority be tested without a
 * network, and what stops a projection being computed anywhere but the send
 * site.
 */
export type Delivery =
  | { kind: 'none' }
  | { kind: 'commit' }
  | { kind: 'correction'; to: string }
  | { kind: 'rejected'; to: string; code: RejectionCode; message: string };

export interface GameRoom {
  readonly id: string;
  readonly players: RoomPlayer[];
  lifecycle(): Lifecycle;
  /** What the table has seen. */
  committed(): GameState;
  /** The open segment's work in progress. Only its actor may be shown this. */
  draft(): GameState;
  actorId(): string | null;
  segmentStart(): number;
  /** Where the segment before the open one began, once one has closed. */
  previousSegmentStart(): number | undefined;
  begin(seed: string): Delivery;
  dispatch(playerId: string, wire: WireIntent): Delivery;
  undo(playerId: string, stepId: number): Delivery;
}

/**
 * Rebuilds a full `Intent` from what arrived on the wire plus the identity the
 * socket is bound to.
 *
 * The cast is deliberately confined to this one line. Spreading a discriminated
 * union produces a type TypeScript will not narrow back to that union, even
 * though every `WireIntent` plus a `playerId` is by construction an `Intent`.
 * `session/protocol.ts` derives one from the other, so they cannot drift.
 */
function withPlayer(wire: WireIntent, playerId: string): Intent {
  return { ...wire, playerId } as Intent;
}

export function createGameRoom(
  id: string,
  players: RoomPlayer[],
  initial?: GameState,
  /**
   * Where the segment before the open one began, for a *restored* room.
   *
   * Only `restore` passes this. A live room computes it as segments close; a
   * restored one lost that memory with its process, and without it the step
   * stack's previous turn is blank until the next commit.
   */
  initialPreviousSegmentStart?: number,
): GameRoom {
  // A restored game that has already ended comes back `over`, not `playing`.
  // Deriving this from the state rather than from "was I handed one" is what
  // stops a finished game reviving as one still waiting on a move nobody can
  // legally make.
  let lifecycle: Lifecycle = initial ? (initial.stage === 'end' ? 'over' : 'playing') : 'lobby';
  let session: GameSession | null = initial ? createGameSession({ state: initial }) : null;
  let committed: GameState | null = session ? session.getView().state : null;
  let previousSegmentStart: number | undefined = initialPreviousSegmentStart;

  function open(): GameSession {
    if (!session) throw new Error(`room ${id} has not begun`);
    return session;
  }

  /** Publishes the draft and records whether the game is over. */
  function commit(state: GameState): Delivery {
    committed = state;
    if (state.stage === 'end') lifecycle = 'over';
    return { kind: 'commit' };
  }

  return {
    id,
    players,

    lifecycle: () => lifecycle,
    committed: () => {
      if (!committed) throw new Error(`room ${id} has not begun`);
      return committed;
    },
    draft: () => open().getView().state,
    actorId: () => open().getView().actorId,
    segmentStart: () => open().getView().segmentStart,
    previousSegmentStart: () => previousSegmentStart,

    begin(seed) {
      if (lifecycle !== 'lobby') throw new Error(`room ${id} has already begun`);
      // `createInitialGame` assigns ids `p1..pn` by seat, which is how the
      // roster numbers them too — so the socket binding and the engine agree
      // about who is who without a mapping layer.
      const state = createInitialGame(seed, players.map((p) => p.name));
      session = createGameSession({ state });
      lifecycle = 'playing';
      return commit(session.getView().state);
    },

    dispatch(playerId, wire) {
      const s = open();
      const opened = s.getView().segmentStart;

      s.dispatch(withPlayer(wire, playerId));
      const view = s.getView();

      if (view.error) {
        return { kind: 'rejected', to: playerId, code: view.error.code, message: view.error.message };
      }

      if (view.segmentStart !== opened) {
        // `opened` was read before the dispatch, so it is where the segment
        // that just closed began — recorded here rather than derived later,
        // because after the commit nothing remembers it.
        previousSegmentStart = opened;
        return commit(view.state);
      }

      // The draft advanced and stayed with its author. They computed the same
      // result locally, unless it drew from a bag they do not hold — see
      // `DRAWS` in `session/protocol.ts`.
      return DRAWS.has(wire.type) ? { kind: 'correction', to: playerId } : { kind: 'none' };
    },

    undo(playerId, stepId) {
      const s = open();
      const view = s.getView();

      if (view.actorId !== playerId) {
        return {
          kind: 'rejected',
          to: playerId,
          code: 'notYourTurn',
          message: 'only the player being waited on may undo',
        };
      }
      if (!view.undoableSteps.includes(stepId)) {
        return {
          kind: 'rejected',
          to: playerId,
          code: 'undoOutOfSegment',
          message: `step ${stepId} is not in the open segment`,
        };
      }

      s.undoTo(stepId);
      return { kind: 'correction', to: playerId };
    },
  };
}
