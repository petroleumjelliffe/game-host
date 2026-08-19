import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { stepsOf } from './stepsOf';
import { createGameSession } from '../../../session/GameSession';
import { buildFixture } from '../../../engine/golden/fixtures';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';

function g(id: string) {
  const game = ALL_GOLDEN_GAMES.find((x) => x.id === id);
  if (!game) throw new Error(`no golden game ${id}`);
  return game;
}

describe('stepsOf — this turn and the one before it', () => {
  it('drops everything below the boundary it is given and keeps everything above', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];

    const whole = stepsOf(state!, []);
    // The stack really did accumulate: without a floor, a finished game's
    // panel carries every step of it. If this ever stops holding, the test
    // below is comparing nothing against nothing.
    expect(whole.length).toBeGreaterThan(3);

    // A cut taken from the log itself rather than a written-down number, so a
    // change to G1 moves the boundary rather than breaking the test.
    const cut = state!.log[Math.floor(state!.log.length / 2)]!.stepId;
    const scoped = stepsOf(state!, [], cut);

    expect(scoped.length).toBeLessThan(whole.length);
    expect(scoped.map((e) => e.stepId)).toEqual(
      whole.map((e) => e.stepId).filter((id) => id >= cut),
    );
  });
});

describe('the draw is hidden, not deleted', () => {
  /**
   * Both halves in one test on purpose. Hiding the bag's bookkeeping from the
   * panel is a display decision; losing it from the log would be a data one,
   * and the server projects those entries, the golden corpus asserts on them,
   * and Phase 4's recovery reads the log back. A test that only checked the
   * panel would pass just as happily if the filter had been put in the engine.
   */
  it('keeps Drew tiles in the log and out of the stack', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];

    expect(
      state!.log.some((e) => e.phase === 'Drew tiles'),
      'G1 no longer draws — this test is guarding nothing',
    ).toBe(true);

    expect(stepsOf(state!, []).some((s) => s.phase === 'Drew tiles')).toBe(false);
  });

  /**
   * The draw the players actually watch stays. It is the only record of who
   * won the order, and unlike the end-of-turn refill it is a thing someone
   * did.
   */
  it('keeps the turn-order draw', () => {
    // Driven from a real opening, not a golden game: the corpus is built from
    // `buildFixture`, which starts games already in progress, so no golden
    // state has ever contained a turn-order draw to assert against.
    const session = createGameSession({ seed: 'hidden-phase', names: ['Alex', 'Sam'] });
    const opener = session.getView().actorId!;
    session.dispatch({ type: 'drawTurnOrderTile', playerId: opener });

    const state = session.getView().state;
    expect(
      state.log.some((e) => e.phase === 'Drew for turn order'),
      'the opening no longer logs a turn-order draw',
    ).toBe(true);

    expect(stepsOf(state, []).some((s) => s.phase === 'Drew for turn order')).toBe(true);
  });

  /**
   * A hidden row must never take a control with it. `undoableSteps` is the
   * caller's list of rewind points, and an id that is filtered out of the
   * stack is an undo the player can no longer reach.
   */
  it('hides nothing that carries an undo', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });

    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    const view = session.getView();
    const drawIds = new Set(
      view.state.log.filter((e) => e.phase === 'Drew tiles').map((e) => e.stepId),
    );
    expect(drawIds.size, 'ending a turn no longer draws').toBeGreaterThan(0);

    for (const id of view.undoableSteps) {
      expect(drawIds.has(id), `step ${id} is a draw and is offered as an undo`).toBe(false);
    }
  });
});

describe('stepsOf', () => {
  it('turns log entries into step stack entries', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];
    const shown = state!.log.filter((e) => e.phase !== 'Drew tiles');
    const steps = stepsOf(state!, []);

    expect(steps.length).toBe(shown.length);
    expect(steps.map((s) => s.stepId)).toEqual(shown.map((e) => e.stepId));
    expect(steps[0]!.phase).toBe(shown[0]!.phase);
  });

  it('marks only the steps that have a snapshot as undoable', () => {
    const states = replayGoldenGame(g('G1'));
    const state = states[states.length - 1];
    const undoable = [state!.log[1]!.stepId];
    const steps = stepsOf(state!, undoable);

    expect(steps.find((s) => s.stepId === state!.log[1]!.stepId)?.undoable).toBe(true);
    expect(steps.find((s) => s.stepId === state!.log[0]!.stepId)?.undoable).toBe(false);
  });

  it('renders a payout step through PayoutLines rather than as a sentence', () => {
    const states = replayGoldenGame(g('G2'));
    const state = states.find((s) => s.log.some((e) => e.payload?.kind === 'payout'));
    if (!state) throw new Error('G2 no longer produces a payout payload');

    const payoutStep = stepsOf(state, []).find((s) => s.phase === 'Merger payout');
    if (!payoutStep) throw new Error('no payout step');

    render(<div>{payoutStep.detail}</div>);
    // PayoutLines labels the role; a plain token list would not.
    expect(screen.getAllByText(/majority|minority/i).length).toBeGreaterThan(0);
  });
});

describe('the founding step', () => {
  /**
   * The founder's share is a share, so it renders as one — the same stack the
   * staging pile and the hand zone use. It arrives as a typed payload for the
   * same reason a payout does: the token vocabulary is text, tiles, brands and
   * cash, and a certificate is none of those.
   */
  it('renders the founder share as a stock certificate', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        loners: ['E5'],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });

    const view = session.getView();
    const founding = stepsOf(view.state, view.undoableSteps).find(
      (e) => e.phase === 'Founded a startup',
    );
    if (!founding) throw new Error('no founding step');

    render(<div>{founding.detail}</div>);
    // A counted stack, not a brand chip: ×1 is the count, and the words say
    // which share it is.
    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.getByText(/founding share/i)).toBeInTheDocument();
  });
});

describe('whose step it was', () => {
  /**
   * The stack shows two turns. Without a name on them the previous player's
   * moves read as your own — which is most of what the panel is for when it is
   * not your turn.
   */
  it('names the player on every entry', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });

    const view = session.getView();
    const placement = stepsOf(view.state, view.undoableSteps).find(
      (e) => e.phase === 'Placed a tile',
    );
    expect(placement?.actor).toBe('Alex');
  });

  /**
   * Your own steps say "You". Reading your own name back at you is how a log
   * written for spectators reads when it is shown to a participant.
   */
  it('says "You" for the viewer, and the name for anyone else', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const view = session.getView();

    const asAlex = stepsOf(view.state, view.undoableSteps, 0, 'p1');
    const asSam = stepsOf(view.state, view.undoableSteps, 0, 'p2');
    const phaseIs = (e: { phase: string }) => e.phase === 'Placed a tile';

    expect(asAlex.find(phaseIs)?.actor).toBe('You');
    expect(asSam.find(phaseIs)?.actor).toBe('Alex');
  });

  /**
   * The property that decides the implementation, checked over the whole
   * corpus: an entry is attributed to **its own** `playerId`, never to whoever
   * happens to be taking the turn. A finished merger is the case that
   * separates the two — its liquidation entries belong to each shareholder in
   * the queue, and by the time the state settles the turn has moved on.
   */
  it('attributes every entry to its own player, across the corpus', () => {
    let sawNonActor = false;

    for (const game of ALL_GOLDEN_GAMES) {
      const states = replayGoldenGame(game);
      const state = states[states.length - 1];
      const turnActor = state!.players[state!.turnIndex]?.id;

      for (const entry of stepsOf(state!, [])) {
        const logged = state!.log.find((e) => e.stepId === entry.stepId)!;
        const expected = state!.players.find((p) => p.id === logged.playerId)?.name;
        expect(entry.actor, `${game.id} step ${entry.stepId} (${entry.phase})`).toBe(expected);
        if (logged.playerId !== undefined && logged.playerId !== turnActor) sawNonActor = true;
      }
    }

    // Without this the loop above would pass just as happily on a corpus where
    // every entry did belong to the current actor, which would make attributing
    // by actor indistinguishable from attributing by entry.
    expect(sawNonActor, 'no entry in the corpus belongs to anyone but the actor').toBe(true);
  });

  /**
   * A merger payout is filed with no player at all — it is a table-level event
   * whose rows name the players being paid inside `PayoutLines`. So it carries
   * no attribution, rather than borrowing the actor's.
   */
  it('leaves an entry with no player unattributed', () => {
    const states = replayGoldenGame(g('G2'));
    const state = states.find((s) => s.log.some((e) => e.phase === 'Merger payout'));
    if (!state) throw new Error('G2 no longer produces a merger payout');

    const payout = state.log.find((e) => e.phase === 'Merger payout')!;
    expect(payout.playerId, 'a payout is now filed under a player — rethink this').toBeUndefined();
    expect(stepsOf(state, []).find((e) => e.stepId === payout.stepId)?.actor).toBeUndefined();
  });
});

describe('the turn before yours', () => {
  /**
   * Driven through a real session rather than a hand-picked log index,
   * because the boundary under test is the one the session maintains — a
   * fixture that names a step id would be asserting against a number this
   * code no longer has to agree with.
   */
  it('shows what the previous player did, read-only, above your own steps', () => {
    const session = createGameSession({
      state: buildFixture({
        players: [
          { name: 'Alex', cash: 6000, hand: ['E6'] },
          { name: 'Sam', cash: 6000, hand: ['A1'] },
        ],
        bag: ['I11', 'I12', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
      }),
    });

    // Alex plays a whole turn: place, then end it.
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'endTurn', playerId: 'p1' });

    const view = session.getView();
    expect(view.actorId, 'the turn did not change hands').toBe('p2');
    expect(view.previousSegmentStart, 'no previous segment was recorded').toBeDefined();

    const steps = stepsOf(view.state, view.undoableSteps, view.previousSegmentStart);

    // Alex's placement is visible to Sam, and is not Sam's to undo.
    const placement = steps.find((e) => e.phase === 'Placed a tile');
    expect(placement, "the previous player's placement is missing").toBeDefined();
    expect(placement!.undoable).toBe(false);

    // Scoped to the open segment alone, Sam would see nothing of it.
    const openOnly = stepsOf(view.state, view.undoableSteps, view.segmentStart);
    expect(openOnly.some((e) => e.phase === 'Placed a tile')).toBe(false);
  });
});
