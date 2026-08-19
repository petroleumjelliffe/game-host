import {
  bonusLegOwed, earnsBonus, nodeForCity, pathCost,
  type CityId, type NodeId, type RegionId, type TrainType, type TurnRoll
} from '../../engine';
import { SEATS, type GameEvent, type SeatId } from './events';
import { addSections, rotate } from './turns';

export interface Stop {
  city: CityId;
  region: RegionId;
  /** null for a home town. 0 is a real, zero-paying journey. */
  payout: number | null;
}

export interface Seat {
  id: SeatId;
  name: string | null;
  stops: readonly Stop[];
  awaiting: RegionId | null;
  /** Derived at replay, never stored: payouts summed, home towns counting nothing. */
  earned: number;
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
  phase: 'setup' | 'homes' | 'playing';
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
}

function emptyState(): GameState {
  const seats = {} as Record<SeatId, Seat>;
  for (const id of SEATS) {
    seats[id] = {
      id, name: null, stops: [], awaiting: null, earned: 0, at: null, used: new Map()
    };
  }
  return {
    seats, phase: 'setup', order: [], turn: null, rolled: null, leg: 0,
    bonusOwed: false, lastMove: null
  };
}

/**
 * Every baron starts on a Freight and nothing upgrades one yet. Named here
 * rather than inlined so the money spec has one place to make it a lookup —
 * `src/state/useGame.ts` carries the same constant for the same reason.
 */
const TRAIN: TrainType = 'freight';

/** The turn under way, while the log is being folded. */
interface OpenTurn {
  seat: SeatId;
  roll: TurnRoll;
  legs: number;
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
const owesBonusRoll = (turn: OpenTurn): boolean =>
  !turn.legacy
  && turn.legs >= 1
  && turn.roll.bonus === null
  && earnsBonus(TRAIN, turn.roll.white);

export function replay(events: readonly GameEvent[]): GameState {
  const state = emptyState();
  let first: SeatId | null = null;
  /** Turns finished. The next one belongs to order[taken % order.length]. */
  let taken = 0;
  /** The turn under way, if any. */
  let open: OpenTurn | null = null;

  for (const event of events) {
    if (event.type === 'started') {
      state.phase = 'homes';
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
      case 'turnRolled':
        open = {
          seat: event.seat,
          roll: { white: event.white, bonus: event.bonus },
          legs: 0,
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
        if (open !== null && owesBonusRoll(open)) {
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
        state.lastMove = { seat: event.seat, path: event.path, arrived: event.arrived };
        if (open !== null) {
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
            : earnsBonus(TRAIN, open.roll.white);
          if (open.legs >= 2 || !owed) { taken += 1; open = null; }
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
  state.bonusOwed = open !== null && owesBonusRoll(open);
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
