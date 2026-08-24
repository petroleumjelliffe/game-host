import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { nodeForCity } from '../../engine';
import { layout } from './geo';
import { MapView } from './MapView';
import { useRoute } from './useRoute';
import { replay } from '../state/game';
import type { GameEvent } from '../state/events';

const MINNEAPOLIS = 43;
const ST_PAUL = 47;
const CHICAGO = 20;

const join: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'blue', name: 'MARGO' },
  { type: 'started' }
];

/** Everything the map needs that these tests are not about. */
const inert = {
  onMove: () => {},
  dice: { roll: null, live: false, mine: false },
  onRollDice: () => {},
  onDiceLanded: () => {}
};

const show = (events: GameEvent[], onBack = () => {}) =>
  render(<MapView state={replay(events)} onBack={onBack} {...inert} />);

/**
 * Each lamp's <title> is its tooltip and what a screen reader announces.
 * Read directly rather than through getByTitle, which only matches a <title>
 * that is an immediate child of the <svg> — these belong to their own lamp.
 */
const titles = (container: HTMLElement) =>
  [...container.querySelectorAll('title')].map(t => t.textContent);

describe('the map', () => {
  it('draws a lamp for every city and route dot', () => {
    // The shipped board names cities and nothing else. Developing, it also
    // names every node — see the dev labels below — so this asks for the
    // board as it ships.
    vi.stubEnv('DEV', false);
    const { container } = show(join);
    // Cities carry a <title>; route dots do not, which is how they are told
    // apart without reaching for internals.
    expect(container.querySelectorAll('title')).toHaveLength(67);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  /**
   * Reporting a mis-traced node means naming it, and the board shows no ids —
   * "the dot closest to Chattanooga" took a round trip to resolve. So while
   * developing, every lamp says what it is on hover.
   *
   * It cannot ride on the lamps themselves: every circle they draw carries
   * `pointerEvents: 'none'`, so nothing there is hoverable and a `<title>` on
   * a lamp never appears. Hence a layer of its own — under the interaction
   * layer, so it can never take a tap meant for a route.
   */
  describe('naming the nodes while developing', () => {
    it('names a route dot by its id', () => {
      const { container } = show(join);
      const labels = [...container.querySelectorAll('[data-labels] title')]
        .map(t => t.textContent);
      // d309, on the Southern between the Chattanooga fork and Atlanta.
      expect(labels).toContain('d309');
      // And nothing for a junction: it draws no lamp, so there is no bulb to
      // hover and a label there would sit on bare track.
      expect(labels).not.toContain('d893');
    });

    it('names a city by name and id', () => {
      const { container } = show(join);
      const labels = [...container.querySelectorAll('[data-labels] title')]
        .map(t => t.textContent);
      expect(labels).toContain('Chicago (c24)');
    });

    it('says none of it in a production build', () => {
      vi.stubEnv('DEV', false);
      const { container } = show(join);
      expect(container.querySelector('[data-labels]')).toBeNull();
      vi.unstubAllEnvs();
    });

    it('keeps its hands off the taps', () => {
      // Rendered before the interaction layer, so a candidate's real target
      // still sits on top of it — the rule the whole SVG is ordered by.
      const { container } = show(join);
      const svg = container.querySelector('svg')!;
      const children = [...svg.children];
      const labels = children.findIndex(el => el.hasAttribute('data-labels'));
      const taps = children.length - 1;
      expect(labels).toBeGreaterThan(-1);
      expect(labels).toBeLessThan(taps);
    });
  });

  it('says whose destination a lit city is', () => {
    const { container } = show([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 }]);
    expect(titles(container)).toContain("Chicago — ADA's destination");
  });

  it('says which city a baron set out from', () => {
    const { container } = show([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'arrived', seat: 'red', city: 39, region: 'PL', payout: 9000 }]);
    expect(titles(container)).toContain("Chicago — ADA's origin");
    expect(titles(container)).toContain("Denver — ADA's destination");
  });

  it('leaves an untouched city named but unclaimed', () => {
    const { container } = show(join);
    expect(titles(container)).toContain('Chicago');
  });

  it('shows a zero-paying journey as $0, not as a home town', () => {
    // Minneapolis to St. Paul is a real, legal, zero-paying leg. `payout ||`
    // anywhere on this path would print HOME instead.
    show([...join,
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 3000 },
      { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 }]);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('says HOME when no payout applies', () => {
    show([...join,
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: null }]);
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('lists only the barons who have rolled', () => {
    show([...join, { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 }]);
    expect(screen.getByText('Chicago')).toBeInTheDocument();
    expect(screen.getByText('$4,500')).toBeInTheDocument();
  });

  it('goes back when asked', async () => {
    const onBack = vi.fn();
    show(join, onBack);
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('playing a turn on the map', () => {
  /** Red is up, standing in Minneapolis and bound for St. Paul next door. */
  const midTurn: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
  ];

  const play = (onMove = vi.fn()) => {
    render(
      <MapView
        state={replay(midTurn)}
        onBack={() => {}}
        onMove={onMove}
        dice={{ roll: null, live: false, mine: false }}
        onRollDice={() => {}}
        onDiceLanded={() => {}}
      />
    );
    return onMove;
  };

  it('will not commit before a route has been tapped out', () => {
    play();
    expect(screen.getByRole('button', { name: 'COMMIT' })).toBeDisabled();
  });

  it('commits the tapped route as one leg', async () => {
    const user = userEvent.setup();
    const onMove = play();
    await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
    await user.click(screen.getByRole('button', { name: 'COMMIT' }));
    expect(onMove).toHaveBeenCalledWith(
      'red', [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], true);
  });

  it('takes the last step back on undo', async () => {
    const user = userEvent.setup();
    play();
    await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
    expect(screen.getByRole('button', { name: 'COMMIT' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'UNDO' }));
    expect(screen.getByRole('button', { name: 'COMMIT' })).toBeDisabled();
  });

  it('announces only the lamps that may be tapped', () => {
    play();
    // Chicago is nowhere near this leg and must not claim to be a control.
    expect(screen.queryByRole('button', { name: 'Chicago' })).not.toBeInTheDocument();
  });

  it('shows a pawn where the baron stands', () => {
    play();
    expect(screen.getAllByLabelText('ADA').length).toBeGreaterThan(0);
  });

  /**
   * Portland, OR — d432 — d393, an edge carrying both the GN and the UP, so
   * crossing it once on each line is a legal there-and-back and the route
   * arrives at d432 twice. 33 edges permit that, and the network has around
   * 161 independent cycles, so a route that revisits a node is ordinary play.
   */
  it('draws every segment of a route that doubles back on itself', async () => {
    // React only *warns* about duplicate keys and may still render both
    // children, so counting segments does not on its own catch this — the
    // damage is to reconciliation on later updates, which is undefined
    // behaviour rather than a reliable symptom. The warning is the signal
    // that discriminates, so it is asserted alongside what the player sees.
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { container } = render(
      <MapView
        state={replay([
          { type: 'joined', seat: 'red', name: 'ADA' },
          { type: 'started' },
          { type: 'arrived', seat: 'red', city: 52, region: 'NW', payout: null },
          { type: 'orderRolled', seat: 'red', first: 'red' },
          { type: 'arrived', seat: 'red', city: 55, region: 'NW', payout: 3000 },
          { type: 'turnRolled', seat: 'red', white: [2, 2], bonus: null }
        ])}
        onBack={() => {}}
        onMove={vi.fn()}
        dice={{ roll: null, live: false, mine: false }}
        onRollDice={() => {}}
        onDiceLanded={() => {}}
      />
    );

    // One group per traveled segment — each holds the two-weight pair.
    const segments = () => container.querySelectorAll('[data-route="draft"] > g');
    await user.click(screen.getByRole('button', { name: 'Dot d432' }));
    await user.click(screen.getByRole('button', { name: 'Dot d393' }));
    await user.click(screen.getByRole('button', { name: 'Dot d432' }));

    // Three steps walked, so three segments drawn...
    expect(segments()).toHaveLength(3);
    // ...each of them its own child. Keying by node id collides on the
    // repeated d432, and React is explicit that two children sharing a key
    // no longer keep their identity across updates.
    const keyed = complaints.mock.calls
      .map(call => String(call[0]))
      .filter(message => message.includes('same key'));
    expect(keyed).toEqual([]);
    complaints.mockRestore();
  });

  it('will not take a tap while the last move is still playing back', () => {
    const onMove = vi.fn();
    // A Bonus Roll turn: the primary leg lands within the white dice with a
    // bonus die still owed, so the turn stays open — a new destination is
    // rolled, and the bonus leg (Minneapolis, one hop away) becomes a real,
    // tappable candidate. Without the guard, `route.legal` genuinely holds
    // it; this is the scenario the guard exists for, not one where there is
    // nothing to tap regardless.
    const played: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'red', path: [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], arrived: true },
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 3000 }
    ];
    render(
      <MapView
        state={replay(played)}
        onBack={() => {}}
        onMove={onMove}
        dice={{ roll: null, live: false, mine: false }}
        onRollDice={() => {}}
        onDiceLanded={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Minneapolis/ })).not.toBeInTheDocument();
  });

  /**
   * The bonus leg used to strand the player here. A pawn that arrives inside
   * the white dice is paid and owes a new destination before the bonus die can
   * be spent — so the map had nothing tappable, dice that were not live, UNDO
   * and COMMIT greyed out, and a "0 left" readout that named none of it.
   *
   * The destination is rolled on the board, behind the region panel and the
   * own-region ballot, so the honest fix is to say so and point at it.
   */
  describe('when the baron up owes a destination roll', () => {
    /** Arrived inside the white dice, bonus die still owed, no new destination. */
    const bonusLegOwed: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'red',
        path: [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], arrived: true }
    ];

    const shown = (events: GameEvent[], onBack = vi.fn()) => {
      render(
        <MapView
          state={replay(events)}
          onBack={onBack}
          onMove={vi.fn()}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      return onBack;
    };

    it('says what the game is waiting for, and offers the way to it', async () => {
      const user = userEvent.setup();
      const onBack = shown(bonusLegOwed);
      expect(screen.getByText(/roll a new destination/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /to the board/i }));
      expect(onBack).toHaveBeenCalledOnce();
    });

    it('offers no lamp and no move controls while it waits', () => {
      shown(bonusLegOwed);
      // The route controls would be a lie: there is no destination to route to.
      expect(screen.queryByRole('button', { name: 'COMMIT' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'UNDO' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/\d+ left/)).not.toBeInTheDocument();
      // Nothing is offered, and not because the screen suppresses it: the
      // draft runs from where the pawn stands to where it stands, and the
      // engine refuses every step out of it with `already-arrived`.
      expect(screen.queryByRole('button', { name: /Minneapolis/ })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Dot / })).toEqual([]);
    });

    it('says none of it mid-leg, when there is a route to walk', () => {
      shown(midTurn);
      expect(screen.queryByText(/roll a new destination/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /to the board/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'COMMIT' })).toBeInTheDocument();
      expect(screen.getByLabelText('2 left')).toBeInTheDocument();
    });
  });

  /**
   * The sibling state, and the other way this screen used to read as stranded.
   *
   * A white leg that stops in open country on an entitled turn leaves the turn
   * open — "if entitled, he must take it" — with no movement to spend until
   * the die is thrown. Unlike the destination above, the roll that clears it
   * is on this screen already: the dice readout the map renders. So the HUD
   * names what is owed and leaves the dice to take it.
   */
  describe('when the baron up owes the Bonus Roll', () => {
    /** Double six walked without arriving: entitled, and the die still in the cup. */
    const bonusOwed: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(MINNEAPOLIS), 'd66'], arrived: false }
    ];

    const shown = (events: GameEvent[], live = true) =>
      render(
        <MapView
          state={replay(events)}
          onBack={vi.fn()}
          onMove={vi.fn()}
          dice={{ roll: { white: [6, 6], bonus: null }, live, mine: live }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );

    it('says the Bonus Roll is what it is waiting for', () => {
      shown(bonusOwed);
      expect(screen.getByText(/bonus roll/i)).toBeInTheDocument();
      // Not the move controls: the leg has no movement until the die lands,
      // and "0 left" over a greyed COMMIT is the stranding this replaced.
      expect(screen.queryByRole('button', { name: 'COMMIT' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/0 left/)).not.toBeInTheDocument();
      // And not the destination cluster either — nothing was arrived at.
      expect(screen.queryByText(/roll a new destination/i)).not.toBeInTheDocument();
    });

    it('leaves the dice on this screen to take it', async () => {
      const onRollDice = vi.fn();
      const user = userEvent.setup();
      render(
        <MapView
          state={replay(bonusOwed)}
          onBack={vi.fn()}
          onMove={vi.fn()}
          dice={{ roll: { white: [6, 6], bonus: null }, live: true, mine: true }}
          onRollDice={onRollDice}
          onDiceLanded={() => {}}
        />
      );
      await user.click(screen.getByRole('button', { name: /roll the dice/i }));
      expect(onRollDice).toHaveBeenCalledOnce();
    });

    it('puts the destination first when the white leg arrived', () => {
      // Both owed at once. The book's order is destination, then the die, so
      // the destination cluster is what shows — one HUD, not two stacked.
      const arrivedFirst: GameEvent[] = [...bonusOwed.slice(0, -1),
        { type: 'moved', seat: 'red',
          path: [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], arrived: true }];
      shown(arrivedFirst, false);
      expect(screen.getByText(/roll a new destination/i)).toBeInTheDocument();
      expect(screen.queryByText(/bonus roll/i)).not.toBeInTheDocument();
    });

    it('offers no lamp at all, not even the free step across a twin pair', async () => {
      // The one step a zero-movement leg can afford. The pawn is in
      // Minneapolis and St. Paul is its twin: "each pair of twin cities count
      // as one dot for the pair", so crossing costs nothing and the engine
      // offers it however little movement is left. With COMMIT and UNDO hidden
      // while the die is owed, tapping it drew a route line the player could
      // neither finish nor take back.
      const onTwin: GameEvent[] = [
        { type: 'joined', seat: 'red', name: 'ADA' },
        { type: 'started' },
        { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: null },
        { type: 'orderRolled', seat: 'red', first: 'red' },
        { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: 0 },
        { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
        { type: 'moved', seat: 'red',
          path: [nodeForCity(ST_PAUL), nodeForCity(MINNEAPOLIS)], arrived: true },
        // Arrived, so a new destination first — St. Paul again, back across
        // the pair — and only then is the Bonus Roll due.
        { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 }
      ];
      const state = replay(onTwin);
      expect(state.bonusOwed, 'the die is genuinely owed here').toBe(true);
      // Not a screen that suppresses something the engine never offered: with
      // no movement at all, the engine still holds the free crossing legal.
      const { result } = renderHook(() => useRoute(state, vi.fn()));
      expect(result.current.remaining).toBe(0);
      expect(result.current.legal.has(nodeForCity(ST_PAUL)),
             'the engine offers the twin step at zero movement').toBe(true);

      const user = userEvent.setup();
      const draw = (events: GameEvent[]) => render(
        <MapView
          state={replay(events)}
          onBack={vi.fn()}
          onMove={vi.fn()}
          dice={{ roll: { white: [6, 6], bonus: null }, live: true, mine: true }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      /**
       * The white leg is still playing back at first paint, and the layer is
       * closed for *that* reason too — so an assertion made without finishing
       * it passes whatever the Bonus Roll gate does. A tap on the cabinet
       * skips to the end. (Found the hard way: the first version of this test
       * stayed green with the gate deleted.)
       */
      const skipPlayback = async (container: HTMLElement) => {
        await user.click(container.querySelector('svg')!.parentElement!);
      };

      // The control, and what makes the assertion below mean something: the
      // same board and the same pawn one event later, with the die thrown.
      // Lamps are offered there, so their absence below is the gate and not
      // the playback still running or the position having nothing to offer.
      const thrown = draw([...onTwin, { type: 'bonusRolled', seat: 'red', face: 3 }]);
      await skipPlayback(thrown.container);
      expect(screen.getByRole('button', { name: /St\. Paul/ }),
             'with the die thrown, the crossing is on offer').toBeInTheDocument();
      thrown.unmount();

      const owed = draw(onTwin);
      await skipPlayback(owed.container);
      expect(screen.queryByRole('button', { name: /St\. Paul/ })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Dot / })).toEqual([]);
    });

    it('says none of it once the die has been thrown', () => {
      const { container } =
        shown([...bonusOwed, { type: 'bonusRolled', seat: 'red', face: 3 }], false);
      // The chip keeps quiet until the white leg's playback is done — finish
      // it, the same way a player's tap on the cabinet would.
      fireEvent.click(container.querySelector('svg')!.parentElement!);
      expect(screen.queryByText(/bonus roll/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText('3 left')).toBeInTheDocument();
    });
  });

  /**
   * "Each section of rail can be used only once per trip" — and a trip is not
   * a turn, so what a leg spends stays spent until the pawn arrives. Deep into
   * a long trip that leaves a corridor one lamp wide, which is indistinguishable
   * from a broken board unless the spent track is drawn as spent.
   *
   * Reported from live play, on a trip that had crossed 38 sections: the map
   * lit one lamp at every dot for five dots running and said nothing about why.
   */
  describe('drawing the track this trip has spent', () => {
    /** A committed leg that stopped short of Chicago, so nothing is released. */
    const midTrip: GameEvent[] = [
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: CHICAGO, region: 'NC', payout: 4500 },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd352', 'd266'], arrived: false },
      { type: 'turnRolled', seat: 'red', white: [2, 2], bonus: null }
    ];

    const drawn = (events: GameEvent[]) => {
      const { container } = render(
        <MapView
          state={replay(events)}
          onBack={() => {}}
          onMove={vi.fn()}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      return (section: string) =>
        container.querySelector(`[data-edge="${section}"]`)?.getAttribute('data-spent') ?? null;
    };

    it('draws a section spent when the trip has no crossings of it left', () => {
      const spent = drawn(midTrip);
      // c13|d352 carries the Milwaukee Road alone, and last turn crossed it.
      expect(spent('c13|d352')).toBe('true');
      expect(spent('d266|d352')).toBe('true');
    });

    it('leaves untouched track alone', () => {
      const spent = drawn(midTrip);
      // Out of the same city, never crossed.
      expect(spent('c13|d417')).toBeNull();
      expect(spent('c13|d66')).toBeNull();
    });

    it('draws a shared section part spent while a line across it is still free', () => {
      // Minneapolis–St. Paul carries four companies, so one crossing spends
      // one of four: the pawn may cross again on another line, and the board
      // must not claim otherwise.
      const spent = drawn([...midTrip.slice(0, 6),
        { type: 'moved', seat: 'red', path: ['c13', 'c95'], arrived: false },
        { type: 'turnRolled', seat: 'red', white: [2, 2], bonus: null }]);
      expect(spent('c13|c95')).toBe('part');
    });

    it('spends the section as the step is tapped, not when it is committed', async () => {
      // The corridor has to close as the player walks it — a draft that only
      // showed after COMMIT would answer the question too late to be any use.
      const user = userEvent.setup();
      const spent = drawn(midTurn);
      expect(spent('c13|c95')).toBeNull();
      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
      expect(spent('c13|c95')).toBe('part');
    });
  });

  /**
   * The pawn used to sit where the leg began until the move was committed, so
   * a route tapped out across three states left it behind in the first — and
   * FIND, which goes to the baron up, went to where they had set out from
   * rather than where they now stood.
   */
  describe('walking the pawn as the route is tapped out', () => {
    const drawnMidTurn = () => {
      const { container } = render(
        <MapView
          state={replay(midTurn)}
          onBack={() => {}}
          onMove={vi.fn()}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      const pawn = () => container.querySelector('[aria-label="ADA"]')!.getAttribute('data-node');
      const svg = container.querySelector('svg')!;
      const box = () => svg.getAttribute('viewBox')!.split(' ').map(Number);
      return { pawn, box, container };
    };

    it('stands the pawn where the tapping has reached', async () => {
      const user = userEvent.setup();
      const { pawn } = drawnMidTurn();
      expect(pawn()).toBe(nodeForCity(MINNEAPOLIS));

      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));

      expect(pawn()).toBe(nodeForCity(ST_PAUL));
    });

    it('puts it back on undo', async () => {
      const user = userEvent.setup();
      const { pawn } = drawnMidTurn();
      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
      await user.click(screen.getByRole('button', { name: 'UNDO' }));
      expect(pawn()).toBe(nodeForCity(MINNEAPOLIS));
    });

    it('sends FIND to where the pawn stands now, not where the leg began', async () => {
      const user = userEvent.setup();
      const { box } = drawnMidTurn();
      const walkedTo = layout(1400, 788).byId.get(nodeForCity(ST_PAUL))!;

      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
      await user.click(screen.getByRole('button', { name: /find the baron/i }));

      const [x, y, width, height] = box();
      expect(x! + width! / 2).toBeCloseTo(walkedTo.x, 0);
      expect(y! + height! / 2).toBeCloseTo(walkedTo.y, 0);
    });
  });

  /**
   * The turn's arithmetic rides the engine itself — variant 5b of the design
   * project's `Train Movement Style.dc.html`: the thrown dice tumble above
   * the piece, the moves left count down there as the route is tapped out,
   * and END TURN lands there once the leg is spent.
   */
  describe('the chip above the engine', () => {
    it('counts the moves left above the engine, not on the HUD', () => {
      const { container } = show(midTurn);
      const chip = container.querySelector('[data-chip]') as SVGGElement;
      expect(chip).not.toBeNull();
      const counter = screen.getByLabelText('2 left');
      expect(chip.contains(counter)).toBe(true);
      // And the chip stands where the engine stands.
      const at = layout(1400, 788).byId.get(nodeForCity(MINNEAPOLIS))!;
      expect(chip.style.transform).toBe(`translate(${at.x}px, ${at.y}px)`);
    });

    it('hardens into END TURN when the leg is done', async () => {
      const user = userEvent.setup();
      show(midTurn);
      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
      expect(screen.getByLabelText('End turn')).toBeInTheDocument();
      expect(screen.queryByLabelText(/\d+ left/)).not.toBeInTheDocument();
    });

    it('tumbles the thrown pair above the engine, and reports the landing once', () => {
      vi.useFakeTimers();
      try {
        const onDiceLanded = vi.fn();
        const state = replay(midTurn.slice(0, -1)); // up, no dice thrown yet
        const at = (roll: { white: [number, number]; bonus: number | null } | null,
                    live: boolean) => (
          <MapView
            state={state} onBack={() => {}} onMove={vi.fn()}
            dice={{ roll, live, mine: true }}
            onRollDice={() => {}} onDiceLanded={onDiceLanded}
          />
        );
        const { rerender } = render(at(null, true));
        // Before the throw, the HUD offers it and the chip has nothing to say.
        expect(screen.getByRole('button', { name: /roll the dice/i })).toBeInTheDocument();
        expect(screen.queryByLabelText(/\d+ left/)).not.toBeInTheDocument();

        rerender(at({ white: [3, 4], bonus: null }, false));
        // Turning, so the faces are unreadable — and the landing untold.
        expect(screen.getByRole('img', { name: 'White dice, turning' })).toBeInTheDocument();
        expect(onDiceLanded).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(8 * 78); });
        expect(screen.getByRole('img', { name: 'White dice, 3 and 4' })).toBeInTheDocument();
        expect(onDiceLanded).toHaveBeenCalledOnce();

        // The landed dice lie on the table for a beat, then clear away.
        act(() => { vi.advanceTimersByTime(800); });
        expect(screen.queryByRole('img', { name: /White dice/ })).not.toBeInTheDocument();
        expect(onDiceLanded).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws the red die alone for the Bonus Roll', () => {
      vi.useFakeTimers();
      try {
        /** Double six walked without arriving: the red die is owed. */
        const owed: GameEvent[] = [
          { type: 'joined', seat: 'red', name: 'ADA' },
          { type: 'started' },
          { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
          { type: 'orderRolled', seat: 'red', first: 'red' },
          { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
          { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
          { type: 'moved', seat: 'red', path: [nodeForCity(MINNEAPOLIS), 'd66'], arrived: false }
        ];
        const onDiceLanded = vi.fn();
        const at = (bonus: number | null) => (
          <MapView
            state={replay(owed)} onBack={() => {}} onMove={vi.fn()}
            dice={{ roll: { white: [6, 6], bonus }, live: bonus === null, mine: true }}
            onRollDice={() => {}} onDiceLanded={onDiceLanded}
          />
        );
        const { container, rerender } = render(at(null));
        // Finish the white leg's playback so the chip is on duty.
        fireEvent.click(container.querySelector('svg')!.parentElement!);
        // Mounted with the pair already told: no tumble, but the landing is
        // still reported in case a roll was left pending mid-navigation.
        expect(screen.queryByRole('img', { name: /White dice/ })).not.toBeInTheDocument();
        expect(onDiceLanded).toHaveBeenCalledOnce();

        rerender(at(3));
        // The whites are lying on the table — only the red die turns.
        expect(screen.getByRole('img', { name: 'Bonus die, turning' })).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /White dice/ })).not.toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(8 * 78); });
        expect(screen.getByRole('img', { name: 'Bonus die, 3' })).toBeInTheDocument();
        expect(onDiceLanded).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /** The 5b piece: a seat-coloured disc that travels rather than teleports. */
  describe('the engine piece', () => {
    it('glides the same element to the tapped node', async () => {
      const user = userEvent.setup();
      const { container } = show(midTurn);
      const engine = container.querySelector('[aria-label="ADA"]') as SVGGElement;
      const from = layout(1400, 788).byId.get(nodeForCity(MINNEAPOLIS))!;
      expect(engine.style.transform).toBe(`translate(${from.x}px, ${from.y - 11}px)`);
      expect(engine.style.transition).toContain('380ms');

      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));

      // The same element, repositioned — a remount would cut instead of glide.
      expect(container.querySelector('[aria-label="ADA"]')).toBe(engine);
      const to = layout(1400, 788).byId.get(nodeForCity(ST_PAUL))!;
      expect(engine.style.transform).toBe(`translate(${to.x}px, ${to.y - 11}px)`);
      expect(engine.getAttribute('data-node')).toBe(nodeForCity(ST_PAUL));
    });

    it('breathes only on the baron whose turn it is', () => {
      const twoBarons: GameEvent[] = [
        { type: 'joined', seat: 'red', name: 'ADA' },
        { type: 'joined', seat: 'blue', name: 'MARGO' },
        { type: 'started' },
        { type: 'arrived', seat: 'red', city: MINNEAPOLIS, region: 'PL', payout: null },
        { type: 'arrived', seat: 'blue', city: CHICAGO, region: 'NC', payout: null },
        { type: 'orderRolled', seat: 'red', first: 'red' },
        { type: 'arrived', seat: 'red', city: ST_PAUL, region: 'PL', payout: 0 },
        { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
      ];
      const { container } = show(twoBarons);
      const ada = container.querySelector('[aria-label="ADA"]')!;
      const margo = container.querySelector('[aria-label="MARGO"]')!;
      expect(ada.querySelector('[style*="rb-breathe"]')).not.toBeNull();
      expect(margo.querySelector('[style*="rb-breathe"]')).toBeNull();
    });
  });

  /**
   * Traveled track lights in the mover's own colour: a wide soft underlay
   * with a bright line over it, fading in as each segment is taken — the same
   * treatment for the route being tapped and the committed leg playing back,
   * so they cannot read as two different things.
   */
  describe('the traveled track', () => {
    it("draws a tapped segment in the mover's colour, wide under bright", async () => {
      const user = userEvent.setup();
      const { container } = show(midTurn);
      await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
      const segments = container.querySelectorAll('[data-route="draft"] > g');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.getAttribute('style')).toContain('rb-fade');
      const lines = segments[0]!.querySelectorAll('line');
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line.getAttribute('stroke')).toBe('#e02b1d');
      expect(lines[0]!.getAttribute('stroke-width')).toBe('9');
      expect(lines[1]!.getAttribute('stroke-width')).toBe('3');
    });

    it('draws the committed trail the same way', () => {
      const played: GameEvent[] = [...midTurn,
        { type: 'moved', seat: 'red',
          path: [nodeForCity(MINNEAPOLIS), nodeForCity(ST_PAUL)], arrived: true }];
      const { container } = show(played);
      // Finish the playback, so the whole walked path is on the board.
      fireEvent.click(container.querySelector('svg')!.parentElement!);
      const segments = container.querySelectorAll('[data-route="trail"] > g');
      expect(segments).toHaveLength(1);
      const lines = segments[0]!.querySelectorAll('line');
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line.getAttribute('stroke')).toBe('#e02b1d');
    });
  });

  /**
   * Several lamps are lit at once — every one the leg may reach — and lit is
   * all they were, so the player could not tell which of them their cursor was
   * about to take. Only the lamp under the pointer carries `data-hover`.
   */
  describe('picking out the lamp under the cursor', () => {
    const hovered = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-hover="true"]')];

    /** The lamp a hit target belongs to, found the way the DOM relates them. */
    const lampFor = (name: RegExp) => screen.getByRole('button', { name });

    const shownMidTurn = () => {
      const { container } = render(
        <MapView
          state={replay(midTurn)}
          onBack={() => {}}
          onMove={vi.fn()}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      return container;
    };

    it('marks the candidate the pointer is over, and only that one', () => {
      const container = shownMidTurn();
      expect(hovered(container)).toEqual([]);

      fireEvent.pointerEnter(lampFor(/St\. Paul/));

      const marked = hovered(container);
      expect(marked).toHaveLength(1);
      expect(marked[0]!.getAttribute('data-node')).toBe(nodeForCity(ST_PAUL));
    });

    it('lets go when the pointer leaves', () => {
      const container = shownMidTurn();
      fireEvent.pointerEnter(lampFor(/St\. Paul/));
      fireEvent.pointerLeave(lampFor(/St\. Paul/));
      expect(hovered(container)).toEqual([]);
    });

    it('follows the pointer from one candidate to the next', () => {
      const container = shownMidTurn();
      const dot = screen.getAllByRole('button', { name: /^Dot / })[0]!;
      fireEvent.pointerEnter(lampFor(/St\. Paul/));
      fireEvent.pointerEnter(dot);
      // Without a leave in between — which is what happens when two targets
      // abut — the mark must still move rather than double.
      const marked = hovered(container);
      expect(marked).toHaveLength(1);
      expect(marked[0]!.getAttribute('data-node'))
        .toBe(dot.getAttribute('aria-label')!.replace('Dot ', ''));
    });

    it('drops the mark when the tap it belonged to changes the leg', () => {
      // The cursor does not move when a tap is taken, so no leave arrives —
      // but the lamp it was over is no longer a candidate, and a highlight
      // left burning on a lamp that can no longer be tapped is a lie.
      const container = shownMidTurn();
      const stPaul = lampFor(/St\. Paul/);
      fireEvent.pointerEnter(stPaul);
      fireEvent.click(stPaul);
      expect(hovered(container)).toEqual([]);
    });
  });

  /**
   * The cabinet is whatever size the window leaves it, and the map is drawn
   * into it through a viewBox — so every assertion here reads that attribute.
   * jsdom lays nothing out, so the cabinet measures 0 and the viewport falls
   * back to the map's own 1400×788: one screen pixel is one map unit, which is
   * why the arithmetic below can be read directly.
   */
  describe('panning and zooming the map', () => {
    const WHOLE_MAP = '0 0 1400 788';

    const drawn = (onMove = vi.fn()) => {
      const { container } = render(
        <MapView
          state={replay(midTurn)}
          onBack={() => {}}
          onMove={onMove}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
        />
      );
      const svg = container.querySelector('svg')!;
      const box = () => svg.getAttribute('viewBox')!.split(' ').map(Number);
      return { svg, box, onMove };
    };

    /** The same board, seen from a named device. */
    const drawnAs = (viewer: 'red' | 'green' | 'all') => {
      const { unmount } = render(
        <MapView
          state={replay(midTurn)}
          onBack={() => {}}
          onMove={vi.fn()}
          dice={{ roll: null, live: false, mine: false }}
          onRollDice={() => {}}
          onDiceLanded={() => {}}
          viewer={viewer}
        />
      );
      return { unmount };
    };

    /** A drag, as the browser delivers one: down on the map, moves, then up. */
    const drag = (from: Element, dx: number, dy: number) => {
      fireEvent.pointerDown(from, { clientX: 700, clientY: 394, pointerId: 1, button: 0 });
      fireEvent.pointerMove(window, { clientX: 700 + dx, clientY: 394 + dy, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 700 + dx, clientY: 394 + dy, pointerId: 1 });
    };

    it('opens on the whole map', () => {
      expect(drawn().svg.getAttribute('viewBox')).toBe(WHOLE_MAP);
    });

    it('zooms about the pointer, not about the middle of the cabinet', () => {
      const { svg, box } = drawn();
      // The cursor is on the map's top-left corner, so that corner is what
      // must stay under it — zooming about the centre would move it away.
      fireEvent.wheel(svg, { deltaY: -240, clientX: 0, clientY: 0 });
      const [x, y, width] = box();
      expect(width).toBeLessThan(1400);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(0);
    });

    it('zooms back out no further than the whole map', () => {
      const { svg } = drawn();
      fireEvent.wheel(svg, { deltaY: -240, clientX: 700, clientY: 394 });
      fireEvent.wheel(svg, { deltaY: 4000, clientX: 700, clientY: 394 });
      expect(svg.getAttribute('viewBox')).toBe(WHOLE_MAP);
    });

    it('pans with a drag once there is somewhere to pan to', () => {
      const { svg, box } = drawn();
      fireEvent.wheel(svg, { deltaY: -240, clientX: 700, clientY: 394 });
      const [x0, y0, w0] = box();

      drag(svg, -100, 0);

      const [x1, y1, w1] = box();
      expect(w1).toBeCloseTo(w0!);       // a drag moves the map; it does not zoom it
      expect(y1).toBeCloseTo(y0!);       // and only along the axis dragged
      // Dragged 100px left, so 100px worth of map came in from the right.
      expect(x1! - x0!).toBeCloseTo(100 * w0! / 1400, 1);
    });

    it('does not walk the pawn to a lamp a drag merely passed over', () => {
      // The hazard the threshold exists for: every legal lamp is a click
      // target sitting on the surface you pan with, so a drag that begins on
      // one would otherwise tap it and draft a step nobody asked for.
      const dragged = drawn();
      fireEvent.wheel(dragged.svg, { deltaY: -240, clientX: 700, clientY: 394 });
      const lamp = screen.getByRole('button', { name: /St\. Paul/ });
      drag(lamp, -60, 0);
      fireEvent.click(lamp);
      expect(screen.getByRole('button', { name: 'COMMIT' })).toBeDisabled();
    });

    it('still takes a tap that stays put', () => {
      // The control for the test above: the same events without the movement
      // must still draft the step, or the threshold has broken tapping.
      const { svg } = drawn();
      const lamp = screen.getByRole('button', { name: /St\. Paul/ });
      fireEvent.pointerDown(lamp, { clientX: 700, clientY: 394, pointerId: 1, button: 0 });
      fireEvent.pointerUp(window, { clientX: 700, clientY: 394, pointerId: 1 });
      fireEvent.click(lamp);
      expect(screen.getByRole('button', { name: 'COMMIT' })).toBeEnabled();
      expect(svg.getAttribute('viewBox')).toBe(WHOLE_MAP);
    });

    it('returns to the whole map on FIT', async () => {
      const user = userEvent.setup();
      const { svg } = drawn();
      fireEvent.wheel(svg, { deltaY: -240, clientX: 200, clientY: 200 });
      expect(svg.getAttribute('viewBox')).not.toBe(WHOLE_MAP);
      await user.click(screen.getByRole('button', { name: /fit/i }));
      expect(svg.getAttribute('viewBox')).toBe(WHOLE_MAP);
    });

    it('lays the title and the turn out in one row, so a narrow cabinet cannot stack them', () => {
      // jsdom lays nothing out, so overlap itself cannot be asserted — but the
      // cause can. While the cabinet was a fixed 1400 wide, BACK, the title and
      // the turn's controls were three absolutely positioned siblings that
      // could not collide; a cabinet that is now as wide as the window makes
      // them collide at every narrow size unless they share a flow.
      drawn();
      // Mid-turn the centre slot carries the turn, not the title — the
      // layout assertion is the same: one flex row, nothing stacked.
      const centre = screen.getByText(/is up|your turn/i);
      const back = screen.getByRole('button', { name: /back/i });
      const commit = screen.getByRole('button', { name: 'COMMIT' });
      const row = centre.parentElement!;
      expect(row.style.display).toBe('flex');
      expect(row.contains(back)).toBe(true);
      expect(row.contains(commit)).toBe(true);
    });

    it('drops the title rather than clipping it when the cabinet is narrow', () => {
      // Sharing the row means the title yields, and a title cut to "R" is
      // worse than no title: the controls beside it are what the turn needs.
      const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width: 520, height: 800, left: 0, top: 0,
                           right: 520, bottom: 800, x: 0, y: 0,
                           toJSON: () => ({}) } as DOMRect);
      try {
        drawn();
        expect(screen.queryByText('Rail Baron')).not.toBeInTheDocument();
        // The turn text is short and stays even where the title would not.
        expect(screen.getByText(/is up|your turn/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'COMMIT' })).toBeInTheDocument();
      } finally {
        measured.mockRestore();
      }
    });

    it("says YOUR TURN only on the actor's own device", () => {
      const { unmount } = drawnAs('red');
      expect(screen.getByText(/your turn/i)).toBeInTheDocument();
      unmount();
      drawnAs('green');
      expect(screen.queryByText(/your turn/i)).not.toBeInTheDocument();
      expect(screen.getByText(/is up/i)).toBeInTheDocument();
    });

    it('goes to the baron up when asked', async () => {
      const user = userEvent.setup();
      const { box } = drawn();
      const at = replay(midTurn).seats.red.at!;
      const pawn = layout(1400, 788).byId.get(at)!;

      await user.click(screen.getByRole('button', { name: /find the baron/i }));

      const [x, y, width, height] = box();
      expect(width).toBeLessThan(1400);
      expect(x! + width! / 2).toBeCloseTo(pawn.x, 0);
      expect(y! + height! / 2).toBeCloseTo(pawn.y, 0);
    });
  });

  /**
   * Reported from live play: touch targets felt too small, and a city's
   * glow was visibly sitting over neighbouring dots. jsdom cannot do real
   * geometric hit-testing (no layout, no paint), so this pins the fix
   * structurally instead of pixel-by-pixel: every tappable circle lives in
   * one topmost layer that paints after everything else, and every other
   * circle in the SVG is explicitly marked untappable. If either of those
   * stops being true, a lamp drawn later in the document can once again
   * sit on top of a hit target and steal its taps — the exact bug
   * reported, even though jsdom itself can't see it happen.
   */
  it('puts every hit target in one top-level layer, after all painted geometry', () => {
    const { container } = render(
      <MapView
        state={replay(midTurn)}
        onBack={() => {}}
        onMove={vi.fn()}
        dice={{ roll: null, live: false, mine: false }}
        onRollDice={() => {}}
        onDiceLanded={() => {}}
      />
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const rootChildren = [...svg!.children];

    // (a) Every role="button" element lives inside the same root child, and
    // that child is the SVG's last: nothing painted afterward can cover it.
    const holdsAButton = (el: Element) =>
      el.getAttribute('role') === 'button' || el.querySelector('[role="button"]') !== null;
    const holderIndices = rootChildren
      .map((el, i) => (holdsAButton(el) ? i : -1))
      .filter(i => i >= 0);
    expect(holderIndices.length).toBeGreaterThan(0);
    expect(new Set(holderIndices)).toEqual(new Set([rootChildren.length - 1]));
    const interactionLayer = rootChildren[rootChildren.length - 1]!;
    expect(interactionLayer.querySelectorAll('[role="button"]').length).toBeGreaterThan(0);

    // (b) Every circle outside that layer is explicitly inert: it carries
    // pointer-events="none", or sits under aria-hidden decoration.
    //
    // The dev-only label layer is the one exception, and it has to be: a
    // tooltip needs something hoverable, which is exactly what inert means it
    // is not. It is safe for a different reason — it renders *before* the
    // interaction layer, so a candidate's target always sits on top of it, and
    // it carries no handler of its own. That ordering is asserted where the
    // labels themselves are tested, and again here.
    const labels = container.querySelector('[data-labels]');
    expect(labels === null || rootChildren.indexOf(labels) < rootChildren.length - 1).toBe(true);
    const outsideCircles = [...container.querySelectorAll('circle')]
      .filter(c => !interactionLayer.contains(c) && !(labels?.contains(c) ?? false));
    expect(outsideCircles.length).toBeGreaterThan(0);
    for (const circle of outsideCircles) {
      const inert = circle.getAttribute('pointer-events') === 'none'
        || circle.closest('[aria-hidden="true"]') !== null;
      expect(inert).toBe(true);
    }
  });
});
