import {
  RAILROADS, bonusLegOwed, earnsBonus, nodeForCity, pathCost,
  type CityId, type NodeId, type RailroadId, type RegionId, type TrainType, type TurnRoll
} from '../../engine/index.js';
import { SEATS, type GameEvent, type SeatId } from './events.js';
import { ROVER_PRIZE, turnBill } from './money.js';
import { PUBLISHED_RULES, type GameRules } from './rules.js';
import { addSections, rotate } from './turns.js';

export interface Stop {
  city: CityId;
  region: RegionId;
  /** null for a home town. 0 is a real, zero-paying journey. */
  payout: number | null;
}

export interface DeclaredRun {
  /** Rolled at declaration; paid only if reached after cancellation. */
  alternate: { city: CityId; region: RegionId; payout: number };
  /** true: bound for home. false: caught or impoverished, bound for the alternate. */
  toHome: boolean;
}

export interface Seat {
  id: SeatId;
  name: string | null;
  stops: readonly Stop[];
  awaiting: RegionId | null;
  /** Derived at replay, never stored: payouts summed, home towns counting nothing. */
  earned: number;
  /** The first stop's city — where a winning run must end. Null before homes. */
  home: CityId | null;
  /**
   * Earnings from *completed* trips. `arrived` banks its payout into `earned`
   * at assignment, before the trip is walked (see the event's own docs) —
   * right for a running total, one trip early for a threshold. The end rule
   * reads this, never `earned`. Tracked as an explicit in-flight amount that
   * the arriving `moved` clears, NOT inferred from the pawn's position: a
   * declared baron who leaves their last stop has not un-earned that trip.
   */
  banked: number;
  /**
   * The declared run, while one is on — or the cancelled run still owed
   * its alternate. Null is the ordinary state. Set by the `declared`
   * event; `toHome` is cleared by the rover derivation or by poverty, and
   * the whole run clears when the alternate is reached.
   */
  run: DeclaredRun | null;
  /** Railroads this baron owns, in purchase order. */
  holdings: readonly RailroadId[];
  /**
   * Where this baron's pawn stands, as a node — not a city. A baron between
   * two cities is the normal case, and the companion could get away with
   * "which city are you heading for" only because it never moved anything.
   */
  at: NodeId | null;
  /** Sections spent so far this trip, released on arrival. */
  used: ReadonlyMap<string, number>;
}

export interface GameState {
  seats: Record<SeatId, Seat>;
  /**
   * `setup` until the game starts, `homes` while home cities and the first
   * player are being rolled, `playing` once `orderRolled` exists. A game saved
   * before turn order existed has no `orderRolled`, so it resumes in `homes`
   * with every home already in — which is exactly the state it should be in.
   */
  phase: 'setup' | 'homes' | 'playing' | 'over';
  /** Seated barons, rotated to start with whoever won the roll. */
  order: readonly SeatId[];
  /** Whose turn it is, or null before play begins. */
  turn: SeatId | null;
  /** The dice of the turn under way, or null when the current baron owes a roll. */
  rolled: TurnRoll | null;
  /**
   * Legs of the current turn already walked: 0 normally, 1 while a Bonus Roll
   * leg is owed. It decides how much movement the leg has — the white roll,
   * or just the bonus die.
   */
  leg: number;
  /**
   * The turn is waiting on its Bonus Roll: the white pair earned one, the
   * white leg has been walked, and the die has not been thrown yet.
   *
   * "If entitled, he **must** take it" — so this is not an offer. The turn
   * cannot advance past it, and both surfaces read this to make the dice live
   * again rather than leaving the map looking stranded.
   */
  bonusOwed: boolean;
  /** The leg most recently committed, for the map to walk. */
  lastMove: { seat: SeatId; path: readonly NodeId[]; arrived: boolean } | null;
  /** From started.rules; PUBLISHED_RULES when the log predates rules. */
  rules: GameRules;
  /** The seat whose declared run reached home with the target in hand. Ends the game. */
  winner: SeatId | null;
  /** Who owns what. Empty for every pre-phase-2 log. */
  owners: ReadonlyMap<RailroadId, SeatId>;
}

function emptyState(): GameState {
  const seats = {} as Record<SeatId, Seat>;
  for (const id of SEATS) {
    seats[id] = {
      id, name: null, stops: [], awaiting: null, earned: 0, at: null, used: new Map(),
      home: null, banked: 0, run: null, holdings: []
    };
  }
  return {
    seats, phase: 'setup', order: [], turn: null, rolled: null, leg: 0,
    bonusOwed: false, lastMove: null, rules: PUBLISHED_RULES, winner: null,
    owners: new Map()
  };
}

/** The turn under way, while the log is being folded. */
interface OpenTurn {
  seat: SeatId;
  roll: TurnRoll;
  legs: number;
  /** This turn's walked legs, for the fee bill. */
  paths: NodeId[][];
  /**
   * A turn whose `turnRolled` already carried a bonus face — a log written
   * before the Bonus Roll moved to after the white movement. Those turns keep
   * exactly the semantics they were played under (one continuous white+bonus
   * leg, `bonusLegOwed` deciding the second), so an old saved game replays
   * into the same game it always did.
   */
  legacy: boolean;
}

/**
 * Whether this turn is waiting on its Bonus Roll: entitled by the white pair,
 * white leg walked, die not yet thrown.
 *
 * Named once because it answers two questions that must not drift apart —
 * which `bonusRolled` events replay will accept, and what `GameState.bonusOwed`
 * reports. If those disagreed, the app would either offer a roll replay would
 * discard or discard one it had offered.
 */
const owesBonusRoll = (turn: OpenTurn, train: TrainType): boolean =>
  !turn.legacy
  && turn.legs >= 1
  && turn.roll.bonus === null
  && earnsBonus(train, turn.roll.white);

export function replay(events: readonly GameEvent[]): GameState {
  const state = emptyState();
  let first: SeatId | null = null;
  /** Turns finished. The next one belongs to order[taken % order.length]. */
  let taken = 0;
  /** The turn under way, if any. */
  let open: OpenTurn | null = null;
  /**
   * The current trip's payout per seat: set when `arrived` assigns it (and
   * banks it into `earned`), cleared by the `moved` that completes the walk.
   * banked = earned - inFlight, always.
   */
  const inFlight = new Map<SeatId, number>();
  /** Who owns what, folded as purchases and sales land. */
  const owners = new Map<RailroadId, SeatId>();
  /**
   * Every dollar that is not a stop's payout: purchases and sales now,
   * fees and the rover when their derivations land. banked =
   * earned − inFlight + adjust, always — one ledger, so no money flow
   * needs its own bookkeeping field on Seat.
   */
  const adjust = new Map<SeatId, number>();
  const credit = (sid: SeatId, amount: number): void => {
    adjust.set(sid, (adjust.get(sid) ?? 0) + amount);
  };
  const cashOf = (sid: SeatId): number =>
    state.seats[sid].earned - (inFlight.get(sid) ?? 0) + (adjust.get(sid) ?? 0);

  const settleFees = (turn: OpenTurn): void => {
    // "He must pay all the fines and penalties each turn" — settled here,
    // as the turn closes, from the paths it walked (spec Decision 2). The
    // balance may cross zero: negative is the moment between the bill
    // landing and the liquidation covering it, and legal.ts is what blocks
    // play until it does.
    const bill = turnBill(turn.paths, turn.seat, owners, owners.size === RAILROADS.size);
    let total = bill.toBank;
    for (const [owner, fee] of bill.toOwners) {
      total += fee;
      credit(owner, fee);
    }
    if (total > 0) credit(turn.seat, -total);
    // Un-declaring by poverty: "as soon as a declared player falls below
    // $200,000 … he is no longer declared." Below the target is below the
    // target, whichever bill did it — this sweep and the rover's own clear
    // are the only two ways a declaration ends short of winning.
    for (const sid of SEATS) {
      const runner = state.seats[sid];
      if (runner.run?.toHome === true && cashOf(sid) < state.rules.winTarget) {
        state.seats[sid] = { ...runner, run: { ...runner.run, toHome: false } };
      }
    }
  };

  for (const event of events) {
    if (event.type === 'started') {
      state.phase = 'homes';
      state.rules = event.rules === undefined
        ? PUBLISHED_RULES
        : { ...PUBLISHED_RULES, ...event.rules };
      continue;
    }
    const seat = state.seats[event.seat];
    switch (event.type) {
      case 'joined':
      case 'renamed':
        state.seats[event.seat] = { ...seat, name: event.name };
        break;
      case 'regionRequested':
        state.seats[event.seat] = { ...seat, awaiting: event.rolled };
        break;
      case 'arrived':
        inFlight.set(event.seat, event.payout ?? 0);
        state.seats[event.seat] = {
          ...seat,
          awaiting: null,
          earned: seat.earned + (event.payout ?? 0),
          stops: [...seat.stops,
                  { city: event.city, region: event.region, payout: event.payout }],
          // The first destination a baron is given is their home town, and it
          // is where their pawn starts. Later ones are somewhere to walk to.
          at: seat.at ?? nodeForCity(event.city)
        };
        break;
      case 'orderRolled':
        first = event.first;
        state.phase = 'playing';
        break;
      case 'bought':
        owners.set(event.railroad, event.seat);
        credit(event.seat, -event.price);
        state.seats[event.seat] = { ...seat, holdings: [...seat.holdings, event.railroad] };
        break;
      case 'sold':
        // The Decision 4 stub: a forced sale to the bank. The event is
        // ordinary log history, so a future auction replaces the mechanism
        // without touching how this replays.
        owners.delete(event.railroad);
        credit(event.seat, event.price);
        state.seats[event.seat] = {
          ...seat, holdings: seat.holdings.filter((line) => line !== event.railroad),
        };
        break;
      case 'declared': {
        // The alternate is rolled at declaration and carried here; it
        // banks nothing unless the run is cancelled and the baron reaches
        // it. Eligibility was legal.ts's question; the fold folds what the
        // log says.
        const runner: Seat = { ...seat, run: { alternate: event.alternate, toHome: true } };
        state.seats[event.seat] = runner;
        // "If a player is in his home city when he declares he wins
        // immediately" — the rulebook's own clause.
        const homeCity = runner.stops[0]?.city ?? null;
        if (state.winner === null && homeCity !== null
            && runner.at === nodeForCity(homeCity)) {
          state.winner = event.seat;
        }
        break;
      }
      case 'turnRolled':
        open = {
          seat: event.seat,
          roll: { white: event.white, bonus: event.bonus },
          legs: 0,
          paths: [],
          legacy: event.bonus !== null
        };
        break;
      case 'bonusRolled':
        // The face arrives on the turn already open, which is what makes
        // `state.rolled.bonus` non-null and hands the second leg the movement
        // it has to spend — but only onto a turn that is actually owed one.
        //
        // Any other `bonusRolled` is a log this app could not have written,
        // and the same answer serves all of them: change nothing. There is no
        // turn open; the turn is not entitled; the die has already been
        // thrown; or — the one that does real damage — the white leg has not
        // been walked yet. That last would put the face on the roll *before*
        // `moved`, so `movement()` would spend white+bonus on leg 0 and then
        // offer the very same face again for leg 1: fifteen dots of movement
        // walked as eighteen. Ignoring it leaves the die still owed, which is
        // what the rest of the log goes on to say.
        if (open !== null && owesBonusRoll(open, state.rules.startingTrain)) {
          open.roll = { white: open.roll.white, bonus: event.face };
        }
        break;
      case 'moved':
        state.seats[event.seat] = {
          ...seat,
          at: event.path[event.path.length - 1]!,
          // "Everything is released on arrival" — the whole trip's sections,
          // not just this leg's.
          used: event.arrived ? new Map() : addSections(seat.used, event.path)
        };
        // Cleared before the turn settles: fees are billed against cash
        // *after* the arriving trip is paid — the window is "on arrival,
        // after being paid", and the poverty sweep reads the same cash.
        if (event.arrived) inFlight.set(event.seat, 0);
        state.lastMove = { seat: event.seat, path: event.path, arrived: event.arrived };
        // The Rover Play, as a derivation (spec Decision 3): the paths are
        // in the log and so is every pawn's position, so no new message can
        // disagree with the movement that caused a catch. "The first player
        // to move onto or through a dot occupied by the declared pawn
        // collects $50,000" — path[0] is where the mover already stood, so
        // it does not count as moving onto anyone.
        for (const sid of SEATS) {
          if (sid === event.seat) continue;
          const runner = state.seats[sid];
          if (runner.run?.toHome !== true || runner.at === null) continue;
          if (event.path.slice(1).includes(runner.at)) {
            credit(sid, -ROVER_PRIZE);
            credit(event.seat, ROVER_PRIZE);
            // "He pays only the first pawn that catches him — after that he
            // is no longer declared": clearing toHome here is both the
            // payment cap and the cancellation.
            state.seats[sid] = { ...runner, run: { ...runner.run, toHome: false } };
          }
        }
        {
          // A cancelled run ends where the declare said it would: arrival
          // at the alternate appends the stop the trip was owed, pays the
          // carried payout, and hands back the ordinary rules — including
          // re-declaring next trip. Nothing reset `used` at cancellation,
          // deliberately: "the interrupted trip to his home city and the
          // following trip to his alternate destination count as parts of
          // the same trip" — the sections carry over precisely because no
          // code touches them. (The rulebook's reuse mercy — "no more than
          // is absolutely necessary" when stranded — is NOT implemented:
          // the draft UI keeps refusing reused sections, and a genuinely
          // stranded runner is resolved at the table, the honor level the
          // spec assigns it.)
          const mover = state.seats[event.seat];
          if (mover.run !== null && !mover.run.toHome
              && mover.at === nodeForCity(mover.run.alternate.city)) {
            const { alternate } = mover.run;
            state.seats[event.seat] = {
              ...mover,
              run: null,
              earned: mover.earned + alternate.payout,
              stops: [...mover.stops,
                      { city: alternate.city, region: alternate.region,
                        payout: alternate.payout }],
            };
            // No inFlight entry: this payout banks now, on arrival — the
            // one stop that is never assigned ahead of being walked.
          }
        }
        if (open !== null) {
          open.paths.push(event.path);
          open.legs += 1;
          // "A player can get no more than one Bonus Roll per turn" caps every
          // turn at two legs. What decides the *first* leg is the staging:
          //
          // - live: entitlement was fixed when the whites landed, and it does
          //   not depend on arrival. An entitled turn stays open whether the
          //   pawn arrived or not — arriving means the bonus leg starts a new
          //   trip, not arriving means it continues this one.
          // - legacy: the whole roll was one continuous run, so only an
          //   arrival inside the white dice left anything owed.
          const owed = open.legacy
            ? bonusLegOwed(open.roll, pathCost(event.path), event.arrived)
            : earnsBonus(state.rules.startingTrain, open.roll.white);
          // A declared pawn "stops immediately when it reaches its home
          // city" — any Bonus Roll still owed is forfeit: there is no trip
          // left to spend it on, and the turn must close so its fees settle
          // before the win is judged.
          const mover = state.seats[event.seat];
          const homeRun = mover.run?.toHome === true
            && mover.stops[0] !== undefined
            && mover.at === nodeForCity(mover.stops[0].city);
          if (homeRun || open.legs >= 2 || !owed) {
            settleFees(open);
            taken += 1; open = null;
          }
        }
        {
          // Refresh the mover's money and home on the event itself, so a
          // hostile log with trailing junk still lands `winner` on the
          // right event; the post-loop pass makes every seat uniform.
          const mover = state.seats[event.seat];
          state.seats[event.seat] = {
            ...mover, banked: cashOf(event.seat), home: mover.stops[0]?.city ?? null,
          };
        }
        {
          // The win: a declared run's moved ending at the home node, with
          // the target still in hand after this turn's fees — settleFees
          // has already run, and its poverty sweep clears toHome when the
          // bill broke the target, so `toHome` here means "still able to
          // win".
          const mover = state.seats[event.seat];
          if (state.winner === null && mover.run?.toHome === true
              && mover.home !== null && mover.at === nodeForCity(mover.home)) {
            state.winner = event.seat;
          }
        }
        break;
    }
  }

  const seated = SEATS.filter(id => state.seats[id].name !== null);
  state.order = first === null ? [] : rotate(seated, first);
  state.turn = state.order.length === 0
    ? null
    : state.order[taken % state.order.length]!;
  state.rolled = open?.roll ?? null;
  state.leg = open?.legs ?? 0;
  // Derived, never stored: an entitled turn that has walked its white leg and
  // has no face on the bonus die yet. A legacy turn never reaches it — its
  // face was in hand from the roll.
  state.bonusOwed = open !== null && owesBonusRoll(open, state.rules.startingTrain);
  // Money fields for every seat, movers or not — the in-loop settlement only
  // touched seats as they moved, and they agree with this by construction.
  for (const sid of SEATS) {
    const seat = state.seats[sid];
    state.seats[sid] = { ...seat, home: seat.stops[0]?.city ?? null, banked: cashOf(sid) };
  }
  state.owners = owners;
  if (state.winner !== null) state.phase = 'over';
  return state;
}

/**
 * Undo is a play-phase affordance, matching Acquire. Setup has none: a
 * taken row is tapped to rename, which corrects it directly. So two
 * guards — refuse before the game has started, and refuse to rewind back
 * across the moment it did.
 *
 * One tap takes back one thing the player did, which is no longer one event.
 * A turn is a roll and the leg it paid for — four events when a bonus leg
 * follows, because arriving inside the white dice buys a new destination and
 * a second leg. Popping the last event alone left the board mid-turn, with
 * dice on the table for a leg that had just been unwalked, and made the row's
 * own label ("Take back a turn") a lie.
 *
 * So a tap pops one player action:
 *
 * - a destination announcement (`arrived`, or the `regionRequested` that
 *   hands a baron their own region back) is its own action, and goes alone;
 * - a roll or a leg goes back with the whole turn it belongs to — through
 *   and including the `turnRolled` that opened it, which carries that turn's
 *   moves, its Bonus Roll and any destination announced part-way through. The
 *   Bonus Roll is a roll and goes back the same way: popping it alone would
 *   leave the turn owing one again, which is a state the player did not ask
 *   to be in and which the row's own label ("Take back a turn") denies;
 * - anything else — seating, a rename, the roll for first player — goes one
 *   at a time, as it always did.
 */
export function undo(events: readonly GameEvent[]): GameEvent[] {
  const startedAt = events.findIndex(event => event.type === 'started');
  if (startedAt < 0) return [...events];
  if (events.length <= startedAt + 1) return [...events];

  const last = events[events.length - 1]!;
  if (last.type === 'moved' || last.type === 'turnRolled' || last.type === 'bonusRolled') {
    // Never past `started`, which is the second guard again: a turn that
    // somehow has no roll behind it falls through to popping one event
    // rather than swallowing the game.
    for (let at = events.length - 1; at > startedAt; at--) {
      if (events[at]!.type === 'turnRolled') return events.slice(0, at);
    }
  }
  return events.slice(0, -1);
}

export const currentCity = (seat: Seat): CityId | null =>
  seat.stops.length ? seat.stops[seat.stops.length - 1]!.city : null;
