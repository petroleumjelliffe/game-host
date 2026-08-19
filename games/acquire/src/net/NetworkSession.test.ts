import { describe, it, expect } from 'vitest';
import { createNetworkSession } from './NetworkSession';
import type { RoomTransport } from './transport';
import { buildFixture } from '../../engine/golden/fixtures';
import { ALL_GOLDEN_GAMES, type GoldenStep } from '../../engine/golden';
import { replayGoldenGame } from '../../engine/golden/replay';
import { getCurrentActor } from '../../engine/actor';
import type { GameState } from '../../engine/gameTypes';
import { DRAWS, type StateMessage } from '../../session/protocol';
import type { RejectedMessage } from '../../vendor/lobby/protocol/protocol';

/** p1 holds E6 next to a loner, so founding is one click away. p2 waits. */
function board(): GameState {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

function harness(state = board()) {
  const sent: unknown[] = [];
  const undos: number[] = [];
  let onState: ((m: StateMessage) => void) | null = null;
  let onRejected: ((m: RejectedMessage) => void) | null = null;
  let open = true;

  const transport: RoomTransport = {
    sendIntent: (w) => { sent.push(w); },
    sendUndo: (id) => { undos.push(id); },
    onState: (h) => { onState = h; return () => { onState = null; }; },
    onRejected: (h) => { onRejected = h; return () => { onRejected = null; }; },
    isOpen: () => open,
  };

  return {
    sent,
    undos,
    transport,
    setOpen: (v: boolean) => { open = v; },
    serverSays: (m: StateMessage) => onState?.(m),
    serverRefuses: (m: RejectedMessage) => onRejected?.(m),
    session: (playerId = 'p1') => createNetworkSession({
      transport,
      playerId,
      initial: { state, reason: 'commit', segmentStart: state.nextStepId },
    }),
  };
}

interface PredictableHandoff {
  states: GameState[];
  steps: GoldenStep[];
  startIndex: number;
  endIndex: number;
  playerId: string;
}

/**
 * Finds the first run, anywhere in the golden corpus, of two or more
 * consecutive steps by one player that a client would apply locally — no
 * `expectError` (rejected, so nothing to undo), no `DRAWS` (waits for the
 * server, so it is never in `undoableSteps` to begin with) — that ends with
 * `getCurrentActor` naming someone else.
 *
 * That is the one situation the `actorId === playerId` gate in `buildView`
 * exists for: an optimistic dispatch (a merger-triggering `placeTile`, a
 * liquidation that empties the last shareholder's holding, …) can hand the
 * turn to another player with no bag draw involved, before the server's
 * commit has confirmed it. A hand-built two-step fixture could assert the
 * same shape, but deriving the run from the golden corpus means the test
 * fails loudly (via the assertion below) if the corpus stops containing one,
 * rather than silently testing nothing.
 *
 * Consecutive is load-bearing: a same-player run can only be interrupted by
 * a step the engine actually rejects (declared `expectError`) or a `DRAWS`
 * step, both excluded here — so a contiguous run of eligible same-player
 * steps is, by construction, a run the real actor stayed on throughout.
 * Only the step just past the run's end can show a different actor.
 */
function findPredictableActorHandoff(): PredictableHandoff | null {
  for (const game of ALL_GOLDEN_GAMES) {
    const states = replayGoldenGame(game);
    let i = 0;
    while (i < game.steps.length) {
      const step = game.steps[i]!;
      if (step.expectError || DRAWS.has(step.intent.type)) {
        i++;
        continue;
      }
      const playerId = step.intent.playerId;
      let j = i;
      while (
        j + 1 < game.steps.length &&
        !game.steps[j + 1]!.expectError &&
        !DRAWS.has(game.steps[j + 1]!.intent.type) &&
        game.steps[j + 1]!.intent.playerId === playerId
      ) {
        j++;
      }
      if (j > i && getCurrentActor(states[j + 1]!) !== playerId) {
        return { states, steps: game.steps, startIndex: i, endIndex: j, playerId };
      }
      i = j + 1;
    }
  }
  return null;
}

describe('a predictable intent moves the screen before the server answers', () => {
  it('applies locally and sends', () => {
    const h = harness();
    const session = h.session();

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(session.getView().state.board['E6'].placed).toBe(true);
    expect(h.sent).toEqual([{ type: 'placeTile', coord: 'E6' }]);
    expect(session.getView().error).toBeNull();
  });
});

describe('a bag-drawing intent waits for the server', () => {
  it('changes nothing locally, and marks itself pending', () => {
    const h = harness();
    const session = h.session();
    const before = session.getView().state;

    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    expect(session.getView().state).toBe(before);
    expect(session.getView().pending).toBe(true);
    expect(h.sent).toEqual([{ type: 'endTurn' }]);
  });

  it('moves only when the server says so, and stops being pending', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    const next = buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5', 'H8'],
      bag: ['I11'],
    });
    h.serverSays({ state: next, reason: 'commit', segmentStart: next.nextStepId });

    expect(session.getView().state.board['H8'].placed).toBe(true);
    expect(session.getView().pending).toBe(false);
  });

  it('refuses a second intent while one is in flight', () => {
    const h = harness();
    const session = h.session();

    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(h.sent).toEqual([{ type: 'endTurn' }]);
    expect(session.getView().state.board['E6'].placed).toBe(false);
  });

  it('clears pending when the server refuses instead of answering', () => {
    // One of only two paths that ever clear a stuck `pending` — the other is
    // `connectionLost`, below. Today this is covered only incidentally, by
    // the golden corpus happening to contain bag-drawing steps that expect
    // an error; a corpus change could silently drop that coverage, so it is
    // asserted directly here too.
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    expect(session.getView().pending).toBe(true);

    h.serverRefuses({ code: 'wrongStage', message: 'not now' });

    expect(session.getView().pending).toBe(false);
  });
});

describe('a dropped connection clears a stuck pending', () => {
  it('stops "Sending…" from being permanent and leaves a readable message', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'endTurn', playerId: 'p1' });
    expect(session.getView().pending).toBe(true);

    session.connectionLost();

    expect(session.getView().pending).toBe(false);
    expect(session.getView().error?.message).toMatch(/disconnect/i);
  });

  it('does nothing to the board itself — only the request state', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const before = session.getView().state;

    session.connectionLost();

    expect(session.getView().state).toBe(before);
  });
});

describe('a resume', () => {
  it('adopts the server previousSegmentStart rather than starting blind', () => {
    const h = harness();
    const session = createNetworkSession({
      transport: h.transport,
      playerId: 'p2',
      initial: { state: board(), reason: 'resume', segmentStart: 12, previousSegmentStart: 4 },
    });

    // A refresh builds this session from one message. Without the field, the
    // step stack's read-only previous turn is blank until the next commit —
    // recovery that forgets what you were reading.
    expect(session.getView().previousSegmentStart).toBe(4);
  });

  it('clears a parked disconnection message when the state comes back', () => {
    const h = harness();
    const session = h.session('p2');

    session.connectionLost();
    expect(session.getView().error?.code).toBe('notConnected');

    h.serverSays({ state: board(), reason: 'resume', segmentStart: board().nextStepId });

    expect(session.getView().error).toBeNull();
  });
});

describe('an intent the local state refuses never reaches the wire', () => {
  it('reports the engine reason and sends nothing', () => {
    const h = harness();
    const session = h.session('p2');

    // p2 holds A1, but it is not p2's turn.
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });

    expect(h.sent).toEqual([]);
    expect(session.getView().error?.code).toBe('notYourTurn');
    expect(session.getView().state.board['A1'].placed).toBe(false);
  });

  it('refuses to send at all while the socket is down', () => {
    const h = harness();
    const session = h.session();
    h.setOpen(false);

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    expect(h.sent).toEqual([]);
    expect(session.getView().error?.message).toMatch(/connect/i);
    expect(session.getView().state.board['E6'].placed).toBe(false);
  });
});

describe('a rejection survives the reset that follows it', () => {
  it('keeps the message while adopting the server state', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    h.serverRefuses({ code: 'wrongStage', message: 'not now' });
    h.serverSays({ state: board(), reason: 'reset', segmentStart: board().nextStepId });

    expect(session.getView().state.board['E6'].placed).toBe(false);
    expect(session.getView().error).toEqual({ code: 'wrongStage', message: 'not now' });
  });

  it('clears the message on the next commit', () => {
    const h = harness();
    const session = h.session();
    h.serverRefuses({ code: 'wrongStage', message: 'not now' });

    h.serverSays({ state: board(), reason: 'commit', segmentStart: board().nextStepId });

    expect(session.getView().error).toBeNull();
  });
});

describe('undo is the servers to grant', () => {
  it('sends the step and changes nothing locally', () => {
    const h = harness();
    const session = h.session();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    session.undoTo(session.getView().undoableSteps[0]!);

    expect(h.undos).toHaveLength(1);
    expect(session.getView().state.board['E6'].placed).toBe(true);
  });
});

describe('undoableSteps covers my own open segment and nobody elses', () => {
  it('offers every step the open segment has taken', () => {
    const state = board();
    const h = harness(state);
    const session = h.session();

    expect(session.getView().undoableSteps).toEqual([]);
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(session.getView().undoableSteps).toEqual([state.nextStepId]);
  });

  it('offers nothing to a player who is not the actor', () => {
    const h = harness();
    const session = h.session('p2');
    expect(session.getView().undoableSteps).toEqual([]);
  });

  it('offers nothing once an optimistic intent has handed the actor away', () => {
    // The board()/E6 fixture never reaches this on its own — chooseFoundingBrand
    // and placeTile-into-buy both leave the actor unchanged, so a hand-built
    // two-step case here could only ever exercise the gate's "else" branch.
    // Pull a real handoff from the golden corpus instead: a run of two or more
    // locally-applied steps by one player that ends with the actor moved on.
    const found = findPredictableActorHandoff();
    expect(found, 'the corpus no longer contains a predictable actor handoff').not.toBeNull();
    if (!found) return;
    const { states, steps, startIndex, endIndex, playerId } = found;

    const h = harness(states[startIndex]);
    const session = h.session(playerId);

    session.dispatch(steps[startIndex]!.intent);
    // The segment is still mine after one step of the run: it has moved, and
    // I am still the actor.
    expect(session.getView().undoableSteps.length).toBeGreaterThan(0);

    for (let k = startIndex + 1; k <= endIndex; k++) session.dispatch(steps[k]!.intent);
    // The run's last step is exactly the one that hands the actor away.
    expect(session.getView().actorId).not.toBe(playerId);
    expect(session.getView().undoableSteps).toEqual([]);
  });
});

describe('the curtain has no meaning online', () => {
  it('never asks anyone to reveal', () => {
    const h = harness();
    const session = h.session();
    expect(session.getView().awaitingReveal).toBe(false);
    session.reveal();
    expect(session.getView().awaitingReveal).toBe(false);
  });
});

describe('taking a step back and playing something else', () => {
  /** p1 holds two playable tiles, so there is a second one to switch to. */
  function twoInHand(): GameState {
    return buildFixture({
      players: [
        { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
        { name: 'Sam', cash: 6000, hand: ['A1'] },
      ],
      loners: ['E5'],
      bag: ['I11', 'I12'],
    });
  }

  it('holds the replacement until the server grants the undo, then sends it', () => {
    const h = harness(twoInHand());
    const session = h.session();
    const opened = session.getView().state.nextStepId;

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    expect(h.sent).toEqual([{ type: 'placeTile', coord: 'E6' }]);

    // "No, that one instead." Undo is the server's to grant, so nothing but
    // the undo goes out yet.
    session.undoThen(opened, { type: 'placeTile', playerId: 'p1', coord: 'H8' });
    expect(h.undos).toEqual([opened]);
    expect(h.sent).toEqual([{ type: 'placeTile', coord: 'E6' }]);

    // The correction lands: the board is back to where it was, and only now
    // does the replacement go out. Sending it a line after `undoThen` — which
    // is what shipped — hit the pending guard and was dropped, so the first
    // tile came off the board and the second was never played.
    const rewound = twoInHand();
    h.serverSays({ state: rewound, reason: 'correction', segmentStart: rewound.nextStepId });

    expect(h.sent).toEqual([
      { type: 'placeTile', coord: 'E6' },
      { type: 'placeTile', coord: 'H8' },
    ]);
    expect(session.getView().state.board['H8'].placed).toBe(true);
    expect(session.getView().state.board['E6'].placed).toBe(false);
  });

  it('drops the replacement if the undo is refused', () => {
    const h = harness(twoInHand());
    const session = h.session();
    const opened = session.getView().state.nextStepId;
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    session.undoThen(opened, { type: 'placeTile', playerId: 'p1', coord: 'H8' });
    h.serverRefuses({ code: 'undoOutOfSegment', message: 'not yours to undo' });

    // The step it meant to replace is still there, so replacing it is
    // meaningless — and playing a second tile on top of the first would be
    // worse than doing nothing.
    expect(h.sent).toEqual([{ type: 'placeTile', coord: 'E6' }]);
    expect(session.getView().error?.code).toBe('undoOutOfSegment');
  });
});
