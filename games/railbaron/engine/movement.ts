import {
  isTwinStep, neighbours, nodeById, sectionKey,
  type NetworkEdge, type NodeId
} from './network.js';
import type { RailroadId } from './network.js';

/**
 * What one step costs, in dots.
 *
 * The cost model falls out of the graph rather than being enforced on top of
 * it. "Cities (black squares) count as dots" — so a city costs one. A
 * junction is not on the board at all, it is where a printed line forks or
 * bends, so it costs nothing and needs no special case elsewhere. "Each pair
 * of twin cities count as one dot for the pair" — so crossing between the two
 * members of a pair is free, having already been paid for on the way in.
 */
export function stepCost(from: NodeId, to: NodeId): number {
  if (isTwinStep(from, to)) return 0;
  return nodeById(to).kind === 'junction' ? 0 : 1;
}

export function pathCost(path: readonly NodeId[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += stepCost(path[i - 1]!, path[i]!);
  return total;
}

/**
 * "Each section of rail can be used only once per trip." A section is one
 * company's track, and shared trackage is drawn as one edge carrying several
 * railroads — so a stretch with three companies on it may be crossed three
 * times, each time on a different line, which is exactly what the book allows:
 * the pawn "may move between the same two dots again, as long as it uses a
 * different rail line."
 *
 * This counts crossings rather than naming which company each one rode. Where
 * that is loose: it does not check that a re-crossing rode a *different*
 * company from the first, only that a different one was available. Pairing
 * each crossing with a company would need the player to declare one at every
 * step, and the case where it matters — re-crossing shared trackage on the
 * same line while a junction constrains which line that is — is rare enough
 * that the interrogation costs more than the looseness does.
 */
export function sectionsLeft(edge: NetworkEdge, used: ReadonlyMap<string, number>): number {
  return edge.railroads.length - (used.get(sectionKey(edge.a, edge.b)) ?? 0);
}

export function useSection(
  used: ReadonlyMap<string, number>, a: NodeId, b: NodeId
): Map<string, number> {
  const next = new Map(used);
  const key = sectionKey(a, b);
  next.set(key, (next.get(key) ?? 0) + 1);
  return next;
}

/**
 * Stranding, which the book states as a rule about reachability: "If moving
 * to a particular dot would mean that a pawn could not get to its destination
 * city without going over the same rail section twice, then the pawn cannot
 * move to that particular dot."
 *
 * So: is the destination reachable at all over sections not yet spent? A
 * breadth-first search answers it, and its cost does not depend on how much
 * movement is left — which is why this can run on every tap and why a roll
 * totalling 18 is no harder than one totalling 12.
 *
 * It ignores the company-at-a-junction rule deliberately. Honouring that would
 * make this a search over (node, company) pairs to rule out routes a player
 * could not have taken anyway; the book's own phrasing is about sections, and
 * the looser answer only ever permits a tap that a later tap would refuse.
 */
export function canReach(
  from: NodeId, destination: NodeId, used: ReadonlyMap<string, number>
): boolean {
  if (from === destination) return true;
  const seen = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const edge of neighbours(at)) {
      if (sectionsLeft(edge, used) <= 0) continue;
      const other = edge.a === at ? edge.b : edge.a;
      if (other === destination) return true;
      if (seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  return false;
}

/** Why a candidate step was refused. Every one of these is a rulebook rule. */
export type Rejection =
  | 'not-a-neighbour'
  | 'section-used'
  | 'wrong-company'
  | 'no-movement-left'
  | 'would-strand'
  | 'already-arrived';

export const isRejection = (value: unknown): value is Rejection => typeof value === 'string';

export interface Trip {
  from: NodeId;
  destination: NodeId;
  /** Dots still unspent this leg. */
  remaining: number;
  used: ReadonlyMap<string, number>;
  /**
   * The companies still consistent with the run since the last dot, or null
   * when standing on one.
   *
   * "A player may change rail lines any number of times, but he can change
   * rail lines only at a dot." An edge may carry several companies, so a run
   * across a junction does not name one company — it narrows a set. Null at a
   * dot means any line may be boarded; a set means the run must stay inside it
   * until the next dot, and an empty intersection is the company change the
   * book forbids.
   */
  ride: readonly RailroadId[] | null;
}

export interface Step {
  to: NodeId;
  cost: number;
  /** The companies this step could have ridden. */
  ride: readonly RailroadId[];
}

export function stepTo(trip: Trip, to: NodeId): Step | Rejection {
  // "As soon as his pawn reaches its destination city, it must stop
  // immediately — any extra movement is just lost."
  if (trip.from === trip.destination) return 'already-arrived';

  const edge = neighbours(trip.from).find(one => one.a === to || one.b === to);
  if (!edge) return 'not-a-neighbour';
  if (sectionsLeft(edge, trip.used) <= 0) return 'section-used';

  const ride = trip.ride === null
    ? edge.railroads
    : edge.railroads.filter(id => trip.ride!.includes(id));
  if (ride.length === 0) return 'wrong-company';

  const cost = stepCost(trip.from, to);
  if (cost > trip.remaining) return 'no-movement-left';

  if (to !== trip.destination && !canReach(to, trip.destination, useSection(trip.used, trip.from, to))) {
    return 'would-strand';
  }

  return { to, cost, ride: [...ride] };
}

/**
 * No early return on `remaining === 0`: a free step is still legal with
 * nothing left, which is how a pawn that has spent its whole roll crosses
 * into the other half of a twin pair or off a junction onto a dot.
 */
export function legalSteps(trip: Trip): Step[] {
  const out: Step[] = [];
  for (const edge of neighbours(trip.from)) {
    const to = edge.a === trip.from ? edge.b : edge.a;
    const step = stepTo(trip, to);
    if (!isRejection(step)) out.push(step);
  }
  return out;
}
