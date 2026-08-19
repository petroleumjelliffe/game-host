import type { GameState } from '../engine/gameTypes';
import type { Intent } from '../engine/intents';
import { IllegalIntentError } from '../engine/intents';
import {
  createSnapshotStore,
  applyIntentWithHistory,
  rewindTo,
  type SnapshotStore,
} from '../engine/history';
import { createInitialGame } from '../engine/gameInit';
import { getCurrentActor } from '../engine/actor';
import type { RejectionCode } from './protocol';

export interface SessionError {
  /**
   * Every refusal a session can surface. Wider than `IllegalIntentCode`
   * because undo is not an intent: the server can refuse one with
   * `undoOutOfSegment`, which the engine has no word for.
   */
  code: RejectionCode;
  message: string;
}

export interface SessionView {
  state: GameState;
  /** Whose input is awaited. Task 6 fills this in. */
  actorId: string | null;
  /** The segment just changed hands; the curtain is up. Task 6 fills this in. */
  awaitingReveal: boolean;
  /** Step ids that can be undone right now, oldest first. Task 6 scopes this. */
  undoableSteps: number[];
  /**
   * The step id the open segment began at. Every snapshot below it belongs to
   * a committed segment and is nobody's to undo.
   *
   * Exposed because Phase 3's server has to see a commit boundary it would
   * otherwise re-derive — and a second derivation of the segment rule is the
   * duplication this module exists to prevent.
   */
  segmentStart: number;
  /**
   * Where the segment before this one began, or `undefined` if this is the
   * first — the boundary the step stack needs to show the turn that just
   * finished.
   *
   * Nothing derives this from the log, because the log cannot be read back
   * into segments reliably: a merger files payout entries under players who
   * are not the actor, so "the contiguous run with the same playerId" is not
   * the same thing as "the previous segment". The session knows the boundary
   * because it is the thing that closes it.
   */
  previousSegmentStart?: number;
  /** The last rejected intent, cleared by the next successful one. */
  error: SessionError | null;
  /**
   * A bag-drawing intent is in flight and only the server can answer it.
   * Pass-and-play never sets this: it holds the bag.
   */
  pending?: boolean;
}

export interface GameSession {
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  dispatch(intent: Intent): void;
  undoTo(stepId: number): void;
  /**
   * Take a step back and do something else instead — one operation, because
   * the two halves are not independently sequenceable everywhere.
   *
   * Locally they are: undo then dispatch, on the next line. Over a wire they
   * are not — undo is the server's to grant, so the session is waiting for a
   * correction when the second call arrives and drops it on the floor. That
   * is exactly what shipped: switching a placed tile worked in pass-and-play,
   * and online un-placed the first tile without ever playing the second.
   * Owning the pair here is what lets each implementation sequence it its own
   * way.
   */
  undoThen(stepId: number, intent: Intent): void;
  reveal(): void;
  /**
   * Re-raises the curtain without touching the segment — the inverse of
   * `reveal()`, for when the device leaves the current player's hands with
   * the actor unchanged. Concretely: the installed app is backgrounded
   * mid-turn and later reopened, possibly by somebody else. A fresh launch
   * gets its curtain from session construction; a living page never
   * remounts, so it needs this said explicitly.
   */
  conceal(): void;
}

export type SessionInit = { seed: string; names: string[] } | { state: GameState };

/**
 * Owns the game state and the snapshot store, and is the only place that turns
 * an `IllegalIntentError` into something a player can read.
 *
 * Deliberately free of React: this is the seam Phase 3 cuts at, where
 * `dispatch` becomes "send the intent, await the server's broadcast" and the
 * view shape does not change. Keeping it plain also keeps the state machine
 * out of jsdom, which in Phase 1b proved able to pass tests over a visibly
 * broken page.
 */
export function createGameSession(init: SessionInit): GameSession {
  let state: GameState = 'state' in init
    ? structuredClone(init.state)
    : createInitialGame(init.seed, init.names);

  const store: SnapshotStore = createSnapshotStore();
  let error: SessionError | null = null;
  const listeners = new Set<() => void>();

  /**
   * A segment is a run of steps by one actor. Its start is the step id the
   * incoming actor's first intent will be filed under, so any snapshot below
   * it belongs to a closed segment and is not this player's to undo.
   */
  let actorId: string | null = getCurrentActor(state);
  let segmentStart: number = state.nextStepId;
  let previousSegmentStart: number | undefined;
  // A session opens behind the curtain, because it opens on somebody's hand.
  //
  // The exception is the *first* turn-order draw. Seat one draws first, and in
  // pass-and-play seat one is whoever just pressed Start game and is still
  // holding the device — a curtain there would ask them to hand it to
  // themselves. Every draw after the first is a real hand-off and gets its
  // curtain from the ordinary actor-change rule below. (Owner ruling,
  // 2026-08-08: a curtain *between* draws.)
  let awaitingReveal = state.stage !== 'draw';
  /** Whether the game is still inside the opening turn-order draw. */
  let drawPending = state.stage === 'draw';

  // Cached so `getView()` is referentially stable between changes —
  // `useSyncExternalStore` re-renders forever if the snapshot is a fresh
  // object on every call.
  let view: SessionView | null = null;

  function invalidate(): void {
    view = null;
    for (const listener of listeners) listener();
  }

  function buildView(): SessionView {
    return {
      state,
      actorId,
      awaitingReveal,
      undoableSteps: [...store.keys()].filter((k) => k >= segmentStart).sort((a, b) => a - b),
      segmentStart,
      previousSegmentStart,
      error,
    };
  }

  /**
   * Closes the segment if the actor changed: curtain up, undo range reset, and
   * every snapshot from the closed segment discarded — including the snapshot
   * of the boundary-crossing intent itself, which belongs to the player who
   * just finished, not to the one arriving.
   */
  function syncSegment(): void {
    const next = getCurrentActor(state);
    const actorChanged = next !== actorId;
    // Leaving the turn-order draw closes a segment even when the actor does
    // not change, which happens whenever the last drawer wins their own draw.
    //
    // Two things go wrong without it, and a by-hand pass found both:
    //   - the draw stays inside the open segment, so the panel offers `undo`
    //     on a random reveal. (Not exploitable — undo restores the bag too, so
    //     the re-draw is identical — but the design says a drawn tile cannot
    //     be taken back, and it could.)
    //   - `server/room.ts` derives its commit from `segmentStart` moving, so
    //     the whole table would not see who won until the winner had finished
    //     their entire first turn. The turn order is public the moment it
    //     exists.
    const leftDraw = drawPending && state.stage !== 'draw';
    drawPending = state.stage === 'draw';
    if (!actorChanged && !leftDraw) return;

    actorId = next;
    previousSegmentStart = segmentStart;
    segmentStart = state.nextStepId;
    // The curtain is narrower than the segment close, and this is the only
    // place they differ. It exists to hand the device to somebody else, so it
    // rises only when somebody else is actually being waited on. A last drawer
    // who wins their own draw keeps acting and keeps the device — curtaining
    // them would be asking them to pass it to themselves.
    if (actorChanged) awaitingReveal = true;
    for (const key of [...store.keys()]) {
      if (key < segmentStart) store.delete(key);
    }
  }

  function applyLocally(intent: Intent): void {
    try {
      state = applyIntentWithHistory(store, state, intent);
      error = null;
    } catch (e) {
      if (!(e instanceof IllegalIntentError)) throw e;
      error = { code: e.code, message: e.message };
    }
    syncSegment();
  }

  function rewind(stepId: number): void {
    state = rewindTo(store, stepId);
    error = null;
  }

  return {
    getView() {
      if (view === null) view = buildView();
      return view;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    dispatch(intent) {
      applyLocally(intent);
      invalidate();
    },

    undoTo(stepId) {
      rewind(stepId);
      invalidate();
    },

    undoThen(stepId, intent) {
      // Nothing to sequence: this session holds the whole game, so the two
      // happen back to back and the screen sees one change.
      rewind(stepId);
      applyLocally(intent);
      invalidate();
    },

    reveal() {
      awaitingReveal = false;
      invalidate();
    },

    conceal() {
      awaitingReveal = true;
      invalidate();
    },
  };
}
