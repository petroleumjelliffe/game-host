// The user-fee schedule as a pure derivation over what the log already
// holds (docs/rules/user-fees.md; spec Decision 2). Movement recorded its
// paths and charged nothing — route.ts's promise — and this is the file
// that prices them. Nothing here appends: a turn's bill is recomputable at
// replay from the paths and the ownership map, so a `feesPaid` event would
// be a second copy of derivable truth.
import { neighbours, type NodeId, type RailroadId } from '../../engine/index.js';
import type { SeatId } from './events.js';

export const BANK_FEE = 1000;
export const OWNER_FEE = 5000;
export const ALL_OWNED_FEE = 10000;
export const ROVER_PRIZE = 50000;

/**
 * The railroads on the section between two adjacent nodes. [] when no edge
 * joins them: a hand-edited log can name a teleporting path, and the fold
 * must fold it without throwing — no track used, nothing billed.
 */
export function sectionRailroads(a: NodeId, b: NodeId): readonly RailroadId[] {
  const edge = neighbours(a).find((one) => one.a === b || one.b === b);
  return edge?.railroads ?? [];
}

/**
 * Which company a shared section counts as: the one producing "the
 * cheapest legal bill for the mover (own line over any other; unowned over
 * other-owned; deterministic tie-break by railroad id)" — the spec's
 * words. ASSUMPTION, held pending the rulebook's own text on shared
 * trackage (spec, Still owed): the log keeps the full sets, so this is
 * revisitable without rewriting history.
 */
export function attributeSection(
  candidates: readonly RailroadId[],
  mover: SeatId,
  owners: ReadonlyMap<RailroadId, SeatId>,
): RailroadId | null {
  const rank = (id: RailroadId): number => {
    const owner = owners.get(id);
    return owner === mover ? 0 : owner === undefined ? 1 : 2;
  };
  let best: RailroadId | null = null;
  for (const id of candidates) {
    if (best === null || rank(id) < rank(best)
        || (rank(id) === rank(best) && id < best)) best = id;
  }
  return best;
}

export interface TurnBill {
  toBank: number;
  /** One fee per owner, not per line — confirmed 2026-08-23. */
  toOwners: ReadonlyMap<SeatId, number>;
}

export function turnBill(
  paths: readonly (readonly NodeId[])[],
  mover: SeatId,
  owners: ReadonlyMap<RailroadId, SeatId>,
  allOwned: boolean,
): TurnBill {
  let unowned = false;
  const others = new Set<SeatId>();
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const ridden = attributeSection(sectionRailroads(path[i - 1]!, path[i]!), mover, owners);
      if (ridden === null) continue;
      const owner = owners.get(ridden);
      if (owner === undefined) unowned = true;
      else if (owner !== mover) others.add(owner);
    }
  }
  const each = allOwned ? ALL_OWNED_FEE : OWNER_FEE;
  const toOwners = new Map<SeatId, number>();
  for (const owner of others) toOwners.set(owner, each);
  // Two ASSUMPTIONS, both marked in the transcription's "edges still open":
  // a turn wholly on the mover's own lines bills nothing, and other-owner
  // usage displaces the $1,000 bank fee rather than adding to it.
  return { toBank: others.size === 0 && unowned ? BANK_FEE : 0, toOwners };
}
