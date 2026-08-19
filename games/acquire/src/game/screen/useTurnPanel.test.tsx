import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useTurnPanel } from './useTurnPanel';
import { createGameSession, type GameSession, type SessionView } from '../../../session/GameSession';
import type { Intent } from '../../../engine/intents';
import { buildFixture } from '../../../engine/golden/fixtures';
import { ALL_GOLDEN_GAMES } from '../../../engine/golden';
import { replayGoldenGame } from '../../../engine/golden/replay';
import type { GameState, Player } from '../../../engine/gameTypes';
import { getEndCondition } from '../../../engine/endGame';
import { getDeadTilesInHand } from '../../../engine/placement';
import { TRADE_RATIO } from '../../../engine/startups';

function sessionFor(state = buildFixture({
  players: [{ name: 'Alex', cash: 6000, hand: ['E6', 'H8'] }, { name: 'Sam', cash: 6000, hand: ['A1'] }],
  loners: ['E5'],
  bag: ['I11', 'I12'],
})) {
  return createGameSession({ state });
}

/**
 * Renders both slots the way `Panel` will, so a test can click a control in
 * one slot and assert on the other — which is the whole reason the hook hands
 * back two nodes instead of one.
 */
function Harness({
  session,
  dispatch,
  canAct = true,
  view,
  viewer,
  onPlaceTile,
}: {
  session: GameSession;
  dispatch: (i: Intent) => void;
  canAct?: boolean;
  /** Overrides `session.getView()` — for shaping a view no real dispatch reaches. */
  view?: SessionView;
  /**
   * Whose hand the panel shows. `GameScreen` resolves this — the actor in
   * pass-and-play, my own seat online — and hands it down; the default here is
   * the pass-and-play rule.
   */
  viewer?: Player;
  /** The board's own placement handler, which the panel's tiles share. */
  onPlaceTile?: (coord: string) => void;
}) {
  const resolved = view ?? session.getView();
  const shown = viewer ?? resolved.state.players.find((p) => p.id === resolved.actorId);
  const { active, staging } = useTurnPanel(resolved, dispatch, canAct, {
    viewer: shown,
    onPlaceTile,
  });
  return <div><div data-slot="active">{active}</div><div data-slot="staging">{staging}</div></div>;
}

describe('useTurnPanel', () => {
  it('asks the current drawer for their own tile, not seat one for everyone else', () => {
    const session = createGameSession({ seed: 'az-1', names: ['Alex', 'Sam'] });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /draw your tile/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'drawTurnOrderTile', playerId: 'p1' });
  });

  it('shows the tiles already drawn, and how many seats are still to come', () => {
    const session = createGameSession({ seed: 'az-1', names: ['Alex', 'Sam', 'Jo'] });
    session.dispatch({ type: 'drawTurnOrderTile', playerId: 'p1' });
    session.reveal();

    render(<Harness session={session} dispatch={() => {}} />);

    // Derived from the state the engine wrote, never hardcoded: the drawn tile
    // is read back rather than asserted as a literal.
    const drawn = session.getView().state.turnOrderDraws![0];
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByTitle(drawn!.tile)).toBeInTheDocument();
    expect(screen.getByText(/2 still to draw/i)).toBeInTheDocument();
  });

  it('prompts for a tile during play', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.getByText(/place a tile/i)).toBeInTheDocument();
  });

  /**
   * The step asks for a tile, so it shows the tiles you have. They are lit on
   * the board too, but the board is the other column — the panel was asking
   * for something it never displayed.
   *
   * Static, not a second set of controls: placement stays on the board, and
   * `Tile` treats `onClick != null` as the whole of its affordance, so passing
   * no handler is what makes these read as a display.
   */
  it('shows the hand it is asking you to play from', () => {
    const { container } = render(<Harness session={sessionFor()} dispatch={() => {}} />);
    const active = container.querySelector('[data-slot="active"]')!;

    for (const coord of ['E6', 'H8']) {
      expect(within(active as HTMLElement).getByTitle(coord)).toBeInTheDocument();
    }
  });

  it('plays a tile tapped here, through the board’s own handler', () => {
    const onPlaceTile = vi.fn();
    const { container } = render(
      <Harness session={sessionFor()} dispatch={() => {}} onPlaceTile={onPlaceTile} />,
    );
    const active = container.querySelector('[data-slot="active"]')!;

    fireEvent.click(within(active as HTMLElement).getByTitle('E6'));
    expect(onPlaceTile).toHaveBeenCalledWith('E6');
  });

  it('offers no tap when the screen supplies no placement handler', () => {
    // `GameScreen` withholds the handler whenever a placement cannot succeed —
    // someone else's turn, mid-buy, a dropped socket. The panel must go inert
    // with it, or it offers a click whose only outcome is an error message.
    const { container } = render(<Harness session={sessionFor()} dispatch={() => {}} />);
    const active = container.querySelector('[data-slot="active"]')!;
    expect(active.querySelectorAll('button[title]')).toHaveLength(0);
  });

  it('marks a dead tile in the panel as blocked, not merely present', () => {
    // A tile that would join two safe chains can never be played. The board
    // greys it; the panel must not show it as an ordinary holding.
    const g8 = ALL_GOLDEN_GAMES.find((game) => game.id === 'G8');
    if (!g8) throw new Error('no golden game G8');
    const states = replayGoldenGame(g8);
    const state = states.find(
      (s) => s.stage === 'play' && getDeadTilesInHand(s, s.players[s.turnIndex]!.id).length > 0,
    );
    if (!state) throw new Error('G8 no longer reaches a dead tile in hand');

    const dead = getDeadTilesInHand(state, state.players[state.turnIndex]!.id)[0];
    const { container } = render(
      <Harness session={createGameSession({ state })} dispatch={() => {}} />,
    );

    const tile = container.querySelector(`[data-slot="active"] [title="${dead}"]`)!;
    expect(tile.getAttribute('data-tile-state')).toBe('blocked');
  });

  /**
   * Online, a watcher's projected state has the actor's hand blanked — so
   * reading `state.players[actorId].hand` renders an empty row for everyone
   * who is not up. The panel shows the *viewer's* hand, which is the seat this
   * device holds, whoever is acting.
   */
  it("shows my own hand while someone else is placing", () => {
    const session = sessionFor();
    const view = session.getView();
    const watcher = view.state.players[1];
    const { container } = render(
      <Harness session={session} dispatch={() => {}} canAct={false} viewer={watcher} />,
    );

    const active = container.querySelector('[data-slot="active"]')!;
    expect(within(active as HTMLElement).getByTitle('A1')).toBeInTheDocument();
    // The actor's tiles are not on show in my panel.
    expect(active.querySelector('[title="E6"]')).toBeNull();
  });

  it('shows a rejection even while it is not my turn', () => {
    // Online, a rejection can arrive addressed to a non-actor (a dropped
    // connection, or a stale request the server answers after the actor
    // moved on) — every other stage renders `problem`; the `!canAct` branch
    // used not to.
    const session = sessionFor();
    const view: SessionView = {
      ...session.getView(),
      error: { code: 'notConnected', message: 'not your turn pal' },
    };
    render(<Harness session={session} dispatch={() => {}} canAct={false} view={view} />);
    expect(screen.getByText(/not your turn pal/i)).toBeInTheDocument();
  });

  it('always renders the staging slot, so the panel cannot resize between stages', () => {
    const { container } = render(<Harness session={sessionFor()} dispatch={() => {}} />);
    const staging = container.querySelector('[data-slot="staging"]')!;
    // Empty at `play`, but present and holding its reservation.
    expect(staging.querySelector('[data-zone="staging"]')).not.toBeNull();
  });

  it('offers the founding brands, priced for the resulting chain', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    expect(screen.getByText(/found a startup/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /messla/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'chooseFoundingBrand',
      playerId: 'p1',
      startupId: 'Messla',
    });
  });

  it('sizes the founding groups from the chain that will exist', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    render(<Harness session={session} dispatch={() => {}} />);
    // E6 placed beside the E5 loner: the founded chain will be 2 tiles.
    expect(screen.getByText(/\$200/)).toBeInTheDocument();
  });

  it('surfaces a rejected intent instead of swallowing it', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p2', coord: 'A1' });
    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/turn/i);
  });
});

describe('useTurnPanel — buying', () => {
  function atBuy() {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });
    return session;
  }

  /**
   * Early game: a tile placed on its own founds nothing, so the buy step opens
   * with no brand in existence and used to render a heading over an empty row.
   */
  it('says what to do when nothing has been founded', () => {
    const session = sessionFor(buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['H8'] }, { name: 'Sam', cash: 6000, hand: ['A1'] }],
      bag: ['I11', 'I12'],
    }));
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'H8' });
    expect(session.getView().state.stage, 'the placement did not reach the buy step').toBe('buy');

    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.getByText(/found a startup to buy shares/i)).toBeInTheDocument();
  });

  /**
   * The empty state is about nothing being *founded*, which stopped meaning
   * "nothing to buy" the moment sold-out brands started staying in the row.
   */
  it('shows sold-out cards rather than the empty state', () => {
    const session = atBuy();
    const state = structuredClone(session.getView().state);
    state.startups.Messla!.availableShares = 0;

    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);
    expect(screen.queryByText(/found a startup to buy shares/i)).toBeNull();
    expect(screen.getByRole('button', { name: /messla — sold out/i })).toBeInTheDocument();
  });

  /**
   * Three shares a turn is otherwise a rule you discover by hitting it — the
   * cards just stop responding. Counted from what the turn has already
   * committed *plus* what is staged: a player who bought one and staged
   * another is at two, and a test that only stages would pass while ignoring
   * the committed half.
   */
  it('shows how much of the buy limit is spent', () => {
    const session = atBuy();
    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.getByText(/buy shares \(0\/3\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    expect(screen.getByText(/buy shares \(1\/3\)/i)).toBeInTheDocument();
  });

  it('counts what the turn already committed, not just what is staged', () => {
    const session = atBuy();
    session.dispatch({ type: 'buyShares', playerId: 'p1', picks: ['Messla'] });
    render(<Harness session={session} dispatch={() => {}} />);

    expect(screen.getByText(/buy shares \(1\/3\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    expect(screen.getByText(/buy shares \(2\/3\)/i)).toBeInTheDocument();
  });

  it('stages picks locally without dispatching', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows the staged basket and its cost in the staging slot', () => {
    const { container } = render(<Harness session={atBuy()} dispatch={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));

    const staging = container.querySelector('[data-slot="staging"]')!;
    expect(staging.textContent).toMatch(/200/);
  });

  it('sends the whole basket as one intent on confirm', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm purchase/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'buyShares',
      playerId: 'p1',
      picks: ['Messla', 'Messla'],
    });
  });

  /**
   * The pile is not a receipt. A share put there by mistake comes back out —
   * `StockStack` has carried the `×` affordance since the atom was built and
   * the catalog has shown it as `stack · sm · removable`; the panel simply
   * never passed a handler, so the state was unreachable.
   */
  it('takes a staged share back out of the pile', () => {
    const { container } = render(<Harness session={atBuy()} dispatch={() => {}} />);
    const buy = screen.getByRole('button', { name: /buy one messla/i });
    fireEvent.click(buy);
    fireEvent.click(buy);

    const staging = container.querySelector('[data-slot="staging"]')!;
    expect(staging.textContent).toMatch(/×2/);

    const remove = within(staging as HTMLElement).getByRole('button', { name: /remove one/i });
    fireEvent.click(remove);

    expect(staging.textContent).toMatch(/×1/);
    // And the money comes back with it.
    expect(staging.textContent).toMatch(/200/);
    expect(staging.textContent).not.toMatch(/400/);
  });

  it('stops at three shares a turn', () => {
    render(<Harness session={atBuy()} dispatch={() => {}} />);
    const buy = screen.getByRole('button', { name: /buy one messla/i });
    fireEvent.click(buy);
    fireEvent.click(buy);
    fireEvent.click(buy);
    expect(buy).toBeDisabled();
  });

  /**
   * Ending without buying is one press from a mistake that cannot be undone —
   * `endTurn` closes the segment, which is the undo floor. Found by hand
   * (owner, 2026-08-07): "it's easy to press continue without buying, and
   * too late to undo." So an empty basket asks the player to *say* they are
   * passing before End turn arms, the same way staging a share arms it.
   */
  it('will not end the turn over an empty basket until the player passes', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);

    const endTurn = screen.getByRole('button', { name: /^end turn$/i });
    expect(endTurn).toBeDisabled();

    fireEvent.click(endTurn);
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^pass$/i }));
    expect(endTurn).toBeEnabled();

    fireEvent.click(endTurn);
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });

  it('starts with Pass already pressed when there is nothing to buy', () => {
    // One founded chain, sold out — every path to a purchase is closed, so
    // making the player press Pass would be asking them to confirm an
    // omission they had no way to avoid.
    const nothingToBuy = buildFixture({
      stage: 'buy',
      players: [
        { name: 'Alex', cash: 6000, hand: ['H8'], shares: { Messla: 13 } },
        { name: 'Sam', cash: 6000, hand: ['A1'], shares: { Messla: 12 } },
      ],
      chains: [{ id: 'Messla', coords: ['E5', 'E6'] }],
      bag: ['I11', 'I12'],
    });
    expect(nothingToBuy.startups.Messla!.availableShares, 'fixture not sold out').toBe(0);
    const dispatch = vi.fn();

    render(<Harness session={createGameSession({ state: nothingToBuy })} dispatch={dispatch} />);

    expect(screen.getByRole('button', { name: /^pass$/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^end turn$/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });

  it('swaps the pass pair for Confirm purchase once a share is staged', () => {
    render(<Harness session={atBuy()} dispatch={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));

    // Staging a share arms the turn-ending press by itself; the pass
    // question no longer applies and its buttons leave.
    expect(screen.getByRole('button', { name: /confirm purchase/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^pass$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^end turn$/i })).toBeNull();
  });

  /**
   * Sold out is information — it is how you know the brand is locked and what
   * the other players have been doing with their money. Dropping the card
   * destroys it, and the row silently gets shorter with nothing to say why.
   */
  it('keeps a sold-out brand in the row, inert', () => {
    const soldOut = buildFixture({
      stage: 'buy',
      players: [
        { name: 'Alex', cash: 6000, hand: ['H8'], shares: { Messla: 13 } },
        { name: 'Sam', cash: 6000, hand: ['A1'], shares: { Messla: 12 } },
      ],
      chains: [
        { id: 'Messla', coords: ['E5', 'E6'] },
        { id: 'Gobble', coords: ['B2', 'B3'] },
      ],
      bag: ['I11', 'I12'],
    });
    expect(
      soldOut.startups.Messla!.availableShares,
      'the fixture did not actually sell Messla out',
    ).toBe(0);

    render(<Harness session={createGameSession({ state: soldOut })} dispatch={() => {}} />);

    const messla = screen.getByRole('button', { name: /messla/i });
    expect(messla).toBeDisabled();
    // The name says it in full; the card wears the short form.
    expect(messla).toHaveAccessibleName(/sold out/i);
    expect(messla).toHaveTextContent(/sold/i);
    // The brand with shares left is unaffected.
    expect(screen.getByRole('button', { name: /buy one gobble/i })).toBeEnabled();
  });

  it('buys and ends the turn in one press', () => {
    const dispatch = vi.fn();
    render(<Harness session={atBuy()} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: /buy one messla/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm purchase/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'buyShares', playerId: 'p1', picks: ['Messla'],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });
});

describe('useTurnPanel — mergers', () => {
  function stateWhere(predicate: (s: GameState) => boolean, id?: string): GameState {
    const games = id ? ALL_GOLDEN_GAMES.filter((g) => g.id === id) : ALL_GOLDEN_GAMES;
    for (const game of games) {
      const found = replayGoldenGame(game).find(predicate);
      if (found) return found;
    }
    throw new Error('no golden game reaches that state');
  }

  /**
   * A queue works through several holders one at a time. "Liquidate shares"
   * says neither which chain is being sorted nor whose turn it is — and online
   * that leaves a watcher looking at a liquidation step with no sign that it
   * is not theirs.
   */
  it('names the chain being sorted and the shareholder sorting it', () => {
    const state = stateWhere((s) => s.stage === 'mergerLiquidation');
    const ctx = state.mergerContext!;
    const absorbed = ctx.absorbedIds[ctx.currentLiquidationIndex];
    const holder = state.players.find((p) => p.id === ctx.shareholderQueue[ctx.currentShareholderIndex])!;

    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);
    // Both facts in the one label — the name alone matches the queue below it
    // too, which would pass without the label saying anything.
    expect(
      screen.getByText(new RegExp(`liquidate ${absorbed}.*${holder.name}`, 'i')),
    ).toBeInTheDocument();
  });

  it('renders the liquidation queue and the acting shareholder', () => {
    const session = createGameSession({ state: stateWhere((s) => s.stage === 'mergerLiquidation') });
    render(<Harness session={session} dispatch={() => {}} />);

    expect(screen.getByText(/liquidate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sell one share/i })).toBeInTheDocument();
  });

  /**
   * Found by hand on 2026-08-07, driving G2 in two browsers: the trade button
   * greyed out after one click and nothing said why. The reason is that
   * G2 leaves Messla with a single available share, so one trade empties the
   * pool — but an inert button and an empty pool looked identical.
   *
   * Derived from the golden state rather than asserted against a typed-in
   * number: the precondition below is checked, so if G2's share arithmetic
   * ever changes this test fails loudly instead of quietly proving nothing.
   */
  it('says the survivor is sold out once a staged trade empties the pool', () => {
    const state = stateWhere((s) => s.stage === 'mergerLiquidation', 'G2');
    const survivorId = state.mergerContext!.survivorId;

    // The whole point of the case: exactly one share to be had.
    expect(state.startups[survivorId as 'Messla']!.availableShares).toBe(1);

    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);

    // Before: a trade is on offer and nothing claims the pool is empty.
    expect(screen.queryByText('sold')).not.toBeInTheDocument();
    const trade = screen.getByRole('button', { name: /trade .* shares/i });
    expect(trade).toBeEnabled();

    fireEvent.click(trade);

    // After: the one share is spoken for, and the panel says so in the buy
    // step's own words rather than going silently inert.
    expect(screen.getByRole('button', { name: new RegExp(`${survivorId} — sold out`, 'i') }))
      .toBeDisabled();
    expect(screen.getByText('sold')).toBeInTheDocument();
  });

  it('puts the survivor shares a trade gains into the staging pile', () => {
    // A state where the acting shareholder can actually afford a trade —
    // holding fewer than TRADE_RATIO absorbed shares leaves the button
    // disabled and the test asserting nothing.
    const state = stateWhere((s) => {
      if (s.stage !== 'mergerLiquidation') return false;
      const ctx = s.mergerContext;
      if (!ctx) return false;
      const absorbed = ctx.absorbedIds[ctx.currentLiquidationIndex];
      const holder = ctx.shareholderQueue[ctx.currentShareholderIndex];
      const player = s.players.find((p) => p.id === holder);
      return (player?.portfolio[absorbed!] ?? 0) >= TRADE_RATIO;
    });

    const survivorId = state.mergerContext!.survivorId;
    const { container } = render(
      <Harness session={createGameSession({ state })} dispatch={() => {}} />,
    );
    const staging = () => container.querySelector('[data-slot="staging"]') as HTMLElement;

    // Nothing traded yet, so nothing of the survivor is in the pile.
    expect(within(staging()).queryAllByTitle(survivorId)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /trade/i }));

    // The pile showed only what you were giving up; what you get back for it
    // was left to arithmetic.
    expect(
      within(staging()).queryAllByTitle(survivorId).length,
      'the survivor shares gained are missing from the pile',
    ).toBeGreaterThan(0);
  });

  /**
   * The same rule as the buy pile: what you staged, you can take back. A sale
   * is otherwise invisible in the pile — it shows up only as a number in
   * `Net` — so the one staged decision in this step had nothing to click.
   */
  it('takes a staged sale back out of the pile', () => {
    const session = createGameSession({
      state: stateWhere((s) => s.stage === 'mergerLiquidation'),
    });
    const { container } = render(<Harness session={session} dispatch={() => {}} />);
    const staging = () => container.querySelector('[data-slot="staging"]')! as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: /sell one share/i }));
    const removes = within(staging()).getAllByRole('button', { name: /remove one/i });
    expect(removes).toHaveLength(1);

    fireEvent.click(removes[0]!);
    expect(within(staging()).queryByRole('button', { name: /remove one/i })).toBeNull();
  });

  it('accumulates a sale locally, then dispatches one liquidate intent', () => {
    const state = stateWhere((s) => s.stage === 'mergerLiquidation');
    const session = createGameSession({ state });
    const view = session.getView();
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /sell one share/i }));
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    const call = dispatch.mock.calls[0]![0];

    expect(call.type).toBe('liquidate');
    expect(call.playerId).toBe(view.actorId);
    expect(call.sell).toBe(1);

    const ctx = view.state.mergerContext!;
    const absorbedId = ctx.absorbedIds[ctx.currentLiquidationIndex];
    const held = view.state.players.find((p) => p.id === view.actorId)!.portfolio[absorbedId!] ?? 0;
    expect(call.sell + call.trade + call.keep).toBe(held);
  });

  it('offers a survivor choice when two chains tie', () => {
    const tied = stateWhere((s) => s.stage === 'chooseSurvivor');
    const session = createGameSession({ state: tied });
    const dispatch = vi.fn();
    render(<Harness session={session} dispatch={dispatch} />);

    expect(screen.getByText(/which chain survives/i)).toBeInTheDocument();
    const choice = tied.pendingTiedStartups![0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${choice}$`, 'i') }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chooseSurvivor', startupId: choice }),
    );
  });
});

describe('useTurnPanel — a player who cannot move', () => {
  /**
   * Two safe chains with a one-cell gap between them. The only tile in hand
   * joins them, which is permanently illegal, so this player cannot place —
   * and the rules let them pass.
   */
  function stuck() {
    return buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
    });
  }

  it('offers to end the turn when no placement is legal', () => {
    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: stuck() })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /end turn/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'endTurn', playerId: 'p1' });
  });

  it('says which tile is the dead one rather than narrating the situation', () => {
    render(<Harness session={createGameSession({ state: stuck() })} dispatch={() => {}} />);

    // The panel no longer explains that you cannot move — the board shows
    // that, and the End turn button offers the way out. What it still owes
    // you is *why* a tile you are holding can never be played, which is not
    // visible from the board alone.
    expect(screen.queryByText(/no tile you hold can be played/i)).toBeNull();
    expect(screen.getByText(/can never be played/i)).toBeInTheDocument();
    // Anchored to the sentence: the panel now also shows C1 as a tile.
    expect(screen.getByText(/C1 can never be played/i)).toBeInTheDocument();
  });

  it('offers no such button while a placement is still legal', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /end turn/i })).toBeNull();
  });
});

describe('useTurnPanel — dead tiles', () => {
  /**
   * Two safe chains with a gap at C1. `C1` in hand is dead; `H8` is fine.
   * The player is therefore not stuck — which is the point: the trade-in has
   * to be on offer independently of the pass.
   */
  function holdingDeadTile() {
    return buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1', 'H8'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
      bag: ['I11', 'I12'],
    });
  }

  it('offers to trade every dead tile at once', () => {
    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: holdingDeadTile() })} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: /trade in 1 dead tile/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'tradeInDeadTiles',
      playerId: 'p1',
      coords: ['C1'],
    });
  });

  it('names the dead tiles so the player can see which they are', () => {
    render(<Harness session={createGameSession({ state: holdingDeadTile() })} dispatch={() => {}} />);
    // Anchored to the sentence: the panel now also shows C1 as a tile.
    expect(screen.getByText(/C1 can never be played/i)).toBeInTheDocument();
  });

  it('offers nothing when no tile in hand is dead', () => {
    render(<Harness session={sessionFor()} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /trade in/i })).toBeNull();
  });

  it('offers the trade alongside the pass, not instead of it', () => {
    // Every tile dead: the player is stuck *and* holds dead tiles, so both
    // affordances must be present — trading may hand them a playable tile.
    const state = buildFixture({
      players: [{ name: 'Alex', cash: 6000, hand: ['C1'] }, { name: 'Sam', cash: 6000 }],
      chains: [
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'] },
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11'] },
      ],
      bag: ['I11'],
    });
    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);

    expect(screen.getByRole('button', { name: /trade in 1 dead tile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end turn/i })).toBeInTheDocument();
  });
});

describe('useTurnPanel — declaring the end', () => {
  it('offers the end during buy when a chain has reached 41 tiles', () => {
    const g9 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G9')!;
    const states = replayGoldenGame(g9);
    const atBuy = states.find((s) => s.stage === 'buy');
    if (!atBuy) throw new Error('G9 no longer passes through buy');

    const dispatch = vi.fn();
    render(<Harness session={createGameSession({ state: atBuy })} dispatch={dispatch} />);

    expect(screen.getByText(/reached 41 tiles/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /end the game/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'declareEnd', playerId: 'p1' });
  });

  it('offers the end when every founded chain is safe', () => {
    const g10 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G10')!;
    const state = replayGoldenGame(g10)[0]!;

    render(<Harness session={createGameSession({ state })} dispatch={() => {}} />);
    expect(screen.getByText(/every founded startup is safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end the game/i })).toBeInTheDocument();
  });

  it('un-latches when a chain that was safe becomes unsafe again', () => {
    // "Every founded chain is safe" is derived every render, not remembered:
    // a merger can knock a chain below SAFE_SIZE, and the offer to end the
    // game must go away with it. G10's setup gives the met side (both chains
    // safe); the unmet side needs a fixture of its own — G10 alone never
    // exercises a state where the condition stops holding.
    const g10 = ALL_GOLDEN_GAMES.find((g) => g.id === 'G10')!;
    const met = replayGoldenGame(g10)[0]!;

    const unmet = buildFixture({
      players: [
        { name: 'Alex', cash: 1000, hand: ['H8'] },
        { name: 'Sam', cash: 2000 },
      ],
      chains: [
        // Still 12 tiles, still safe on its own.
        { id: 'Messla', coords: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12'] },
        // Only 5 tiles — below SAFE_SIZE (11) — so not every founded chain
        // is safe, and nothing has reached END_SIZE (41) either.
        { id: 'ZuckFace', coords: ['D1', 'D2', 'D3', 'D4', 'D5'] },
      ],
      stage: 'buy',
    });

    // Prove the two fixtures actually differ in `.met` before trusting
    // anything rendered from them.
    expect(getEndCondition(met).met).toBe(true);
    expect(getEndCondition(unmet).met).toBe(false);

    const { rerender } = render(
      <Harness session={createGameSession({ state: met })} dispatch={() => {}} />,
    );
    expect(screen.getByText(/every founded startup is safe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end the game/i })).toBeInTheDocument();

    rerender(<Harness session={createGameSession({ state: unmet })} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /end the game/i })).toBeNull();
  });

  it('offers nothing while no end condition holds', () => {
    const session = sessionFor();
    session.dispatch({ type: 'placeTile', playerId: 'p1', coord: 'E6' });
    session.dispatch({ type: 'chooseFoundingBrand', playerId: 'p1', startupId: 'Messla' });

    render(<Harness session={session} dispatch={() => {}} />);
    expect(screen.queryByRole('button', { name: /end the game/i })).toBeNull();
  });
});
