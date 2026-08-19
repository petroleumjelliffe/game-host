import { CITIES } from './cities';
import raw from './network.json';
import type { CityId } from './types';

export type NodeId = string;
export type RailroadId = string;
export type NodeKind = 'city' | 'dot' | 'junction';

export interface NetworkNode {
  id: NodeId;
  kind: NodeKind;
  lat: number;
  lon: number;
  /** Cities only. */
  name?: string;
  cityId?: CityId;
}

export interface NetworkEdge {
  a: NodeId;
  b: NodeId;
  /** Shared trackage is one edge carrying several railroads, not parallel edges. */
  railroads: readonly RailroadId[];
}

export interface Railroad {
  id: RailroadId;
  name: string;
  cost: number;
  color: string;
}

export const NODES: readonly NetworkNode[] = raw.nodes as NetworkNode[];
export const EDGES: readonly NetworkEdge[] = raw.edges as NetworkEdge[];
export const RAILROADS: ReadonlyMap<RailroadId, Railroad> =
  new Map((raw.railroads as Railroad[]).map(line => [line.id, line]));

const BY_ID = new Map(NODES.map(node => [node.id, node]));

export function nodeById(id: NodeId): NetworkNode {
  const node = BY_ID.get(id);
  if (!node) throw new Error(`no such node: ${id}`);
  return node;
}

const NODE_FOR_CITY = new Map<CityId, NodeId>(
  NODES.filter(node => node.cityId !== undefined).map(node => [node.cityId!, node.id])
);

export function nodeForCity(city: CityId): NodeId {
  const id = NODE_FOR_CITY.get(city);
  if (id === undefined) throw new Error(`no node carries city ${city}`);
  return id;
}

export const cityAt = (id: NodeId): CityId | null => nodeById(id).cityId ?? null;

const ADJACENT = new Map<NodeId, NetworkEdge[]>();
for (const edge of EDGES) {
  for (const end of [edge.a, edge.b]) {
    const list = ADJACENT.get(end);
    if (list) list.push(edge);
    else ADJACENT.set(end, [edge]);
  }
}

export const neighbours = (id: NodeId): readonly NetworkEdge[] => ADJACENT.get(id) ?? [];

/**
 * One section of rail, named the same whichever way it is walked. `used` maps
 * these to a count, which is what makes "each section can be used only once
 * per trip" a lookup rather than a search.
 */
export const sectionKey = (a: NodeId, b: NodeId): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * "Each pair of twin cities (Oakland–San Francisco, Minneapolis–St. Paul)
 * count as one dot for the pair." Two pairs, named by the book — Dallas and
 * Fort Worth are drawn close together and are not one of them.
 *
 * Looked up by name against the engine's own city table rather than written
 * as node ids, so a rebuilt network that renumbered a city fails here at
 * import rather than silently charging for a free step.
 */
const TWIN_NAMES: readonly (readonly [string, string])[] = [
  ['San Francisco', 'Oakland'],
  ['Minneapolis', 'St. Paul']
];

export const TWIN_PAIRS: readonly (readonly [NodeId, NodeId])[] = TWIN_NAMES.map(pair =>
  pair.map(name => {
    const city = CITIES.find(candidate => candidate.name === name);
    if (!city) throw new Error(`no city named ${name} — the twin pairs are out of date`);
    return nodeForCity(city.id);
  }) as [NodeId, NodeId]
);

export const isTwinStep = (a: NodeId, b: NodeId): boolean =>
  TWIN_PAIRS.some(([one, two]) => (a === one && b === two) || (a === two && b === one));
