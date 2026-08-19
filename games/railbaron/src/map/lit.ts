import type { CityId, NodeId } from '../../engine';
import { SEATS, type SeatId } from '../state/events';
import type { GameState } from '../state/game';

export type Role = 'destination' | 'origin';

export interface Marker {
  seat: SeatId;
  name: string;
  role: Role;
}

/**
 * Which cities carry a baron's colour, and why.
 *
 * A baron's latest stop is where they are heading — the destination the roll
 * just produced. The stop before it is where they set out from. These are the
 * two ends of the trip, and that is all this function knows about.
 *
 * Nothing between them is lit *here*. The route is no longer unknown — the
 * player taps it out dot by dot and the committed leg is drawn as a trail in
 * the mover's colour — but it comes from the log's `moved` events, not from
 * the stops, and `MapView` draws it from `state.lastMove`. Lighting the dots
 * of a path from a pair of cities would still mean inventing one.
 *
 * A city can hold several markers — barons share destinations, and a baron's
 * own origin can be another's destination. Destinations sort first so a
 * renderer showing one colour shows the more important one.
 */
export function markers(state: GameState): Map<CityId, Marker[]> {
  const out = new Map<CityId, Marker[]>();

  const add = (city: CityId, marker: Marker) => {
    const list = out.get(city);
    if (list) list.push(marker);
    else out.set(city, [marker]);
  };

  for (const id of SEATS) {
    const seat = state.seats[id];
    if (seat.name === null || seat.stops.length === 0) continue;

    const destination = seat.stops[seat.stops.length - 1]!;
    add(destination.city, { seat: id, name: seat.name, role: 'destination' });

    const origin = seat.stops[seat.stops.length - 2];
    // A baron's first roll has no origin — they have not been anywhere else.
    // A roll that lands where they already stand (the home-town case) would
    // otherwise mark one city as both, so the destination alone stands.
    if (origin && origin.city !== destination.city) {
      add(origin.city, { seat: id, name: seat.name, role: 'origin' });
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => Number(b.role === 'destination') - Number(a.role === 'destination'));
  }
  return out;
}

/**
 * Which node each baron's pawn stands on. Several may share one — barons pass
 * through the same dots, and the order is seat order so the stack is stable
 * between renders rather than reshuffling as the game goes on.
 */
export function pawns(state: GameState): Map<NodeId, SeatId[]> {
  const out = new Map<NodeId, SeatId[]>();
  for (const id of SEATS) {
    const seat = state.seats[id];
    if (seat.name === null || seat.at === null) continue;
    const here = out.get(seat.at);
    if (here) here.push(id);
    else out.set(seat.at, [id]);
  }
  return out;
}
