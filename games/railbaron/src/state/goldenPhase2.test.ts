// The phase-2 golden shelf, event level — one describe per mechanism the
// spec names. Wire-facing standards drive every append through
// appendLegality, so they pin the answer a client actually gets;
// fold-level standards drive replay directly, where turn order is the
// log's problem and the fixture's freedom. Payouts and prices are always
// computed, never hardcoded.
import { describe, expect, it } from 'vitest';
import {
  CITIES, RAILROAD_PRICES, bankSalePrice, cityById, nodeForCity, payoutBetween,
  railroadPrice,
} from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
import { replay } from './game.js';
import { ALL_OWNED_FEE, OWNER_FEE } from './money.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';
import { mayDeclare } from './turns.js';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');
const MPLS = id('Minneapolis');   // node c13
const STP = id('St. Paul');       // node c95

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const assign = (seat: SeatId, from: CityId, to: CityId): GameEvent =>
  ({ type: 'arrived', seat, city: to, region: cityById(to).region,
     payout: payoutBetween(from, to) });

/** [3,4]: no freight Bonus Roll, so every turn closes on its one leg. */
const walk = (seat: SeatId, from: CityId, to: CityId): GameEvent[] => [
  { type: 'turnRolled', seat, white: [3, 4], bonus: null },
  { type: 'moved', seat, path: [nodeForCity(from), nodeForCity(to)], arrived: true },
];

const declare = (seat: SeatId, from: CityId, alt: CityId): GameEvent =>
  ({ type: 'declared', seat,
     alternate: { city: alt, region: cityById(alt).region,
                  payout: payoutBetween(from, alt) } });

const buy = (seat: SeatId, railroad: string): GameEvent =>
  ({ type: 'bought', seat, railroad, price: railroadPrice(railroad) });

/** Append through the gate: the legality IS the assertion. */
const play = (log: GameEvent[], event: GameEvent, sender: SeatId): GameEvent[] => {
  const refusal = appendLegality(log, event, sender);
  expect(refusal, `${event.type} by ${sender}: ${refusal?.message ?? ''}`).toBeNull();
  return [...log, event];
};

const opening = (rules: object = { winTarget: 1000 }): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, ...rules } } as GameEvent,
  home('red', CHICAGO), home('blue', MIAMI),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

/** Red banks Chicago–New York, blue banks Miami–LA; red's window is open. */
const brink = (): GameEvent[] => [
  ...opening(),
  assign('red', CHICAGO, NEW_YORK),
  ...walk('red', CHICAGO, NEW_YORK),
  assign('blue', MIAMI, LOS_ANGELES),
  ...walk('blue', MIAMI, LOS_ANGELES),
];

describe('the purchase window, used and skipped', () => {
  it('admits several purchases, closes on the roll, and never blocked it', () => {
    let log = brink();
    log = play(log, buy('red', 'B&M'), 'red');
    log = play(log, buy('red', 'RF&P'), 'red');
    // The skip IS rolling: the destination roll is legal mid-window…
    log = play(log, assign('red', NEW_YORK, MIAMI), 'red');
    // …and rolling is what closes the window.
    const closed = appendLegality(log, buy('red', 'NYNH&H'), 'red');
    expect(closed!.message).toMatch(/on arrival/);

    const state = replay(log);
    expect(state.seats.red.holdings).toEqual(['B&M', 'RF&P']);
    expect(state.seats.red.banked).toBe(
      payoutBetween(CHICAGO, NEW_YORK) - railroadPrice('B&M') - railroadPrice('RF&P'));
  });
});

describe('fee bills at all three tiers, and the flip both ways', () => {
  const crossing: GameEvent[] = [
    { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
    { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },
  ];
  const everyRailroad = [...RAILROAD_PRICES.keys()];

  it('bills $5,000 while any railroad is unowned, $10,000 once none is, and drops back on a sale', () => {
    // Blue owns C&NW alone: the c13–d131 crossing pays the owner tier.
    const some = replay([...opening(), buy('blue', 'C&NW'), ...crossing]);
    expect(some.seats.red.banked).toBe(-OWNER_FEE);

    // Blue owns all 28 (scripted; the fold is tolerant of the debt):
    // the same crossing pays the all-owned tier.
    const allBought = everyRailroad.map((line) => buy('blue', line));
    const all = replay([...opening(), ...allBought, ...crossing]);
    expect(all.owners.size).toBe(28);
    expect(all.seats.red.banked).toBe(-ALL_OWNED_FEE);

    // A sale to the bank flips the tier straight back down.
    const after = replay([...opening(), ...allBought,
      { type: 'sold', seat: 'blue', railroad: 'GN', price: bankSalePrice('GN') },
      ...crossing]);
    expect(after.owners.size).toBe(27);
    expect(after.seats.red.banked).toBe(-OWNER_FEE);
  });
});

describe('declare, the rover, the alternate, and declaring again', () => {
  it('runs the whole cycle on a bankroll that survives the catch', () => {
    // Red banks three big trips before declaring at St. Paul, so the
    // $50,000 rover payment leaves the target still in hand.
    const funded: GameEvent[] = [
      ...opening(),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      assign('red', NEW_YORK, LOS_ANGELES), ...walk('red', NEW_YORK, LOS_ANGELES),
      assign('red', LOS_ANGELES, STP), ...walk('red', LOS_ANGELES, STP),
      declare('red', STP, MPLS),
    ];
    const declared = replay(funded);
    expect(declared.seats.red.run?.toHome).toBe(true);

    const caught = [...funded,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false },
    ] as GameEvent[];
    expect(replay(caught).seats.red.run?.toHome).toBe(false);

    // The same trip continues to the alternate, pays its $0, and the
    // ordinary eligibility rule lights again.
    const arrived = [...caught,
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c95', 'c13'], arrived: true },
    ] as GameEvent[];
    const back = replay(arrived);
    expect(back.seats.red.run).toBeNull();
    expect(back.seats.red.banked).toBeGreaterThanOrEqual(back.rules.winTarget);
    expect(mayDeclare(back, 'red')).toBe(true);

    const again = replay([...arrived, declare('red', MPLS, MIAMI)]);
    expect(again.seats.red.run?.toHome).toBe(true);
    expect(again.winner).toBeNull();
  });
});

describe('a declare cancelled by fees reaches its alternate', () => {
  it('the bill breaks the target, the trip redirects, the alternate pays', () => {
    const target = payoutBetween(CHICAGO, NEW_YORK);
    const cancelled: GameEvent[] = [
      ...opening({ winTarget: target }),
      assign('red', CHICAGO, NEW_YORK), ...walk('red', CHICAGO, NEW_YORK),
      declare('red', NEW_YORK, MIAMI),
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false },  // $1,000 fee
    ];
    const broke = replay(cancelled);
    expect(broke.seats.red.run?.toHome).toBe(false);

    const arrived = replay([...cancelled,
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: ['d131', nodeForCity(MIAMI)], arrived: true },
    ]);
    expect(arrived.seats.red.run).toBeNull();
    // One fee only: the second turn's hop to Miami is a fake path riding
    // no edge, so it bills nothing — the cancelling $1,000 stands alone.
    expect(arrived.seats.red.banked)
      .toBe(target - 1000 + payoutBetween(NEW_YORK, MIAMI));
    expect(arrived.winner).toBeNull();
  });
});

describe('the immediate win, and the closed game', () => {
  const won = (): GameEvent[] => {
    // Red's latest destination IS their home city — a legal trip — and
    // declaring while standing there wins on the spot.
    let log = brink();
    log = play(log, assign('red', NEW_YORK, CHICAGO), 'red');
    log = play(log, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }, 'red');
    log = play(log, { type: 'moved', seat: 'red',
      path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true }, 'red');
    log = play(log, assign('blue', LOS_ANGELES, MIAMI), 'blue');
    log = play(log, { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue');
    log = play(log, { type: 'moved', seat: 'blue',
      path: [nodeForCity(LOS_ANGELES), nodeForCity(MIAMI)], arrived: true }, 'blue');
    return play(log, declare('red', CHICAGO, MIAMI), 'red');
  };

  it('declaring at home ends the game at once', () => {
    const state = replay(won());
    expect(state.winner).toBe('red');
    expect(state.phase).toBe('over');
  });

  it('closes the game to every event type, phase 2 included', () => {
    const log = won();
    const attempts: [GameEvent, SeatId][] = [
      [{ type: 'joined', seat: 'green', name: 'C' }, 'green'],
      [{ type: 'renamed', seat: 'blue', name: 'Z' }, 'blue'],
      [{ type: 'started' }, 'blue'],
      [{ type: 'regionRequested', seat: 'blue', rolled: cityById(MIAMI).region }, 'blue'],
      [assign('blue', MIAMI, LOS_ANGELES), 'blue'],
      [{ type: 'orderRolled', seat: 'blue', first: 'blue' }, 'blue'],
      [{ type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue'],
      [{ type: 'bonusRolled', seat: 'blue', face: 3 }, 'blue'],
      [{ type: 'moved', seat: 'blue', path: ['c13', 'c95'], arrived: false }, 'blue'],
      [buy('blue', 'B&M'), 'blue'],
      [declare('blue', MIAMI, CHICAGO), 'blue'],
      [{ type: 'sold', seat: 'blue', railroad: 'B&M', price: bankSalePrice('B&M') }, 'blue'],
    ];
    for (const [event, sender] of attempts) {
      const refusal = appendLegality(log, event, sender);
      expect(refusal, event.type).not.toBeNull();
      expect(refusal!.message, event.type).toMatch(/game is over/);
    }
  });
});

describe('liquidation, forced and cleared', () => {
  it('the bill blocks the table, the sale pays it, play resumes', () => {
    // Red buys down to $1,000, blue takes C&NW, and red's next turn rides
    // it: $5,000 owed on $1,000 in hand. Every append goes through the
    // gate, so the fixture is itself proof the flow arises in legal play.
    let log = brink();
    log = play(log, buy('red', 'WP'), 'red');
    log = play(log, assign('red', NEW_YORK, STP), 'red');
    log = play(log, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }, 'red');
    log = play(log, { type: 'moved', seat: 'red',
      path: [nodeForCity(NEW_YORK), 'c13'], arrived: false }, 'red');
    log = play(log, buy('blue', 'C&NW'), 'blue');
    log = play(log, assign('blue', LOS_ANGELES, MIAMI), 'blue');
    log = play(log, { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue');
    log = play(log, { type: 'moved', seat: 'blue',
      path: [nodeForCity(LOS_ANGELES), 'c95'], arrived: false }, 'blue');
    log = play(log, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }, 'red');
    log = play(log, { type: 'moved', seat: 'red', path: ['c13', 'd131'], arrived: false }, 'red');

    expect(replay(log).seats.red.banked).toBeLessThan(0);
    const blocked = appendLegality(log,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue');
    expect(blocked!.message).toMatch(/sold to the bank/);

    log = play(log,
      { type: 'sold', seat: 'red', railroad: 'WP', price: bankSalePrice('WP') }, 'red');
    expect(replay(log).seats.red.banked).toBeGreaterThanOrEqual(0);
    expect(replay(log).owners.has('WP')).toBe(false);
    expect(appendLegality(log,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue')).toBeNull();
  });
});
