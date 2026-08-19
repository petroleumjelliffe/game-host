import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { nodeForCity } from '../engine';
import { STORAGE_KEY } from './state/storage';
import type { GameEvent } from './state/events';

/**
 * Every transition snaps rather than spinning. The flap itself is covered
 * in Board.test/useFlap.test; here it would only add up to two seconds of
 * real time per navigation, and while a flap is running the status and
 * note columns are deliberately blank — so assertions against them would
 * be racing the animation rather than testing the app.
 */
function snapTransitions() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

const at = (path: string, rng?: () => number) =>
  render(<MemoryRouter initialEntries={[path]}><App rng={rng} /></MemoryRouter>);

const seed = (events: GameEvent[]) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, savedAt: Date.now(), events }));

const storedTypes = () =>
  (JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { events: GameEvent[] })
    .events.map(event => event.type);

async function name(seatRowName: RegExp, value: string) {
  await userEvent.click(screen.getByRole('button', { name: seatRowName }));
  await userEvent.keyboard(`${value}{Enter}`);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  snapTransitions();
});

describe('seating and starting', () => {
  it('seats two barons and begins, writing one event per action', async () => {
    at('/pass-and-play');
    await name(/seat 1/i, 'PETE');
    await name(/seat 2/i, 'ALEX');

    expect(screen.getByText('PETE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /start game/i }));

    expect(storedTypes()).toEqual(['joined', 'joined', 'started']);
  });

  it('appends exactly one event per action under StrictMode', async () => {
    // The roll's side effect still lives in the handler and StrictMode
    // still double-invokes updaters. Losing window.prompt retired one half
    // of this hazard, not the hazard.
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/pass-and-play']}><App /></MemoryRouter>
      </StrictMode>
    );
    await name(/seat 1/i, 'PETE');
    await name(/seat 2/i, 'ALEX');
    await userEvent.click(screen.getByRole('button', { name: /start game/i }));

    expect(storedTypes()).toEqual(['joined', 'joined', 'started']);
  });
});

// The scripted values below were confirmed by direct execution against
// engine/roll.ts before being wired in here (not derived by hand alone):
//
//   rollRow(rng) = floor(r1*6) + floor(r2*6) + floor(r3*2)*11, three draws
//   per call. Every triple below is chosen so floor(r1*6)=0, floor(r2*6)=0
//   and floor(r3*2)=0, i.e. row 0 every time — CODES[0] = [6,4,8,1,10,5,8,2].
//
//   Triple 1 (0.05, 0.10, 0.20) — rollRegion for the home roll: row 0,
//   CODES[0][0]=6, REGIONS[6]='SW'. Home region is Southwest.
//
//   Triple 2 (0.02, 0.08, 0.40) — rollCityIn('SW', ...) for the home roll:
//   row 0, SW's column is 7, CODES[0][7]=2, citiesIn('SW')[2]='Los Angeles'
//   (id 59). Home town: Los Angeles.
//
//   Triple 3 (0.10, 0.15, 0.45) — rollRegion for the second roll: row 0
//   again, region 'SW' — the seat's own region (Los Angeles is in SW), so
//   rollDestination returns 'chooseRegion' instead of a city, and the
//   ballot appears.
//
//   Triple 4 (0.01, 0.12, 0.49) — after picking Northeast, rollCityIn('NE',
//   ...) for destinationInRegion: row 0, NE's column is 1, CODES[0][1]=4,
//   citiesIn('NE')[4]='New York' (id 4). payoutBetween(59, 4) = 31000, i.e.
//   $31,000 (PAYOUT_TABLE[59][4] = 31, in thousands).
describe('asking for the game board when there is no game', () => {
  it('sends you to the setup board rather than an empty one', () => {
    // A stale bookmark or a typed URL. Rendering the play screen anyway
    // gives seven blank rows with nothing tappable on them.
    at('/pass-and-play/game');
    expect(screen.getAllByRole('button', { name: /tap to join/i })).toHaveLength(6);
  });

  it('does not intercept a game that is genuinely under way', () => {
    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' }
    ]);
    at('/pass-and-play/game');
    expect(screen.getByRole('button', { name: /pete/i })).toBeInTheDocument();
    // A `started` game with no home cities rolled yet lands in the homes
    // phase, not straight into play — the sub-header is how the two screens
    // are told apart, since both show a PETE row.
    expect(screen.getByText(/home cities/i)).toBeInTheDocument();
  });
});

/** The flap leaves carry the same text for show; only the real copy counts. */
const HIDDEN = '[aria-hidden="true"], script, style';

describe('the full ballot path', () => {
  it('scripts dice through the ballot and shows the payout that lands', async () => {
    const values = [
      0.05, 0.10, 0.20,
      0.02, 0.08, 0.40,
      0.10, 0.15, 0.45,
      0.01, 0.12, 0.49
    ];
    let i = 0;
    const rng = () => {
      const value = values[i++];
      if (value === undefined) {
        throw new Error('rng exhausted: scripted for fewer draws than were requested');
      }
      return value;
    };

    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' },
      // ALEX's home and the roll for first are seeded directly rather than
      // played through — this test is about PETE's roll, and giving ALEX a
      // home this way spends none of the scripted rng draws below, which are
      // accounted for down to the triple.
      { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' }
    ]);
    at('/pass-and-play/game', rng);

    // Roll #1: the home town.
    const peteRow = screen.getByRole('button', { name: /pete/i });
    await userEvent.click(peteRow);
    // Even snapped, the roll is told before it is logged, so this waits for
    // the board to finish rather than reading it on the same tick as the tap.
    expect(await screen.findByText('Los Angeles')).toBeInTheDocument();
    // The note lands with the payout, at the end of the reveal, so this waits
    // rather than reading the board the instant it was tapped. Scoped to
    // PETE's own row: ALEX's seeded home carries the same HOME note on
    // theirs, so an unscoped query would be ambiguous between the two.
    expect(await within(peteRow).findByText('Home', { ignore: HIDDEN }, { timeout: 5000 }))
      .toBeInTheDocument();

    // Roll #2: names the seat's own region, so the ballot takes over the
    // whole board instead of a destination arriving.
    await userEvent.click(screen.getByRole('button', { name: /pete/i }));
    const northeast = await screen.findByRole('button', { name: /northeast/i });
    expect(northeast).toBeInTheDocument();

    await userEvent.click(northeast);

    expect(screen.getByText('New York')).toBeInTheDocument();
    expect(screen.getByText('31,000')).toBeInTheDocument();
  });
});

describe('discarding a saved game', () => {
  const started: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'PETE' },
    { type: 'joined', seat: 'blue', name: 'ALEX' },
    { type: 'started' }
  ];

  it('offers the saved game back rather than an empty board', () => {
    seed(started);
    at('/pass-and-play');
    expect(screen.getByRole('button', { name: /continue game/i })).toBeInTheDocument();
  });

  it('confirms before discarding, and honours a decline', async () => {
    seed(started);
    at('/pass-and-play');

    await userEvent.click(screen.getByRole('button', { name: /new game/i }));
    expect(screen.getByRole('button', { name: /yes, discard/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /keep playing/i }));
    expect(screen.getByRole('button', { name: /continue game/i })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('empties the board and clears storage once discarding is confirmed', async () => {
    seed(started);
    at('/pass-and-play');

    await userEvent.click(screen.getByRole('button', { name: /new game/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, discard/i }));

    // Rendered state, not internals: six open seats and no way back to the
    // game that was there.
    expect(screen.getAllByRole('button', { name: /tap to join/i })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /continue game/i })).toBeNull();

    // The key is genuinely gone, not left behind holding an empty log:
    // useGame's save effect skips persisting when the log is empty, so
    // reset()'s clearLog() isn't undone by the render it triggers.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

/**
 * The gate. Everything above runs with reduced motion on, where the reveal
 * is instant; these run it for real, because the whole point is what the
 * board does *during* the turning.
 */
describe('holding a roll back until the board has told it', () => {
  const motion = () => {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia;
  };

  // The same scripted dice as the ballot walk-through above: roll one is a
  // home town, roll two names the seat's own region.
  const scripted = () => {
    const values = [0.05, 0.10, 0.20, 0.02, 0.08, 0.40, 0.10, 0.15, 0.45, 0.01, 0.12, 0.49];
    let i = 0;
    return () => {
      const value = values[i++];
      if (value === undefined) throw new Error('rng exhausted');
      return value;
    };
  };

  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  const pete = () => screen.getByRole('button', { name: /pete/i });
  const ballot = () => screen.queryByRole('button', { name: /northeast/i });

  beforeEach(() => { motion(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const startGame = () => {
    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' },
      // Seeded directly, same as the ballot walk-through above: this test is
      // about PETE's roll being held back, not about ALEX or turn order, and
      // seeding costs none of the scripted rng draws below.
      { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' }
    ]);
    at('/pass-and-play/game', scripted());
  };

  it('keeps the ballot off the board while the region is still turning', () => {
    startGame();

    fireEvent.click(pete());          // roll one: the home town
    tick(52 * 300);

    fireEvent.click(pete());          // roll two: the seat's own region
    expect(ballot()).toBeNull();      // nothing said yet
    tick(52 * 3);
    expect(ballot()).toBeNull();      // panel still turning

    tick(52 * 300);
    expect(ballot()).not.toBeNull();  // and only now
  });

  it('writes nothing to the log until the region has landed', () => {
    startGame();
    fireEvent.click(pete());
    tick(52 * 300);
    const before = storedTypes();

    fireEvent.click(pete());
    tick(52 * 3);
    expect(storedTypes()).toEqual(before);

    tick(52 * 300);
    expect(storedTypes()).toEqual([...before, 'regionRequested']);
  });
});

/**
 * The dice's half of the same gate, and the seam it hangs from.
 *
 * `DiceReadout` and `useGame` each have their own tests, and both stayed green
 * with `awaitDice`, `onRollDice` or `play()`'s `dice` deleted from the App —
 * three separate cuts, each of which leaves a board whose dice cannot be
 * rolled or cannot be recorded. Only a walk-through from the real board can
 * see them, so this is the mirror of the region gate above.
 */
describe('rolling the turn dice from the board', () => {
  const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /**
   * PETE is up, standing in Minneapolis and bound for St. Paul — a baron with
   * somewhere to go and no dice yet, which is the only state the readout is
   * live in.
   */
  const upAndReadyToRoll = () => {
    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 }
    ]);
  };

  /**
   * `rollTurn` takes `d6` twice — `floor(rng() * 6) + 1` each — and a third
   * time only on a Freight double six, which 3 and 4 is not. So two draws,
   * and any further draw is a bug rather than a face.
   */
  const dice = (a: number, b: number) => {
    const values = [(a - 1) / 6 + 0.01, (b - 1) / 6 + 0.01];
    let i = 0;
    return () => {
      const value = values[i++];
      if (value === undefined) throw new Error('rng exhausted: the dice drew more than twice');
      return value;
    };
  };

  const readout = () => screen.getByRole('button', { name: /roll the dice/i });

  it('holds the roll back until the drums have told it, then names the faces', () => {
    upAndReadyToRoll();
    at('/pass-and-play/game', dice(3, 4));
    const before = storedTypes();

    fireEvent.click(readout());

    // Three ticks in: the white drums take eleven or more to land, so the
    // faces are unreadable — and the log must not have the roll either.
    // queryAll, not query: a readout that never started turning rests with
    // both drums on a readable face, and `queryBy` would throw on the two
    // matches rather than report what it found.
    tick(3 * 52);
    expect(screen.queryAllByRole('img', { name: /White die, \d/ })).toEqual([]);
    expect(storedTypes()).toEqual(before);

    tick(4000);
    expect(storedTypes()).toEqual([...before, 'turnRolled']);
    expect(screen.getByRole('img', { name: 'White die, 3' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'White die, 4' })).toBeInTheDocument();
  });

  /**
   * The Bonus Roll's half of the same seam, and the third gate through the
   * same drums. The white leg is seeded rather than walked: walking twelve
   * dots is the map's job and is covered there, and what this has to see is
   * the App's own wiring — that the readout comes live a *second* time in one
   * turn, and that `bonusRolled` reaches the log only once the drums have
   * told it.
   *
   * PETE rolls a double six on a Freight and stops in open country, so the
   * turn stays open owing a Bonus Roll and no new destination is due first.
   */
  const owingTheBonusRoll = () => {
    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(43), 'd66'], arrived: false }
    ]);
  };

  /** One face, and one only: the Bonus Roll is a single `d6`. */
  const oneDie = (face: number) => {
    const values = [(face - 1) / 6 + 0.01];
    let i = 0;
    return () => {
      const value = values[i++];
      if (value === undefined) throw new Error('rng exhausted: the Bonus Roll drew more than once');
      return value;
    };
  };

  it('offers the dice again for an owed Bonus Roll, and holds it back until told', () => {
    owingTheBonusRoll();
    at('/pass-and-play/game', oneDie(3));
    // The white pair is already in the log; the drums turn up to it at mount.
    tick(4000);
    const before = storedTypes();
    expect(before[before.length - 1]).toBe('moved');
    expect(readout()).toHaveAttribute('aria-disabled', 'false');

    fireEvent.click(readout());

    // The red drum takes twelve ticks and a trailing leaf to reach a 3 from
    // the blank, so nothing is readable or logged three ticks in.
    tick(3 * 78);
    expect(screen.queryAllByRole('img', { name: /Bonus die, \d/ })).toEqual([]);
    expect(storedTypes()).toEqual(before);

    tick(4000);
    expect(storedTypes()).toEqual([...before, 'bonusRolled']);
    expect(screen.getByRole('img', { name: 'Bonus die, 3' })).toBeInTheDocument();
    // And the whites never moved for it: they are lying on the table showing
    // the pair that was walked, not re-thrown alongside the red die.
    expect(screen.getAllByRole('img', { name: 'White die, 6' })).toHaveLength(2);
  });

  it('leaves the dice dead on a turn that earned nothing', () => {
    // The same seat, one leg walked, but on a pair that earns a Freight no
    // Bonus Roll — the turn is over and the readout belongs to ALEX now.
    seed([
      { type: 'joined', seat: 'red', name: 'PETE' },
      { type: 'joined', seat: 'blue', name: 'ALEX' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'blue', city: 20, region: 'NC', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(43), 'd66'], arrived: false }
    ]);
    at('/pass-and-play/game');
    tick(4000);
    const before = storedTypes();
    // ALEX is up and owes a destination, so nothing is live — and a tap on
    // the readout must not write a Bonus Roll nobody earned.
    expect(readout()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(readout());
    tick(4000);
    expect(storedTypes()).toEqual(before);
  });
});

/**
 * The online routes render their own Board — see OnlineApp for why that trade
 * is deliberate. These check that the routes resolve at all: a bad route or a
 * crash-on-mount is the failure mode that would otherwise reach a player as a
 * white screen, and no server is running here.
 */
describe('the online routes', () => {
  beforeEach(snapTransitions);

  it('offers the join board at /online', () => {
    at('/online');
    expect(screen.getByText('JOIN A ROOM')).toBeInTheDocument();
    expect(screen.getByText('NEW ROOM')).toBeInTheDocument();
  });

  it('will not join until a code has been typed', () => {
    at('/online');
    // Each cell is rendered three times — the accessible text plus the two
    // halves of the flap — so these are always getAllByText.
    expect(screen.getAllByText('TAP TO TYPE').length).toBeGreaterThan(0);
    // The JOIN row is dim until six characters are in.
    expect(screen.getAllByText('Need a code').length).toBeGreaterThan(0);
  });

  it('renders a room route without a server rather than crashing', () => {
    // Nothing is listening, so this is the connecting lobby with six empty
    // seats. The point is that it is a board and not a blank page, a crash,
    // or a redirect home.
    at('/room/ABC234');
    expect(screen.getAllByText('OPEN').length).toBeGreaterThan(0);
  });

  it('sends the home screen’s online row to the join board', async () => {
    const user = userEvent.setup();
    at('/');
    await user.click(screen.getByText('PLAY ONLINE'));
    expect(screen.getByText('JOIN A ROOM')).toBeInTheDocument();
  });
});

/**
 * The join board's code entry, which is the only edit affordance in the app
 * whose field is not a seat. It is here rather than in a screen test because
 * the bug it guards was in the wiring between the screen and the Board, which
 * a data-in-rows-out test cannot see: the screens were right, the Board never
 * rendered an input, and nothing threw.
 */
describe('typing a room code', () => {
  beforeEach(snapTransitions);

  it('opens an input when the code row is tapped', async () => {
    const user = userEvent.setup();
    at('/online');
    await user.click(screen.getAllByText('TAP TO TYPE')[0]!);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('takes a typed code and lights the join row', async () => {
    const user = userEvent.setup();
    at('/online');
    await user.click(screen.getAllByText('TAP TO TYPE')[0]!);
    await user.type(screen.getByRole('textbox'), 'ABC234{Enter}');
    // The code is on the board, and JOIN ROOM is live rather than dim.
    expect(screen.getAllByText('ABC234').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Takes a seat').length).toBeGreaterThan(0);
  });
});
