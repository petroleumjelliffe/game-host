import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { GameScreen } from './GameScreen';
import { createGameSession } from '../../session/GameSession';
import type { GameSession, SessionView } from '../../session/GameSession';
import { buildFixture } from '../../engine/golden/fixtures';
import { ALL_GOLDEN_GAMES } from '../../engine/golden';
import { replayGoldenGame } from '../../engine/golden/replay';

function playable() {
  return buildFixture({
    players: [
      { name: 'Alex', cash: 6000, hand: ['E6', 'H8'] },
      { name: 'Sam', cash: 6000, hand: ['A1'] },
    ],
    loners: ['E5'],
    bag: ['I11', 'I12'],
  });
}

/**
 * A coordinate now appears in up to three places at once — the board cell, the
 * hand shown in the panel's placement step, and any log token naming it — and
 * all three carry `title={coord}`. Every query that means "the board" says so.
 */
function onBoard(coord: string) {
  const grid = screen.getByTestId('game-surface').querySelector('[data-board="grid"]')!;
  return within(grid as HTMLElement).getByTitle(coord);
}

describe('GameScreen', () => {
  it('covers the whole surface with the curtain until the actor claims it', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);

    expect(screen.getByText(/pass to/i)).toBeInTheDocument();
    const curtain = within(screen.getByTestId('game-surface')).getByTestId('curtain');
    expect(curtain.className).toMatch(/inset-0/);
  });

  it('shows the board and panel once revealed', () => {
    const { container } = render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    expect(container.querySelector('[data-board="grid"]')).not.toBeNull();
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });

  it('renders all five panel slots at every stage, so the panel cannot resize', () => {
    const session = createGameSession({ state: playable() });
    const { container } = render(<GameScreen session={session} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    const slotsAtPlay = [...container.querySelectorAll('[data-slot]')]
      .map((el) => el.getAttribute('data-slot'));
    expect(slotsAtPlay).toEqual(['stepstack', 'active', 'staging', 'hand', 'players']);

    fireEvent.click(onBoard('E6'));
    const slotsAtFound = [...container.querySelectorAll('[data-slot]')]
      .map((el) => el.getAttribute('data-slot'));
    expect(slotsAtFound).toEqual(slotsAtPlay);
  });

  it('plays a whole turn and raises the curtain for the next player', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    fireEvent.click(onBoard('E6'));
    fireEvent.click(screen.getByRole('button', { name: /^messla$/i }));
    // Buying nothing is said once — Pass arms End turn, the same way staging
    // a share would. The turn cannot end over an empty basket by accident.
    fireEvent.click(screen.getByRole('button', { name: /^pass$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^end turn$/i }));

    expect(screen.getByText(/pass to sam/i)).toBeInTheDocument();
  });

  /**
   * The active zone is wrapped so it can animate its own height when the step
   * changes — the one motion in the panel, which pushes the history above it.
   * `GameScreen` supplies the step's identity; the zone has to *observe* that
   * change rather than be remounted by it, or there is nothing left on screen
   * to animate away.
   */
  it('hands the active zone a step identity to animate between', () => {
    const { container } = render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    const zone = container.querySelector('[data-slot="active"] [data-step-reveal]');
    expect(zone, 'the active zone is not wrapped for the reveal').not.toBeNull();
  });

  it('undoes a placement from the step stack', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    fireEvent.click(onBoard('E6'));
    expect(screen.getByText(/found a startup/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });
});

describe('the hand highlight follows the pointer', () => {
  /**
   * The owner's hotseat pass: the board highlights nothing automatically —
   * six lit cells read as six placements already made. A cell lights only
   * while its twin in the panel's hand is pointed at, one at a time, and an
   * unhighlighted cell is still the move.
   */
  it('lights a board cell only while its panel twin is pointed at', () => {
    const { container } = render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    expect(onBoard('E6')).toHaveAttribute('data-tile-state', 'empty');
    expect(onBoard('H8')).toHaveAttribute('data-tile-state', 'empty');

    const panelHand = container.querySelector('[data-panel-hand]')!;
    fireEvent.mouseOver(within(panelHand as HTMLElement).getByTitle('E6'));

    expect(onBoard('E6')).toHaveAttribute('data-tile-state', 'hand');
    expect(onBoard('H8')).toHaveAttribute('data-tile-state', 'empty');

    fireEvent.mouseOut(within(panelHand as HTMLElement).getByTitle('E6'));
    expect(onBoard('E6')).toHaveAttribute('data-tile-state', 'empty');
  });

  it('places from an unhighlighted board cell all the same', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));

    // No hover anywhere — the cell looks empty and is still the move.
    expect(onBoard('E6')).toHaveAttribute('data-tile-state', 'empty');
    fireEvent.click(onBoard('E6'));

    expect(screen.getByText(/found a startup/i)).toBeInTheDocument();
  });
});

describe('changing your mind about a tile', () => {
  function placedE6() {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    fireEvent.click(onBoard('E6'));
    // E6 sits next to the loner E5, so placing it asks which brand to found —
    // the stage has moved on, which is what used to make a second click an
    // error rather than a correction.
    expect(screen.getByText(/found a startup/i)).toBeInTheDocument();
  }

  it('switches to the new tile without an undo first', () => {
    placedE6();

    fireEvent.click(onBoard('H8'));

    // H8 is played, E6 is back in hand — a clickable cell again, wearing no
    // highlight because nothing does until pointed at — and nothing was
    // refused.
    expect(onBoard('H8')).toHaveAttribute('data-tile-state', 'filled');
    expect(onBoard('E6')).toHaveAttribute('data-tile-state', 'empty');
    expect(onBoard('E6').tagName).toBe('BUTTON');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses once the placement has been built on', () => {
    placedE6();
    // Founding the brand settles the placement: undo is the way back now.
    fireEvent.click(screen.getByRole('button', { name: /^messla$/i }));

    fireEvent.click(onBoard('H8'));

    // E6 stands — part of the chain it founded — and H8 is not even a
    // control any more, so the click above could do nothing at all.
    expect(onBoard('E6')).not.toHaveAttribute('data-tile-state', 'empty');
    expect(onBoard('H8')).toHaveAttribute('data-tile-state', 'empty');
    expect(onBoard('H8').tagName).toBe('SPAN');
  });
});

describe('GameScreen at the turn-order draw', () => {
  /** A fresh game: the draw has not happened, so no hands exist yet. */
  function atDraw() {
    return createGameSession({ seed: 'draw-1', names: ['Alex', 'Sam'] });
  }

  /**
   * The draw is a gate in front of the game, not seat one's turn. Seat one
   * presses the button on behalf of the table, so none of their private state
   * may be on screen: not their tiles on the board, not their shares in the
   * hand zone. Showing them made the draw read as "Player 1's turn has begun",
   * which is why handing play to whoever won it looked like a skipped turn.
   */
  it('puts nobody hand on the board before the draw', () => {
    const { container } = render(<GameScreen session={atDraw()} />);
    expect(container.querySelector('[data-board="grid"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-board="grid"] button')).toHaveLength(0);
  });

  it('names no player in the hand zone before the draw', () => {
    render(<GameScreen session={atDraw()} />);
    expect(screen.queryByText(/'s hand/i)).toBeNull();
  });

  it('shows no shares or balance for anyone before the draw', () => {
    const { container } = render(<GameScreen session={atDraw()} />);
    const hand = container.querySelector('[data-slot="hand"]')!;
    expect(hand.textContent).not.toMatch(/\$6,000/);
  });

  it('goes straight to the first draw with no curtain in the way', () => {
    // Seat one draws first, and in pass-and-play seat one is whoever just
    // pressed Start game and is still holding the device. A curtain here would
    // ask them to hand it to themselves.
    render(<GameScreen session={atDraw()} />);
    expect(screen.queryByText(/pass to/i)).toBeNull();
    expect(screen.getByRole('button', { name: /draw your tile/i })).toBeInTheDocument();
  });

  it('raises the curtain between draws, so the device can be passed on', () => {
    // The owner's ruling, and the reason the draw is a turn at all: after seat
    // one draws it is seat two's draw, and somebody has to be told to hand the
    // device over. Deterministic regardless of who wins — the actor always
    // moves from seat one to seat two here.
    render(<GameScreen session={atDraw()} />);
    fireEvent.click(screen.getByRole('button', { name: /draw your tile/i }));
    expect(screen.getByText(/pass to/i)).toBeInTheDocument();
  });

  /**
   * Online is the same gate, not a different one. The first cut showed the
   * viewer their own hand here ("my device, my hand, always"), and the owner
   * found what that does on a real board: six highlighted tiles under a draw
   * button, reading as a turn already begun.
   */
  it('puts no hand on the board before the draw, online included', () => {
    // Not the button count — at the draw the tiles are inert either way. The
    // leak was the *highlight*: six cells marked as the viewer's hand.
    const { container } = render(<GameScreen session={atDraw()} viewerId="p1" />);
    expect(container.querySelector('[data-board="grid"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-tile-state="hand"]')).toHaveLength(0);
  });

  it('names no player in the hand zone before the draw, online included', () => {
    render(<GameScreen session={atDraw()} viewerId="p1" />);
    expect(screen.queryByText(/'s hand/i)).toBeNull();
  });
});

it('marks nobody as the active seat before the draw', () => {
  // Highlighting seat one in the roster is the same conflation in miniature:
  // they press the button, but no turn has begun and no seat is "up" yet.
  const { container } = render(
    <GameScreen session={createGameSession({ seed: 'draw-2', names: ['Alex', 'Sam'] })} />,
  );
  expect(container.querySelectorAll('[data-seat] .border-blue-600')).toHaveLength(0);
  expect(container.querySelectorAll('[data-seat].border-blue-600')).toHaveLength(0);
});

describe('GameScreen at the end of a game', () => {
  function ended() {
    const g9 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G9')!;
    const state = replayGoldenGame(g9).at(-1)!;
    if (state.stage !== 'end') throw new Error('G9 no longer ends');
    return createGameSession({ state });
  }

  it('covers the whole surface with the scoreboard', () => {
    render(<GameScreen session={ended()} />);
    const overlay = screen.getByTestId('final-overlay');
    expect(overlay.className).toMatch(/inset-0/);
  });

  it('shows the totals the engine reports', () => {
    const { container } = render(<GameScreen session={ended()} />);
    // G9's declared totals, derived — not written down anywhere in src/.
    // Scoped to the Total row: the winner's figure also headlines
    // `FinalScoring`'s banner ("X wins with $Y"), so a plain `getByText`
    // matches twice for whichever total is highest.
    const totals = [...container.querySelectorAll('[data-fs-row="total"]')].map(
      (el) => el.textContent,
    );
    expect(totals).toContain('$27,800');
    expect(totals).toContain('$21,600');
    expect(totals).toContain('$4,300');
  });

  it('says why the game ended', () => {
    render(<GameScreen session={ended()} />);
    // Scoped to the overlay: the step stack already logs a "Game over" entry
    // with the same reason text (from the `declareEnd` step in G9's history),
    // so an unscoped query matches both it and the overlay's banner.
    const overlay = screen.getByTestId('final-overlay');
    expect(within(overlay).getByText(/reached 41 tiles/i)).toBeInTheDocument();
  });

  it('offers to end the game and a way out when the page supplies them', () => {
    const onEndGame = vi.fn();
    const onExit = vi.fn();
    render(<GameScreen session={ended()} onEndGame={onEndGame} onExit={onExit} />);

    fireEvent.click(screen.getByRole('button', { name: /end game/i }));
    expect(onEndGame).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /back to menu/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it('keeps the end-game actions inside the scoreboard card', () => {
    // Regression: these buttons used to render as a sibling of `FinalScoring`
    // rather than through its `actions` slot. `FinalScoring`'s root is
    // `absolute inset-0`, which contributes no flow height — a sibling's
    // `mt-6` was measured from the scrim's top edge, not the card's bottom,
    // so the row landed on top of the winner banner (worst at 768px). An
    // unscoped `getByRole` (the test above) cannot tell the two layouts
    // apart, because the buttons are "present in the document" either way —
    // it has to be scoped to the card itself.
    const { container } = render(
      <GameScreen session={ended()} onEndGame={() => {}} onExit={() => {}} />,
    );
    const card = container.querySelector('[data-testid="final-overlay"] .rounded-2xl');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole('button', { name: /end game/i })).toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole('button', { name: /back to menu/i })).toBeInTheDocument();
  });

  it('omits the buttons the page did not supply', () => {
    render(<GameScreen session={ended()} />);
    expect(screen.queryByRole('button', { name: /end game/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /back to menu/i })).toBeNull();
  });

  it('shows no overlay while the game is still running', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    expect(screen.queryByTestId('final-overlay')).toBeNull();
  });
});

/**
 * A session whose view is fixed. Used only to put the screen into states a
 * local `GameSession` cannot produce — `pending` is set by the networked
 * session, which does not exist in this test's world.
 */
function frozen(view: SessionView): GameSession {
  return {
    getView: () => view,
    subscribe: () => () => {},
    dispatch: () => {},
    undoTo: () => {},
    undoThen: () => {},
    reveal: () => {},
    conceal: () => {},
  };
}

describe('GameScreen with a viewer who is not the actor', () => {
  // `playable()` seats Alex (p1, holding E6 and H8) and Sam (p2, holding A1),
  // with the turn on Alex. Sam is therefore the viewer who must wait.
  function watching() {
    return <GameScreen session={createGameSession({ state: playable() })} viewerId="p2" />;
  }

  it('raises no curtain — there is no device to pass', () => {
    render(watching());
    expect(screen.queryByText(/pass to/i)).toBeNull();
    expect(screen.queryByTestId('curtain')).toBeNull();
  });

  it('shows me my own hand while someone else acts', () => {
    // Online the badges stay always-on: it is your own screen, and the badge
    // is how your tiles are found on the board. The hover-only rule is
    // pass-and-play's alone (owner: "it was meant for pass and play only").
    render(watching());
    expect(onBoard('A1')).toHaveAttribute('data-tile-state', 'hand');
    expect(onBoard('E6')).not.toHaveAttribute('data-tile-state', 'hand');
    expect(onBoard('H8')).not.toHaveAttribute('data-tile-state', 'hand');
  });

  it('says whose turn it is where you cannot miss it, and offers nothing', () => {
    render(watching());

    // The toast carries this, not the panel. It used to be one line of grey
    // inside the active zone, and the first by-hand session reported not being
    // able to tell whose turn it was at all.
    const toast = screen.getByTestId('turn-toast');
    expect(toast).toHaveTextContent(/alex/i);
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });

  it('keeps showing me my own step rather than replacing it', () => {
    render(watching());
    // The panel still says what stage the game is in — the step is not taken
    // away from you just because the move is not yours.
    const active = screen.getByTestId('game-surface').querySelector('[data-slot="active"]')!;
    expect(active.textContent).toMatch(/place a tile/i);
  });

  it('ignores a click on my own tile when it is not my turn', () => {
    render(watching());
    fireEvent.click(onBoard('A1'));
    // Still someone else's turn, and A1 is still mine to play later.
    expect(screen.getByTestId('turn-toast')).toHaveTextContent(/alex/i);
    expect(onBoard('A1')).toBeInTheDocument();
  });

  it('announces your own turn differently from someone else waiting', () => {
    // Someone else up is a standing fact and persists; your turn arriving is
    // an event that announces itself and goes.
    render(<GameScreen session={createGameSession({ state: playable() })} viewerId="p1" />);
    expect(screen.getByTestId('turn-toast')).toHaveAttribute('data-turn', 'mine');
    expect(screen.getByTestId('turn-toast')).toHaveTextContent(/your turn/i);
  });

  it('takes the your-turn announcement away again, but not the other one', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <GameScreen session={createGameSession({ state: playable() })} viewerId="p1" />,
      );
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByTestId('turn-toast'), 'the announcement never left').toBeNull();
      unmount();

      // The watcher's form is a standing fact, so time does not remove it.
      render(<GameScreen session={createGameSession({ state: playable() })} viewerId="p2" />);
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.getByTestId('turn-toast')).toHaveAttribute('data-turn', 'theirs');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no toast at all in pass-and-play', () => {
    // The curtain already announces the handoff, at full-screen size.
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    expect(screen.queryByTestId('turn-toast')).toBeNull();
  });

  it('keeps all five panel slots, so waiting does not resize the panel', () => {
    const { container } = render(watching());
    const slots = [...container.querySelectorAll('[data-slot]')].map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual(['stepstack', 'active', 'staging', 'hand', 'players']);
  });

  it('goes inert while a bag-drawing intent is in flight', () => {
    const session = createGameSession({ state: playable() });
    session.reveal();
    const view = { ...session.getView(), pending: true };
    render(<GameScreen session={frozen(view)} viewerId="p1" />);

    // p1 *is* the actor, but the answer has to come from the server.
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });
});

describe('the back control', () => {
  /**
   * The installed app has no browser chrome, so the game view needed its own
   * way back (owner, from the first real install). It floats in the board
   * margin — the owner's explicit placement: "upper left in margin next to
   * board, not a whole empty row above it" — so it must not add layout.
   */
  it('floats in the margin when onBack is given, and calls it', () => {
    const onBack = vi.fn();
    render(<GameScreen session={createGameSession({ state: playable() })} onBack={onBack} />);

    const back = screen.getByRole('button', { name: /back to the lobby/i });
    // Absolutely positioned: in the margin, not a row of its own.
    expect(back.className).toMatch(/absolute/);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders no back control when the route did not provide one', () => {
    render(<GameScreen session={createGameSession({ state: playable() })} />);
    expect(screen.queryByRole('button', { name: /back to the lobby/i })).toBeNull();
  });
});
