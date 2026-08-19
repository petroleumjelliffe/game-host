import {
  createGameSession,
  type GameSession,
  type SessionError,
  type SessionView,
} from '../../session/GameSession';
import type { Intent } from '../../engine/intents';
import { DRAWS, toWire, type RejectionCode, type StateMessage } from '../../session/protocol';
import type { RoomTransport } from './transport';

export interface NetworkSession extends GameSession {
  /** Detaches the transport handlers. Call when the room screen unmounts. */
  dispose(): void;
  /**
   * The transport dropped out from under an outstanding request.
   *
   * `pending` otherwise clears only two ways: the server's own `state` or
   * `rejected` message — and neither arrives once the socket is gone. Without
   * this, a dropped socket mid-request left `pending` latched forever: the
   * panel read "Sending…" for good, socket.io's automatic reconnect gave no
   * signal a session could act on, and once reconnected the server saw an
   * unbound socket and dropped every intent silently. `useRoom` calls this on
   * a connection-status transition away from `open`; it clears `pending` and
   * leaves a message the player can read, and `GameScreen`'s own `connected`
   * prop backs it up by forcing `canAct` false independently, so the panel
   * goes inert even if this were somehow never called.
   */
  connectionLost(): void;
}

export interface NetworkSessionInit {
  transport: RoomTransport;
  /** The seat this device holds. Comes from the socket binding, never a form. */
  playerId: string;
  /** The first state the server sent. A room is never entered blind. */
  initial: StateMessage;
}

function range(from: number, toExclusive: number): number[] {
  const out: number[] = [];
  for (let i = from; i < toExclusive; i++) out.push(i);
  return out;
}

/**
 * A `GameSession` whose authority is elsewhere.
 *
 * It holds a real `GameSession` built from the last state the server sent and
 * replaces it whenever a new one arrives. That reuse is the point: the
 * optimistic path runs the same `applyIntentWithHistory` pass-and-play runs,
 * so there is no second copy of the rules and no second step stack to drift.
 */
export function createNetworkSession(
  { transport, playerId, initial }: NetworkSessionInit,
): NetworkSession {
  let inner = createGameSession({ state: initial.state });
  let segmentStart = initial.segmentStart;
  /**
   * The segment before the open one, learned from the messages themselves: a
   * commit carries a new `segmentStart`, and whatever it replaces is where
   * the turn that just finished began. Corrections repeat the current one, so
   * only a change moves this. Seeded from the initial message so a session
   * rebuilt from a single message after a refresh does not start blind.
   */
  let previousSegmentStart: number | undefined = initial.previousSegmentStart;
  let rejection: SessionError | null = null;
  let pending = false;
  /**
   * An intent waiting on an undo the server has not granted yet.
   *
   * Undo is a round trip here, so "take that back and play this instead"
   * cannot be two calls in a row the way it is locally: the second would
   * arrive while the first is still in flight and be dropped. The follow-up
   * waits here and goes out when the correction lands.
   */
  let awaitingUndo: Intent | null = null;
  let view: SessionView | null = null;
  const listeners = new Set<() => void>();

  function invalidate(): void {
    view = null;
    for (const listener of listeners) listener();
  }

  const offState = transport.onState((msg) => {
    inner = createGameSession({ state: msg.state });
    // The server's own answer wins when it has one. The local derivation
    // below it is the fallback for the only case the server cannot answer —
    // before any segment has closed, when there is no previous one to name.
    if (msg.previousSegmentStart !== undefined) previousSegmentStart = msg.previousSegmentStart;
    else if (msg.segmentStart !== segmentStart) previousSegmentStart = segmentStart;
    segmentStart = msg.segmentStart;
    pending = false;
    // A `reset` is the rollback half of a rejection the player has just been
    // shown. Clearing the error here would take the explanation away with the
    // state it explains — they arrive as two messages, in that order, and are
    // one event.
    if (msg.reason !== 'reset') rejection = null;

    // The undo this was waiting on has landed. Play the replacement now, on
    // the state the server just confirmed.
    const follow = awaitingUndo;
    awaitingUndo = null;
    invalidate();
    if (follow !== null) send(follow);
  });

  const offRejected = transport.onRejected((msg) => {
    // `RejectedMessage.code` is `string` on the wire type — `lobby/protocol.ts`
    // is game-agnostic and cannot name `RejectionCode`, which lives here and
    // depends on the engine. The server only ever sends a real `RejectionCode`
    // on this channel; this narrows back to what `SessionError` has always
    // required.
    rejection = { code: msg.code as RejectionCode, message: msg.message };
    pending = false;
    // The undo was refused, so its replacement is meaningless: the step it
    // meant to replace is still there.
    awaitingUndo = null;
    invalidate();
  });

  function buildView(): SessionView {
    const base = inner.getView();
    return {
      ...base,
      // No device is passed, so there is no curtain and nothing to reveal.
      awaitingReveal: false,
      segmentStart,
      previousSegmentStart,
      pending,
      // Derived, not stored. Gated on being the actor because an optimistic
      // `liquidate` or a merger-triggering `placeTile` can hand the actor to
      // someone else with no bag draw involved — and for the moment before
      // the commit lands, `segmentStart` names a segment this player no
      // longer owns.
      undoableSteps: base.actorId === playerId
        ? range(segmentStart, base.state.nextStepId)
        : [],
      error: rejection ?? base.error,
    };
  }

  /** The one path an intent takes to the wire. */
  function send(intent: Intent): void {
      // One answer is already outstanding; a second intent would race it and
      // come back as a rejection for pressing a button that was still there.
      if (pending) return;

      if (!transport.isOpen()) {
        rejection = { code: 'notConnected', message: 'Not connected. Reconnecting…' };
        invalidate();
        return;
      }

      const wire = toWire(intent);

      if (DRAWS.has(wire.type)) {
        // No bag here to draw from, so there is nothing to predict.
        rejection = null;
        pending = true;
        transport.sendIntent(wire);
        invalidate();
        return;
      }

      rejection = null;
      inner.dispatch(intent);
      // A local refusal is the engine's, on the same visible state the server
      // will judge — so it is an answer, not a guess, and the wire never sees
      // it. If the server disagrees anyway, that disagreement arrives as a
      // rejection and is worth knowing about.
      if (inner.getView().error === null) transport.sendIntent(wire);
      invalidate();
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

    dispatch: send,

    undoTo(stepId: number) {
      if (pending || !transport.isOpen()) return;
      rejection = null;
      pending = true;
      transport.sendUndo(stepId);
      invalidate();
    },

    /**
     * Undo, and play `intent` the moment the server grants it.
     *
     * Two calls in a row cannot work here: `undoTo` marks the session pending
     * until the correction arrives, and `send` refuses while pending. That is
     * the bug this exists to fix — switching a placed tile online took the
     * first one off the board and never played the second.
     */
    undoThen(stepId: number, intent: Intent) {
      if (pending || !transport.isOpen()) return;
      rejection = null;
      pending = true;
      awaitingUndo = intent;
      transport.sendUndo(stepId);
      invalidate();
    },

    reveal() {
      // Nothing to reveal: this device shows one player's own state, always.
    },

    conceal() {
      // Nothing to conceal, for the same reason: the curtain is a
      // pass-the-device concept, and online nobody else's hand is ever on
      // this screen to protect.
    },

    connectionLost() {
      pending = false;
      rejection = { code: 'notConnected', message: 'Disconnected. Reconnecting…' };
      invalidate();
    },

    dispose() {
      offState();
      offRejected();
      listeners.clear();
    },
  };
}
