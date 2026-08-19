import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { GameScreen } from '../GameScreen';
import { createGameSession } from '../../../session/GameSession';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
import { buildFixture } from '../../../engine/golden/fixtures';

function golden(id: string) {
  const game = ALL_GOLDEN_GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`no golden game ${id}`);
  return game;
}

/** Clears the curtain whenever it is up, so a driven test can keep going. */
function passDevice() {
  const reveal = screen.queryByRole('button', { name: /^start$/i });
  if (reveal) fireEvent.click(reveal);
}

/**
 * Dispatches into the session the screen is bound to, inside `act`.
 *
 * The session is an external store, so a bare `dispatch` notifies React
 * outside its batching and the DOM is left showing the previous state — a
 * test that then queries the screen reads stale markup and fails for a reason
 * that has nothing to do with the game.
 */
function apply(session: ReturnType<typeof createGameSession>, intent: Parameters<typeof session.dispatch>[0]) {
  act(() => { session.dispatch(intent); });
}

describe('driven golden games', () => {
  it('G2: a two-way merger pays out and liquidates through the real screen', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);
    passDevice();

    // Walk the golden game's own intents, but through the session the screen
    // is bound to, then assert the screen reflects each stage.
    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }
    passDevice();

    const expected = replayGoldenGame(game).at(-1)!;
    const actual = session.getView().state;
    expect(actual.stage).toBe(expected.stage);
    expect(actual.players.map((p) => p.cash)).toEqual(expected.players.map((p) => p.cash));
    expect(actual.players.map((p) => p.portfolio)).toEqual(expected.players.map((p) => p.portfolio));
  });

  it('G2: the payout renders as lines in the step stack, not a bare sentence', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
      if (session.getView().state.log.some((e) => e.payload?.kind === 'payout')) break;
    }
    passDevice();

    expect(screen.getAllByText(/majority|minority/i).length).toBeGreaterThan(0);
  });

  it('G7: a three-way merger runs its absorptions in order', () => {
    const game = golden('G7');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    const actorsSeen = new Set<string>();
    for (const step of game.steps) {
      passDevice();
      const actor = session.getView().actorId;
      if (actor) actorsSeen.add(actor);
      apply(session, step.intent);
    }
    passDevice();

    const expected = replayGoldenGame(game).at(-1)!;
    expect(session.getView().state.stage).toBe(expected.stage);
    expect(session.getView().state.players.map((p) => p.cash))
      .toEqual(expected.players.map((p) => p.cash));
    // A three-way merger must have involved more than one decision-maker.
    expect(actorsSeen.size).toBeGreaterThan(1);
  });

  it('raises the curtain between liquidators rather than resolving in place', () => {
    const game = golden('G2');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    let curtains = 0;
    for (const step of game.steps) {
      if (session.getView().awaitingReveal) curtains += 1;
      passDevice();
      apply(session, step.intent);
    }
    expect(curtains).toBeGreaterThan(0);
  });
});

describe('driven golden games — the end', () => {
  it('G9: a declared 41-tile end scores through the real screen', () => {
    const game = golden('G9');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }

    const expected = replayGoldenGame(game).at(-1)!;
    const actual = session.getView().state;
    expect(actual.stage).toBe('end');
    expect(actual.stage).toBe(expected.stage);
    // Reach the golden terminal state for real, not just its stage — the
    // same comparison G2 and G7 make above, on the values that matter once
    // the game is over: what each player walked away with.
    expect(actual.players.map((p) => p.cash)).toEqual(expected.players.map((p) => p.cash));
    expect(actual.players.map((p) => p.portfolio)).toEqual(expected.players.map((p) => p.portfolio));

    // The overlay is showing, and the figures on it are the engine's.
    //
    // Scoped to `[data-fs-row="total"]`, not a bare `getByText`: the
    // scoreboard's winner banner restates the winner's total in its own
    // sentence, so `$27,800` appears twice in the overlay and a bare text
    // query throws on the collision. Reading the total row's cells keeps
    // the assertion meaningful — it still fails if the scoreboard is absent
    // or shows the wrong figures — without matching the banner instead.
    const overlay = screen.getByTestId('final-overlay');
    expect(overlay).toBeInTheDocument();
    const totals = Array.from(overlay.querySelectorAll('[data-fs-row="total"]'), (el) => el.textContent);
    expect(totals).toContain('$27,800');
    expect(totals).toContain('$21,600');
    expect(totals).toContain('$4,300');
  });

  it('G10: an all-safe end scores through the real screen', () => {
    const game = golden('G10');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    for (const step of game.steps) {
      passDevice();
      apply(session, step.intent);
    }

    expect(session.getView().state.stage).toBe('end');
    const overlay = screen.getByTestId('final-overlay');
    expect(overlay).toBeInTheDocument();
    // Scoped to the overlay, not a bare `getByText`: the engine's own log
    // says "every founded chain is safe" while this UI copy says "startup" —
    // if that wording is ever aligned, an unscoped query would match both
    // and throw on the collision. Scoping keeps the assertion meaningful
    // (it still fails if the overlay is missing the sentence) without
    // depending on the copy staying inconsistent.
    expect(within(overlay).getByText(/every founded startup is safe/i)).toBeInTheDocument();
  });

  it('G11: an end that is declined leaves the game running', () => {
    const game = golden('G11');
    const session = createGameSession({ state: buildFixture(game.setup) });
    render(<GameScreen session={session} />);

    // G11's own steps run past the decline: its third step has Sam declare
    // the end himself, and that genuinely does end the game (that's the
    // point of the golden game — declining doesn't forfeit the option
    // forever). This test is about the decline specifically — that meeting
    // the end condition once doesn't latch the game into "over" — so it
    // stops short of that final `declareEnd` and drives only the decline
    // (step 1) and the normal turn that follows it (step 2).
    for (const step of game.steps.slice(0, -1)) {
      passDevice();
      apply(session, step.intent);
    }

    expect(session.getView().state.stage).not.toBe('end');
    expect(screen.queryByTestId('final-overlay')).toBeNull();
  });
});
