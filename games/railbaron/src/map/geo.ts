import { geoAlbers, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { EDGES, NODES, RAILROADS as LINES } from '../../engine';
import outline from '../data/us-outline.json';

export type NodeKind = 'city' | 'dot' | 'junction';

export interface Placed {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Present on cities only. */
  name?: string;
  cityId?: number;
}

export interface Layout {
  width: number;
  height: number;
  /** The nation's coastline as one SVG path string. */
  landPath: string;
  nodes: Placed[];
  byId: Map<string, Placed>;
  edges: readonly { a: string; b: string; railroads: readonly string[] }[];
}

/**
 * Twin lamps must not hide one another.
 *
 * San Francisco/Oakland, Minneapolis/St. Paul and Dallas/Fort Worth sit close
 * enough that at this scale one lamp covers the next. They are separate
 * destinations that pay differently — two of the three pairs are the board's
 * only $0 journeys — so a single visible lamp where there should be two is
 * worse than a few pixels of geographic licence.
 *
 * Cities are pushed apart; route dots are left exactly where the projection
 * puts them, because they carry no label and no meaning of their own.
 */
const MIN_CITY_GAP = 21;
const RELAX_PASSES = 90;

function separateCities(cities: Placed[]): void {
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = cities[i]!;
        const b = cities[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_CITY_GAP) continue;
        // Exactly coincident points have no direction to separate along, so
        // pick one rather than dividing by zero.
        if (dist < 0.01) { dx = 0.7; dy = 0.7; dist = 1; }
        const push = (MIN_CITY_GAP - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/**
 * The lamps as painted, as radii. `MapView` draws them from these, and the tap
 * targets below are sized against them, so the two cannot drift apart: a
 * target smaller than the bulb the player is aiming at is a target that misses
 * what they can see.
 */
export const CITY_R = 8.5;
export const DOT_R = 2.6;

/** The painted lamp a player aims at: the city's socket, or the dot's housing. */
export const visualRadius = (node: Placed): number =>
  node.kind === 'city' ? CITY_R * 1.06 : Math.max(DOT_R * 1.5, TARGET.min);

/**
 * How big a tap target may be, in the same pixels as x and y.
 *
 * A route dot is 2.6px across, which no fingertip can hit, so a tappable lamp
 * carries an invisible target far larger than its bulb. The question is what
 * bounds it — and the answer is not the map. Only the nodes offered *at the
 * same moment* can compete for a tap: a lamp that is not a candidate this leg
 * renders no target at all, so bounding each node against the nearest of all
 * 550 shrank targets against neighbours that were never tappable. That left 46
 * of the 67 cities with a target smaller than their own painted bulb — a tap
 * dead centre on a lamp you can see, refused.
 *
 * So the sizing happens per render, over the current candidates alone:
 *
 * - as large as a fingertip (`max`) wherever there is room;
 * - never below the lamp as painted, so a target never hides inside its own
 *   bulb — `max` is above every visual, so this holds unless the cap bites;
 * - and where two candidates are close, half the distance between them, so
 *   neither target can reach the other's centre.
 *
 * That last rule wins when they conflict: two targets swallowing each other's
 * centres means the later-drawn one quietly eats taps meant for the earlier,
 * which is the actual bug. A slightly small target is not. Cities are held
 * `MIN_CITY_GAP` apart, so two candidate cities never cap each other below
 * their bulbs — the twin pairs stay fully tappable.
 */
export const TARGET = { max: 13, min: 5 } as const;

export function sizeCandidates(candidates: readonly Placed[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of candidates) {
    let nearest = Infinity;
    for (const other of candidates) {
      if (other === node) continue;
      const distance = Math.hypot(other.x - node.x, other.y - node.y);
      if (distance < nearest) nearest = distance;
    }
    out.set(node.id, Math.min(TARGET.max, nearest / 2));
  }
  return out;
}

const isKind = (k: string): k is NodeKind => k === 'city' || k === 'dot' || k === 'junction';

/**
 * Projects the whole network into a box of the given size.
 *
 * `fitExtent` derives the scale and translation from the coastline rather
 * than from the network, so the land fills the cabinet the same way at every
 * size and the rails sit on it correctly at all of them.
 */
export function layout(width: number, height: number, inset = 74): Layout {
  const land = outline as unknown as GeoPermissibleObjects;
  const projection = geoAlbers().fitExtent(
    [[inset, inset], [width - inset, height - inset * 0.8]],
    land
  );
  const landPath = geoPath(projection)(land) ?? '';

  const nodes: Placed[] = [];
  for (const node of NODES) {
    const point = projection([node.lon, node.lat]);
    if (!point || !isKind(node.kind)) continue;
    nodes.push({
      id: node.id,
      kind: node.kind,
      x: point[0],
      y: point[1],
      ...(node.name !== undefined ? { name: node.name, cityId: node.cityId } : {})
    });
  }

  separateCities(nodes.filter(n => n.kind === 'city'));

  return {
    width,
    height,
    landPath,
    nodes,
    byId: new Map(nodes.map(n => [n.id, n])),
    edges: EDGES
  };
}

/** Railroad records, keyed by the id the edges carry. Re-exported so the map
 *  has one import for the network rather than two. */
export const RAILROADS = LINES;
