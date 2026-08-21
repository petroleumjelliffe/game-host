import {
  isRejection, legalSteps, stepTo,
  type Rejection, type Step, type Trip
} from './movement.js';
import { nodeById, sectionKey, type NodeId, type RailroadId } from './network.js';

/**
 * A route being tapped out, and never anything more than that. It lives in
 * screen state, so undo is `steps.slice(0, -1)` and costs nothing to design;
 * the log hears about the turn once, when it is committed.
 */
export interface Draft {
  readonly from: NodeId;
  readonly destination: NodeId;
  /** Dots this leg may spend. */
  readonly rolled: number;
  /** Sections already used earlier in this trip, on previous turns. */
  readonly before: ReadonlyMap<string, number>;
  readonly steps: readonly Step[];
}

export const startDraft = (
  from: NodeId, destination: NodeId, rolled: number,
  before: ReadonlyMap<string, number> = new Map()
): Draft => ({ from, destination, rolled, before, steps: [] });

export const path = (draft: Draft): NodeId[] =>
  [draft.from, ...draft.steps.map(step => step.to)];

export const here = (draft: Draft): NodeId =>
  draft.steps[draft.steps.length - 1]?.to ?? draft.from;

export const spent = (draft: Draft): number =>
  draft.steps.reduce((total, step) => total + step.cost, 0);

export const remaining = (draft: Draft): number => draft.rolled - spent(draft);

export const arrived = (draft: Draft): boolean => here(draft) === draft.destination;

export function usedAfter(draft: Draft): Map<string, number> {
  const used = new Map(draft.before);
  const nodes = path(draft);
  for (let i = 1; i < nodes.length; i++) {
    const key = sectionKey(nodes[i - 1]!, nodes[i]!);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return used;
}

/**
 * Null once the pawn is standing on a dot — any line may be boarded there.
 * A junction carries the last step's companies forward, which is the whole of
 * "he can change rail lines only at a dot".
 */
export function rideNow(draft: Draft): readonly RailroadId[] | null {
  const last = draft.steps[draft.steps.length - 1];
  if (!last) return null;
  return nodeById(last.to).kind === 'junction' ? last.ride : null;
}

export const tripOf = (draft: Draft): Trip => ({
  from: here(draft),
  destination: draft.destination,
  remaining: remaining(draft),
  used: usedAfter(draft),
  ride: rideNow(draft)
});

export const options = (draft: Draft): Step[] => legalSteps(tripOf(draft));

/** A place the pawn may be tapped to, and every step it takes to get there. */
export interface Reach {
  to: NodeId;
  /** One step to a neighbouring dot or city; more when junctions lie between. */
  readonly via: readonly Step[];
}

/**
 * Every **place** the pawn can reach from where it stands — dots and cities,
 * never junctions.
 *
 * A junction is where a printed line forks or bends. Nothing is drawn there
 * and the player cannot tap one, so a junction is not a destination for a tap
 * but a thing a tap passes through: the search walks on through it and offers
 * the dots on the far side instead. At a genuine fork that means each branch's
 * first real dot is offered separately, which is exactly the choice the
 * printed board asks the player to make.
 *
 * The walk extends the draft at every hop rather than reading adjacency, so
 * each intermediate step is judged by the real rules — the section already
 * spent, the company the run is committed to since the last dot, the
 * destination it must not be stranded from.
 *
 * `seen` is per-branch and guards against a graph whose bend points adjoin:
 * two of those would hand the pawn back and forth, since their shared edge
 * may carry several railroads and a re-crossing would be perfectly legal. No
 * junction in the shipped network touches another — all twelve have only dot
 * and city neighbours, so no chain here is longer than two steps — which
 * makes the guard defensive rather than load-bearing. It costs one set.
 */
export function tappable(draft: Draft): Reach[] {
  const best = new Map<NodeId, Step[]>();

  const walk = (from: Draft, via: readonly Step[], seen: ReadonlySet<NodeId>): void => {
    for (const step of options(from)) {
      if (seen.has(step.to)) continue;
      const chain = [...via, step];
      if (nodeById(step.to).kind === 'junction') {
        const through = extend(from, step.to);
        // Unreachable: `step` came from options(), which is stepTo() over the
        // same trip. Kept so a future change to either cannot throw here.
        if (isRejection(through)) continue;
        walk(through, chain, new Set([...seen, step.to]));
        continue;
      }
      // Two chains can arrive at the same dot round opposite sides of a fork.
      // The shorter walk wins — a direct edge beats the same dot reached the
      // long way round — and equal lengths keep the one found first, so the
      // result is stable between renders.
      const known = best.get(step.to);
      if (known === undefined || chain.length < known.length) best.set(step.to, chain);
    }
  };

  walk(draft, [], new Set([here(draft)]));
  return [...best].map(([to, via]) => ({ to, via }));
}

export function extend(draft: Draft, to: NodeId): Draft | Rejection {
  const step = stepTo(tripOf(draft), to);
  if (isRejection(step)) return step;
  return { ...draft, steps: [...draft.steps, step] };
}

export const back = (draft: Draft): Draft =>
  draft.steps.length === 0 ? draft : { ...draft, steps: draft.steps.slice(0, -1) };

/**
 * "A player must always move the full number of dots that he rolls, whether
 * he wants to or not, until he arrives at his destination city." That is a
 * property of the finished route rather than of each step along it, which is
 * why it is checked here and not on every tap.
 *
 * The junction clause is the other half of the same sentence: a junction is
 * not a dot, so a pawn cannot be left standing on one. Stepping off it is
 * free, so this never traps anybody — it only refuses to call the turn done.
 */
export function complete(draft: Draft): boolean {
  if (nodeById(here(draft)).kind === 'junction') return false;
  return arrived(draft) || spent(draft) === draft.rolled;
}

/**
 * Which companies this leg's movement could have ridden. Fees are settled at
 * end of turn and depend on exactly this, so movement records it and charges
 * nothing — the money spec prices it.
 *
 * A step across shared trackage names every company on it rather than one,
 * because the player was never asked to choose. The money spec will have to
 * decide what to do with that; recording the set loses nothing it could need.
 */
export function companies(draft: Draft): RailroadId[] {
  const out = new Set<RailroadId>();
  for (const step of draft.steps) for (const id of step.ride) out.add(id);
  return [...out];
}
