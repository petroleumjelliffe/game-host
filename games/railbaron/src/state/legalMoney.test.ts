// What legal.ts refuses once money means something: appends into a finished
// game, destination rolls from declared barons, and payouts the table never
// said. Refusals are asserted by *reason* — a turn-order mistake in a builder
// must not impersonate a pass.
import { describe, expect, it } from 'vitest';
import { CITIES, bankSalePrice, cityById, nodeForCity, payoutBetween, railroadPrice } from '../../engine/index.js';
import type { CityId } from '../../engine/index.js';
import { appendLegality } from './legal.js';
import type { GameEvent, SeatId } from './events.js';
import { PUBLISHED_RULES } from './rules.js';

const id = (name: string): CityId => {
  const city = CITIES.find((c) => c.name === name);
  if (!city) throw new Error(`no city named ${name}`);
  return city.id;
};

const home = (seat: SeatId, city: CityId): GameEvent =>
  ({ type: 'arrived', seat, city, region: cityById(city).region, payout: null });

const assign = (seat: SeatId, from: CityId, to: CityId): GameEvent =>
  ({ type: 'arrived', seat, city: to, region: cityById(to).region,
     payout: payoutBetween(from, to) });

/** [3,4] earns no freight Bonus Roll, so the turn closes on its one leg. */
const walk = (seat: SeatId, from: CityId, to: CityId): GameEvent[] => [
  { type: 'turnRolled', seat, white: [3, 4], bonus: null },
  { type: 'moved', seat, path: [nodeForCity(from), nodeForCity(to)], arrived: true },
];

const CHICAGO = id('Chicago');
const NEW_YORK = id('New York');
const LOS_ANGELES = id('Los Angeles');
const MIAMI = id('Miami');
const STP = id('St. Paul');

const opening = (rules: object = { winTarget: 1000 }): GameEvent[] => [
  { type: 'joined', seat: 'red', name: 'A' },
  { type: 'joined', seat: 'blue', name: 'B' },
  { type: 'started', rules: { ...PUBLISHED_RULES, ...rules } } as GameEvent,
  home('red', CHICAGO), home('blue', MIAMI),
  { type: 'orderRolled', seat: 'red', first: 'red' },
];

/**
 * Red completes a trip (eligible to declare at NEW_YORK), then blue completes
 * one too,
 * which hands the turn back to red — the trap the plan warns about: without
 * blue's intervening turn, every red append would be refused `not your turn`
 * and these tests would pass for the wrong reason.
 */
const brinkAt = (rules: object): GameEvent[] => [
  ...opening(rules),
  assign('red', CHICAGO, NEW_YORK),
  ...walk('red', CHICAGO, NEW_YORK),
  assign('blue', MIAMI, LOS_ANGELES),
  ...walk('blue', MIAMI, LOS_ANGELES),
];

const brink = (): GameEvent[] => brinkAt({ winTarget: 1000 });

const declare = (seat: SeatId, from: CityId, alt: CityId): GameEvent =>
  ({ type: 'declared', seat,
     alternate: { city: alt, region: cityById(alt).region,
                  payout: payoutBetween(from, alt) } });

const wonLog = (): GameEvent[] => [
  ...brink(),
  declare('red', NEW_YORK, LOS_ANGELES),
  { type: 'turnRolled', seat: 'red', white: [2, 5], bonus: null },
  { type: 'moved', seat: 'red',
    path: [nodeForCity(NEW_YORK), nodeForCity(CHICAGO)], arrived: true },
];

describe('a finished game is closed', () => {
  it('refuses every append after the winning move, by reason', () => {
    const done = wonLog();
    const refusal = appendLegality(done,
      { type: 'turnRolled', seat: 'blue', white: [1, 1], bonus: null }, 'blue');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/game is over/);
  });
});

describe('declared seats', () => {
  it('may not roll destinations', () => {
    const log = [...brink(), declare('red', NEW_YORK, LOS_ANGELES)];
    const region = appendLegality(log,
      { type: 'regionRequested', seat: 'red', rolled: cityById(CHICAGO).region }, 'red');
    expect(region).not.toBeNull();
    expect(region!.message).toMatch(/declared baron/);

    const dest = appendLegality(log, assign('red', NEW_YORK, MIAMI), 'red');
    expect(dest).not.toBeNull();
    expect(dest!.message).toMatch(/declared baron/);
  });

  it('may roll the turn dice without a destination owed', () => {
    expect(appendLegality([...brink(), declare('red', NEW_YORK, LOS_ANGELES)],
      { type: 'turnRolled', seat: 'red', white: [2, 3], bonus: null }, 'red')).toBeNull();
  });
});

describe('payout honesty', () => {
  it('refuses an arrived whose payout is not the table\'s', () => {
    const log = opening(); // red's turn, red owes a destination
    const wrong = { ...assign('red', CHICAGO, NEW_YORK), payout: 999999 } as GameEvent;
    const refusal = appendLegality(log, wrong, 'red');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/payout table/);
    expect(appendLegality(log, assign('red', CHICAGO, NEW_YORK), 'red')).toBeNull();
  });
});

/** Append through the gate, asserting it passes — the legality IS the setup. */
const play = (log: GameEvent[], event: GameEvent, sender: SeatId): GameEvent[] => {
  const refusal = appendLegality(log, event, sender);
  expect(refusal, `${event.type} by ${sender}: ${refusal?.message ?? ''}`).toBeNull();
  return [...log, event];
};

const buy = (seat: SeatId, railroad: string): GameEvent =>
  ({ type: 'bought', seat, railroad, price: railroadPrice(railroad) });

describe('the purchase window', () => {
  // brink(): red's turn, standing paid at New York, owing a destination
  // roll — the window. Red's balance is one Chicago–New York payout, so
  // the affordable lines below are the $4,000–$8,000 ones.
  it('opens on arrival, admits several purchases, and never blocks rolling', () => {
    let log = brink();
    log = play(log, buy('red', 'B&M'), 'red');
    log = play(log, buy('red', 'RF&P'), 'red');
    // Rolling was never blocked: the destination roll stays legal.
    log = play(log,
      { type: 'regionRequested', seat: 'red', rolled: cityById(CHICAGO).region }, 'red');
  });

  it('refuses the wrong price, the owned railroad, and the empty purse', () => {
    const log = [...brink(), buy('red', 'B&M')];
    const wrong = appendLegality(log,
      { type: 'bought', seat: 'red', railroad: 'RF&P', price: 5000 }, 'red');
    expect(wrong!.message).toMatch(/price list/);
    const owned = appendLegality(log, buy('red', 'B&M'), 'red');
    expect(owned!.message).toMatch(/already owned/);
    const broke = appendLegality(log, buy('red', 'NYC'), 'red');
    expect(broke!.message).toMatch(/balance/);
  });

  it('closes for a declared baron, and once the destination roll has begun', () => {
    const declared = appendLegality(
      [...brink(), declare('red', NEW_YORK, LOS_ANGELES)], buy('red', 'B&M'), 'red');
    expect(declared!.message).toMatch(/window closed/);
    const midRoll = appendLegality(
      [...brink(), { type: 'regionRequested', seat: 'red', rolled: cityById(CHICAGO).region }],
      buy('red', 'B&M'), 'red');
    expect(midRoll!.message).toMatch(/destination roll has begun/);
  });
});

describe('declaring', () => {
  it('needs all three conditions and audits the alternate payout', () => {
    // Eligible: at the latest destination, over the target, before the roll.
    expect(appendLegality(brink(), declare('red', NEW_YORK, LOS_ANGELES), 'red')).toBeNull();

    // Mid-trip — not standing at the latest destination.
    let log = brink();
    log = play(log, assign('red', NEW_YORK, STP), 'red');
    log = play(log, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }, 'red');
    log = play(log, { type: 'moved', seat: 'red',
      path: [nodeForCity(NEW_YORK), 'c13'], arrived: false }, 'red');
    log = play(log, assign('blue', LOS_ANGELES, MIAMI), 'blue');
    log = play(log, { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue');
    log = play(log, { type: 'moved', seat: 'blue',
      path: [nodeForCity(LOS_ANGELES), 'c95'], arrived: false }, 'blue');
    const midTrip = appendLegality(log, declare('red', NEW_YORK, MIAMI), 'red');
    expect(midTrip!.message).toMatch(/declaring needs/);

    // Short of the published target: the same trip under real rules.
    const short = appendLegality(brinkAt(PUBLISHED_RULES),
      declare('red', NEW_YORK, LOS_ANGELES), 'red');
    expect(short!.message).toMatch(/declaring needs/);

    // The alternate payout is the table's.
    const cooked = { ...declare('red', NEW_YORK, LOS_ANGELES) } as GameEvent & {
      alternate: { city: CityId; region: string; payout: number } };
    cooked.alternate = { ...cooked.alternate, payout: 999999 };
    const audited = appendLegality(brink(), cooked, 'red');
    expect(audited!.message).toMatch(/payout table/);
  });
});

describe('the liquidation gate', () => {
  /**
   * Red ends up short: after buying WP their balance is one payout minus
   * $8,000; blue then owns C&NW, and red's next turn rides it for a $5,000
   * fee. Every append below goes through the gate, so the fixture is
   * itself proof the flow is reachable in legal play.
   */
  const shortLog = (): GameEvent[] => {
    // Starting cash zeroed: this test's subject is the ledger going short,
    // and the published $20,000 cushion would hide it.
    let log = brinkAt({ winTarget: 1000, startingCash: 0 });
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
    return log;
  };

  it('refuses every event while a seat is short — except the sale that pays', () => {
    const log = shortLog();
    const blocked = appendLegality(log,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue');
    expect(blocked!.message).toMatch(/sold to the bank/);

    const sale = appendLegality(log,
      { type: 'sold', seat: 'red', railroad: 'WP', price: bankSalePrice('WP') }, 'red');
    expect(sale).toBeNull();

    const cheap = appendLegality(log,
      { type: 'sold', seat: 'red', railroad: 'WP', price: 1000 }, 'red');
    expect(cheap!.message).toMatch(/half the purchase price/);

    const notYours = appendLegality(log,
      { type: 'sold', seat: 'red', railroad: 'C&NW', price: bankSalePrice('C&NW') }, 'red');
    expect(notYours!.message).toMatch(/not yours to sell/);

    const solvent = appendLegality(log,
      { type: 'sold', seat: 'blue', railroad: 'C&NW', price: bankSalePrice('C&NW') }, 'blue');
    expect(solvent!.message).toMatch(/only for meeting a bill/);

    // The sale covers the bill, and play resumes.
    const after = [...log,
      { type: 'sold', seat: 'red', railroad: 'WP', price: bankSalePrice('WP') } as GameEvent];
    expect(appendLegality(after,
      { type: 'turnRolled', seat: 'blue', white: [3, 4], bonus: null }, 'blue')).toBeNull();
  });
});

