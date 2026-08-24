import { nodeForCity, sectionKey, type CityId, type NodeId } from '../../engine/index.js';
import { SEATS, type SeatId } from './events.js';
// Types only. game.ts imports rotate and addSections from here at runtime, so
// a value import in this direction would close a real cycle.
import type { GameState, Seat } from './game.js';

/**
 * Seating order is fixed; the roll decides only who starts within it. "then
 * to the left, clockwise" is the rotation.
 */
export function rotate(seats: readonly SeatId[], first: SeatId): SeatId[] {
  const at = seats.indexOf(first);
  // A first player who is no longer seated cannot order anything; the seated
  // order stands rather than throwing away the game.
  if (at < 0) return [...seats];
  return [...seats.slice(at), ...seats.slice(0, at)];
}

export function addSections(
  used: ReadonlyMap<string, number>, path: readonly NodeId[]
): Map<string, number> {
  const next = new Map(used);
  for (let i = 1; i < path.length; i++) {
    const key = sectionKey(path[i - 1]!, path[i]!);
    next.set(key, (next.get(key) ?? 0) + 1);
  }
  return next;
}

/** A baron's home town: their first stop, the one that paid nothing. */
export const homeOf = (seat: Seat): CityId | null => seat.stops[0]?.city ?? null;

/**
 * Where this baron is heading, or null when they owe a destination roll. The
 * home town is a stop but never a destination, so one stop means none.
 */
export const destinationOf = (seat: Seat): CityId | null =>
  // A declared baron's destination IS home; a caught or impoverished one's
  // is the alternate the declare carried. One seam serving both surfaces,
  // exactly as it served phase-1 homeward: the map's route draft walks
  // toward it, and needsDestination() below goes structurally false
  // mid-run (they are never owed a destination roll; legal.ts refuses one
  // anyway, in the same words).
  seat.run !== null
    ? (seat.run.toHome ? seat.home : seat.run.alternate.city)
    : seat.stops.length >= 2 ? seat.stops[seat.stops.length - 1]!.city : null;

/**
 * Whether this baron may be given a destination — and therefore the guard
 * that stops one being re-rolled mid-trip.
 *
 * It is structural rather than a rule to remember: a destination is owed only
 * when the pawn is standing on the last one it was given (or has none yet).
 * A baron part-way along a trip fails this by standing somewhere else.
 */
export function needsDestination(seat: Seat, nodeOf: (city: CityId) => NodeId): boolean {
  if (seat.at === null) return true;              // no home city yet
  const destination = destinationOf(seat);
  return destination === null || seat.at === nodeOf(destination);
}

/** The home cities already spoken for. No two barons may share one. */
export function homesTaken(state: GameState): Set<CityId> {
  const taken = new Set<CityId>();
  for (const id of SEATS) {
    const home = homeOf(state.seats[id]);
    if (home !== null) taken.add(home);
  }
  return taken;
}

/** Homes are rolled in seat order, so this is the first seated baron without one. */
export const nextHomeSeat = (state: GameState): SeatId | null =>
  SEATS.find(id => state.seats[id].name !== null && state.seats[id].at === null) ?? null;

export const homesDone = (state: GameState): boolean => nextHomeSeat(state) === null;

/**
 * The rulebook's three conditions, verbatim: "1) have $200,000 or more in
 * cash, 2) be in his latest destination city, and 3) be about to roll for
 * a new destination". Cash is banked — fees already netted. Lights the
 * choice for the UI and gates the event for legal.ts; changes nothing by
 * itself (spec Decision 3).
 */
export function mayDeclare(state: GameState, id: SeatId): boolean {
  const seat = state.seats[id];
  if (state.phase !== 'playing' || seat.run !== null) return false;
  if (seat.stops.length < 2) return false;   // home is a stop, never a destination
  const latest = seat.stops[seat.stops.length - 1]!.city;
  return seat.at === nodeForCity(latest) && seat.banked >= state.rules.winTarget;
}

/**
 * The seat a fee bill has put under zero *while it still holds railroads
 * to sell* — the liquidation gate. The holdings condition is load-bearing:
 * the obligation is "sell until covered", and a seat with nothing left to
 * sell is the spec's named hole (the elimination text is still owed), so
 * its negative balance rides and the table resolves it by house rule
 * rather than the app freezing. Until starting cash is transcribed, early
 * trips can dip below zero on bank fees alone, and that must not stall a
 * game nobody in has anything to liquidate.
 */
export const shortSeat = (state: GameState): SeatId | null =>
  SEATS.find((id) =>
    state.seats[id].banked < 0 && state.seats[id].holdings.length > 0) ?? null;
