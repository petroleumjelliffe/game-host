# Turns and Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model a Rail Baron turn — roll the dice, walk the pawn along the map graph under the rulebook's movement rules, commit the turn as one event — so the app referees the game instead of assisting it.

**Architecture:** A pure movement engine under `engine/` answers one question per tap ("from here, with this much left, which nodes are legal?") using the printed map as a graph; the React layer holds the half-built route as screen state and appends exactly one `moved` event per leg when the player commits. Everything displayed is still derived by replaying the event log, so a second tab following the same log stays in step.

**Tech Stack:** TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), React 19, Vite 8, Vitest 4 (two projects: `engine` under node, `app` under jsdom).

**Spec:** [docs/superpowers/specs/2026-08-13-turns-and-movement-design.md](../specs/2026-08-13-turns-and-movement-design.md). Read it before Task 1; the rules table there is quoted from the rulebook and is the authority for every number below.

## Global Constraints

- **`payout: 0` is a real payout; `payout: null` means HOME.** Never `if (payout)`, never `payout || fallback`. The two zero-paying journeys are Minneapolis↔St. Paul and San Francisco↔Oakland.
- **The event log is the single source of truth.** Every displayed value is derived by replaying it. Never store a value an event already implies.
- **`engine/` has no React and no DOM.** `engine/smoke.test.ts` asserts `window === undefined`; an import that breaks it fails a test rather than shipping.
- **A roll is not told until the board has finished announcing it.** `useGame.roll` returns an outcome and appends nothing; `commitRoll` is the only thing that appends. Do not add a second path into the log that bypasses this.
- **Prove a new test can fail by breaking the code and reading real output** — never by reading the assertion. Every task's "run it to see it fail" step means running it.
- **Node ids are strings** (`d12`, `c40`) and are positional in the source data. Never renumber, never derive meaning from the number.
- **The two twin pairs for movement cost are Oakland–San Francisco and Minneapolis–St. Paul only.** Dallas–Fort Worth is drawn close on the map and is *not* a twin pair; `src/map/geo.ts` separates all three visually and that is a different concern.
- **Paths under the home directory are written `~/...`** in commands and prose.
- Commands: `npm test`, `npm run typecheck`. A single file: `npx vitest run <path>`.

---

## File Structure

**Moved (Task 1):**

| From | To | Why |
|---|---|---|
| `src/data/network.json` | `engine/network.json` | The graph is game data. The engine owns game data; the map is a consumer. An engine that imports from `src/` has the dependency backwards. |
| `src/data/network.test.ts` | `engine/network.test.ts` | Follows its subject into the node project. |

`src/data/us-outline.json` stays where it is — a coastline is presentation, not rules.

**Created:**

| File | Responsibility |
|---|---|
| `engine/network.ts` | The graph as typed data: nodes, edges, railroads, adjacency, section keys, the twin pairs. No rules. |
| `engine/movement.ts` | The cost model, section reuse, the company-at-a-junction rule, reachability, and `stepTo`/`legalSteps`. The whole rulebook of movement, and nothing else. |
| `engine/route.ts` | A half-built route (`Draft`) and the operations on it: extend, undo, spent, complete. |
| `engine/dice.ts` | Two white dice, the bonus die and who earns it, and whether a bonus leg is owed. |
| `engine/golden/types.ts` | The shape of a golden game. |
| `engine/golden/runner.ts` | Replays a golden game against the engine. |
| `engine/golden/games.ts` | The games themselves — the executable rules spec. |
| `engine/golden/golden.test.ts` | Runs every game. |
| `src/state/turns.ts` | Accessors over replayed state that the screens and `useGame` share: whose turn, where a pawn stands, whether a destination is owed. |
| `src/board/screens/homes.ts` | The `homes` phase screen: home cities, then the roll for first player. |
| `src/board/Dice.tsx` | The shared dice readout — two white slots and a bonus slot that stays empty when unearned. |
| `src/map/useRoute.ts` | The draft route as screen state, and the tap handler that extends it. |
| `src/map/usePlayback.ts` | Walks an index along a committed path so the pawn can be watched moving. |

**Modified:**

| File | Change |
|---|---|
| `engine/index.ts` | Re-export the new modules. |
| `engine/roll.ts` | `rollDestination` takes the home cities already taken and rerolls off them. |
| `scripts/build-network.mjs` | Writes `engine/network.json`. |
| `src/map/geo.ts` | Reads the graph from `engine` rather than `src/data`. |
| `src/state/events.ts` | Three new event types and their validators. |
| `src/state/game.ts` | `phase` gains `homes`; replay derives pawn position, used sections, play order and whose turn it is. |
| `src/state/useGame.ts` | The turn API, and a `storage` listener so a second tab follows the log. |
| `src/board/types.ts` | `ScreenDef` gains an optional `dice` field. |
| `src/board/Board.tsx` | Renders `Dice` in the header when a screen supplies it. |
| `src/board/screens/play.ts` | Rows show whose turn it is; only that baron's row is live. |
| `src/map/lit.ts` | `pawns(state)` — where each baron's pawn stands, by node. |
| `src/map/MapView.tsx` | Tappable lit nodes, pawns, the turn HUD, playback. |
| `src/App.tsx` | Routes the `homes` phase, and wires the turn API into the map. |

---

## Two spec details this plan resolves

The spec left two things implied rather than stated. Both are decided here so no task has to invent them.

**1. A fourth event, `orderRolled`.** The spec's State section names three log changes but its Setup section requires the first player to be recorded ("The app rolls this once and records the resulting order, so a replayed game deals the same turns"). That needs an event. `orderRolled { first: SeatId }` is it, and it is also what moves the game from `homes` to `playing`.

This makes the phase derivation, and the migration of already-saved games, fall out with no migration code at all:

| Log contains | Phase |
|---|---|
| no `started` | `setup` |
| `started`, no `orderRolled` | `homes` |
| `orderRolled` | `playing` |

A game saved by v1.0.1 has `started` and no `orderRolled`, so it resumes in `homes` with every baron's home city already rolled — and the only thing left to do is roll for first player. `SAVE_VERSION` does not change and nothing is discarded.

**2. `arrived` keeps its name and its meaning.** Under Phase 4 it fires when a *destination is rolled*, not when the pawn gets there — which is now a slightly wrong name. Renaming it would break the save format and touch eight files for a word. It stays, and arrival at the destination is carried by `moved.arrived` instead. Note this in the type's doc comment so the next reader is not misled.

---

## Task 1: The network moves into the engine

The movement rules need the graph, and `engine/` must not import from `src/`. Moving the data is the whole task; nothing about it changes.

**Files:**
- Move: `src/data/network.json` → `engine/network.json`
- Move: `src/data/network.test.ts` → `engine/network.test.ts`
- Create: `engine/network.ts`
- Create: `engine/network.access.test.ts`
- Modify: `engine/index.ts`
- Modify: `src/map/geo.ts:2` (the import), `src/map/geo.ts:95-120`
- Modify: `scripts/build-network.mjs:37`, `:185`, `:330`, `:364`

**Interfaces:**
- Produces: `NodeId = string`, `RailroadId = string`, `NodeKind = 'city' | 'dot' | 'junction'`, `NetworkNode`, `NetworkEdge`, `Railroad`, `NODES`, `EDGES`, `RAILROADS`, `nodeById(id): NetworkNode`, `nodeForCity(city: CityId): NodeId`, `cityAt(id: NodeId): CityId | null`, `neighbours(id): readonly NetworkEdge[]`, `sectionKey(a, b): string`, `TWIN_PAIRS`, `isTwinStep(a, b): boolean`.

- [ ] **Step 1: Move the data and its test**

```bash
git mv src/data/network.json engine/network.json
git mv src/data/network.test.ts engine/network.test.ts
```

- [ ] **Step 2: Fix the moved test's imports**

In `engine/network.test.ts`, change the engine import (it was reaching up two directories) to a sibling import:

```ts
import { CITIES, cityById } from './index';
import network from './network.json';
```

Leave every assertion alone.

- [ ] **Step 3: Run the moved test**

Run: `npx vitest run engine/network.test.ts`
Expected: PASS. It now runs under the `engine` project rather than `app`.

- [ ] **Step 4: Write the failing test for the access layer**

Create `engine/network.access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CITIES } from './cities';
import {
  EDGES, NODES, RAILROADS, TWIN_PAIRS, cityAt, isTwinStep,
  neighbours, nodeById, nodeForCity, sectionKey
} from './network';

describe('the network access layer', () => {
  it('carries every node and edge from the built graph', () => {
    expect(NODES).toHaveLength(550);
    expect(EDGES).toHaveLength(710);
    expect(RAILROADS.size).toBe(28);
  });

  it('finds a node by id and refuses one that was never real', () => {
    expect(nodeById('c13').name).toBe('Minneapolis');
    expect(() => nodeById('d99999')).toThrow(/d99999/);
  });

  it('maps every city id to its node and back', () => {
    for (const city of CITIES) {
      expect(cityAt(nodeForCity(city.id))).toBe(city.id);
    }
  });

  it('reports a dot as carrying no city', () => {
    expect(cityAt('d0')).toBeNull();
  });

  it('lists the edges at a node, in both directions', () => {
    const stPaul = neighbours('c95');
    expect(stPaul).toHaveLength(1);
    expect(stPaul[0]!.railroads).toEqual(
      expect.arrayContaining(['C&NW', 'CMStP&P', 'NP', 'GN'])
    );
  });

  it('keys a section the same whichever way it is walked', () => {
    expect(sectionKey('c13', 'c95')).toBe(sectionKey('c95', 'c13'));
    expect(sectionKey('c13', 'c95')).not.toBe(sectionKey('c13', 'd66'));
  });

  it('knows the two twin pairs the rulebook names, and no others', () => {
    expect(TWIN_PAIRS).toHaveLength(2);
    expect(isTwinStep(nodeForCity(43), nodeForCity(47))).toBe(true);   // Minneapolis/St. Paul
    expect(isTwinStep(nodeForCity(65), nodeForCity(60))).toBe(true);   // San Francisco/Oakland
    expect(isTwinStep(nodeForCity(29), nodeForCity(30))).toBe(false);  // Dallas/Fort Worth
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npx vitest run engine/network.access.test.ts`
Expected: FAIL — `Failed to resolve import "./network"`.

- [ ] **Step 6: Write the access layer**

Create `engine/network.ts`:

```ts
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
```

- [ ] **Step 7: Run it to see it pass**

Run: `npx vitest run engine/network.access.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Re-export from the engine's index**

Append to `engine/index.ts`:

```ts
export {
  EDGES, NODES, RAILROADS, TWIN_PAIRS, cityAt, isTwinStep,
  neighbours, nodeById, nodeForCity, sectionKey
} from './network';
export type { NetworkEdge, NetworkNode, NodeId, NodeKind, Railroad, RailroadId } from './network';
```

- [ ] **Step 9: Point the map at the engine**

In `src/map/geo.ts`, replace the `network` import (line 2) with:

```ts
import { EDGES, NODES, RAILROADS as LINES } from '../../engine';
```

Then, in `layout()`, iterate `NODES` instead of `network.nodes`, return `edges: EDGES` instead of `network.edges`, and replace the module-level `RAILROADS` export at the bottom of the file with:

```ts
/** Railroad records, keyed by the id the edges carry. Re-exported so the map
 *  has one import for the network rather than two. */
export const RAILROADS = LINES;
```

Delete the now-unused local `NetworkNode` interface only if nothing else in the file references it; `layout` can type its loop as `for (const node of NODES)`.

- [ ] **Step 10: Point the build script at the engine**

In `scripts/build-network.mjs`, change line 37 to `const OUT = 'engine/network.json';`, change the `mkdirSync('src/data', ...)` call to `mkdirSync('engine', { recursive: true });`, and update the two comments that name `src/data/network.json` (around lines 185 and 330) to say `engine/network.json`.

- [ ] **Step 11: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — 215 tests (208 before, plus this task's 7). No file under `src/data/` is named `network.json` any more.

- [ ] **Step 12: Commit**

```bash
git add engine/ src/map/geo.ts scripts/build-network.mjs
git commit -m "refactor: the map graph moves into the engine

The movement rules need the graph and engine/ must not import from src/.
Adds engine/network.ts: adjacency, section keys, and the two twin pairs the
rulebook names, looked up by city name so a renumbered network fails at
import rather than charging for a free step.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The cost model, section reuse, and reachability

Three rules that stand on their own, and the stranding check that the spec singles out as the one thing that runs on every tap.

**Files:**
- Create: `engine/movement.ts`
- Create: `engine/movement.test.ts`

**Interfaces:**
- Consumes: `neighbours`, `nodeById`, `nodeForCity`, `sectionKey`, `isTwinStep`, `NetworkEdge`, `NodeId` from `./network`.
- Produces: `stepCost(from: NodeId, to: NodeId): number`, `pathCost(path: readonly NodeId[]): number`, `sectionsLeft(edge: NetworkEdge, used: ReadonlyMap<string, number>): number`, `useSection(used, a, b): Map<string, number>`, `canReach(from: NodeId, destination: NodeId, used: ReadonlyMap<string, number>): boolean`.

- [ ] **Step 1: Write the failing test**

Create `engine/movement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { neighbours, nodeForCity, sectionKey } from './network';
import { canReach, pathCost, sectionsLeft, stepCost, useSection } from './movement';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);
const SAN_FRANCISCO = nodeForCity(65);
const OAKLAND = nodeForCity(60);
const DALLAS = nodeForCity(29);
const FORT_WORTH = nodeForCity(30);

describe('what a step costs', () => {
  it('charges one dot for a route dot', () => {
    expect(stepCost('c13', 'd66')).toBe(1);
  });

  it('charges one dot for a city, because cities count as dots', () => {
    expect(stepCost(DALLAS, FORT_WORTH)).toBe(1);
  });

  it('charges nothing for a junction, because a junction is not a dot', () => {
    const junction = 'j0';
    expect(stepCost('c13', junction)).toBe(0);
  });

  it('charges nothing to cross between twin cities', () => {
    expect(stepCost(MINNEAPOLIS, ST_PAUL)).toBe(0);
    expect(stepCost(ST_PAUL, MINNEAPOLIS)).toBe(0);
    expect(stepCost(SAN_FRANCISCO, OAKLAND)).toBe(0);
    expect(stepCost(OAKLAND, SAN_FRANCISCO)).toBe(0);
  });

  it('sums a whole path', () => {
    expect(pathCost([MINNEAPOLIS, ST_PAUL])).toBe(0);
    expect(pathCost(['c13', 'd66'])).toBe(1);
    expect(pathCost([])).toBe(0);
  });
});

describe('how much of a section is left', () => {
  it('counts one crossing per railroad on the section', () => {
    const edge = neighbours(MINNEAPOLIS).find(e => e.a === ST_PAUL || e.b === ST_PAUL)!;
    expect(edge.railroads.length).toBe(4);
    expect(sectionsLeft(edge, new Map())).toBe(4);
    expect(sectionsLeft(edge, new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]))).toBe(0);
  });

  it('records a crossing without disturbing the map it was given', () => {
    const before = new Map<string, number>();
    const after = useSection(before, 'c13', 'd66');
    expect(before.size).toBe(0);
    expect(after.get(sectionKey('c13', 'd66'))).toBe(1);
    expect(useSection(after, 'd66', 'c13').get(sectionKey('c13', 'd66'))).toBe(2);
  });
});

describe('whether the destination can still be reached', () => {
  it('says yes when nothing has been used', () => {
    expect(canReach(MINNEAPOLIS, DALLAS, new Map())).toBe(true);
  });

  it('says yes when already standing on it', () => {
    expect(canReach(DALLAS, DALLAS, new Map())).toBe(true);
  });

  it('says no once the only way out has been spent', () => {
    // St. Paul is a spur: its single section is the only way in or out, and
    // it carries four railroads, so four crossings exhaust it.
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(canReach(ST_PAUL, DALLAS, used)).toBe(false);
  });

  it('still says yes with the spur partly spent', () => {
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 3]]);
    expect(canReach(ST_PAUL, DALLAS, used)).toBe(true);
  });
});
```

The junction id in the third test is a guess; before running, find a real one and a real neighbour of it with:

```bash
node -e "
const n=require('./engine/network.json');
const j=n.nodes.find(x=>x.kind==='junction');
const e=n.edges.find(x=>x.a===j.id||x.b===j.id);
console.log(j.id, e.a, e.b);
"
```

Use the printed ids in place of `'c13'` and `'j0'` in that test.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run engine/movement.test.ts`
Expected: FAIL — `Failed to resolve import "./movement"`.

- [ ] **Step 3: Write the cost model and reachability**

Create `engine/movement.ts`:

```ts
import {
  isTwinStep, neighbours, nodeById, sectionKey,
  type NetworkEdge, type NodeId
} from './network';

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
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run engine/movement.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the twin rule is load-bearing**

Temporarily change `stepCost` to `if (false && isTwinStep(from, to)) return 0;` and re-run.
Expected: FAIL on "charges nothing to cross between twin cities" with `expected 1 to be 0`. Restore the line.

- [ ] **Step 6: Commit**

```bash
git add engine/movement.ts engine/movement.test.ts
git commit -m "feat: the movement cost model and the stranding check

A junction costs nothing because it is not a dot; the two twin pairs cost
nothing to cross because the pair is one dot. Stranding is reachability over
unspent sections, so its cost does not depend on how much movement is left.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Legal steps, and why a step was refused

The per-tap question. One function decides a single candidate and names its reason for refusing; the plural form is that function over every neighbour.

**Files:**
- Modify: `engine/movement.ts` (append)
- Modify: `engine/movement.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: `type Rejection`, `isRejection(value): value is Rejection`, `interface Trip { from, destination, remaining, used, ride }`, `interface Step { to, cost, ride }`, `stepTo(trip: Trip, to: NodeId): Step | Rejection`, `legalSteps(trip: Trip): Step[]`.

- [ ] **Step 1: Write the failing test**

Append to `engine/movement.test.ts`:

```ts
import { legalSteps, sectionsLeft as _left, stepTo, type Trip } from './movement';

const trip = (over: Partial<Trip>): Trip => ({
  from: 'c13', destination: DALLAS, remaining: 6, used: new Map(), ride: null, ...over
});

describe('a single candidate step', () => {
  it('refuses a node that is not next door', () => {
    expect(stepTo(trip({}), DALLAS)).toBe('not-a-neighbour');
  });

  it('refuses a section whose every railroad has been ridden', () => {
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(stepTo(trip({ from: MINNEAPOLIS, used }), ST_PAUL)).toBe('section-used');
  });

  it('refuses a step that costs more than is left', () => {
    expect(stepTo(trip({ remaining: 0 }), 'd66')).toBe('no-movement-left');
  });

  it('allows a free step with nothing left, because it costs no dots', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, destination: DALLAS, remaining: 0 }), ST_PAUL);
    expect(step).toEqual({ to: ST_PAUL, cost: 0, ride: expect.any(Array) });
  });

  it('refuses every step once the destination is underfoot', () => {
    expect(stepTo(trip({ from: DALLAS, destination: DALLAS }), FORT_WORTH))
      .toBe('already-arrived');
    expect(legalSteps(trip({ from: DALLAS, destination: DALLAS }))).toEqual([]);
  });

  it('refuses a step that would strand the pawn', () => {
    // Standing on Minneapolis with St. Paul as the destination, three of the
    // spur's four railroads already ridden: stepping away and back is legal,
    // but a step that used the last one would leave no way in.
    const used = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 4]]);
    expect(stepTo(trip({ from: MINNEAPOLIS, destination: ST_PAUL, used }), 'd66'))
      .toBe('would-strand');
  });

  it('reports which companies the step could have ridden', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, destination: DALLAS }), ST_PAUL);
    expect(step).not.toBe('section-used');
    expect((step as { ride: string[] }).ride).toEqual(
      expect.arrayContaining(['C&NW', 'CMStP&P', 'NP', 'GN'])
    );
  });
});

describe('changing company', () => {
  it('lets any company be boarded at a dot', () => {
    expect(trip({ ride: null }).ride).toBeNull();
    const steps = legalSteps(trip({ from: MINNEAPOLIS, ride: null }));
    expect(steps.length).toBeGreaterThan(1);
  });

  it('refuses a company change while standing on a junction', () => {
    const step = stepTo(trip({ from: MINNEAPOLIS, ride: ['NOT-A-REAL-LINE'] }), ST_PAUL);
    expect(step).toBe('wrong-company');
  });
});

describe('every legal step from here', () => {
  it('is the candidates that were not refused', () => {
    const here = trip({ from: MINNEAPOLIS });
    const all = neighbours(MINNEAPOLIS).map(e => (e.a === MINNEAPOLIS ? e.b : e.a));
    const legal = legalSteps(here).map(s => s.to);
    for (const to of all) {
      const one = stepTo(here, to);
      expect(legal.includes(to)).toBe(typeof one !== 'string');
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run engine/movement.test.ts`
Expected: FAIL — `stepTo is not a function`.

- [ ] **Step 3: Write it**

Append to `engine/movement.ts`:

```ts
import type { RailroadId } from './network';

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
```

Delete the unused `sectionsLeft as _left` alias from the test's import line before running.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run engine/movement.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Prove the stranding check is load-bearing**

Temporarily replace the `would-strand` guard's condition with `false &&` and re-run.
Expected: FAIL on "refuses a step that would strand the pawn" — it returns a Step object instead of the string. Restore it.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/movement.ts engine/movement.test.ts
git commit -m "feat: which taps are legal, and why one was refused

stepTo names its reason so the interface can explain a refusal rather than
just ignoring the tap, and legalSteps is that function over every neighbour —
one rulebook, one implementation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Dice, the bonus die, and home cities that cannot collide

Two small rule modules that nothing else depends on, done together because both are the dice layer.

**Files:**
- Create: `engine/dice.ts`
- Create: `engine/dice.test.ts`
- Modify: `engine/roll.ts:22-35`
- Modify: `engine/roll.test.ts` (append)
- Modify: `engine/index.ts`

**Interfaces:**
- Consumes: `Rng` from `./types`.
- Produces: `type TrainType = 'freight' | 'express' | 'superchief'`, `interface TurnRoll { white: readonly [number, number]; bonus: number | null }`, `d6(rng): number`, `earnsBonus(train, white): boolean`, `rollTurn(train, rng): TurnRoll`, `movement(roll): number`, `bonusLegOwed(roll, spent, arrived): boolean`. Also the widened `rollDestination(from, rng, taken?)`.

- [ ] **Step 1: Write the failing dice test**

Create `engine/dice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bonusLegOwed, d6, earnsBonus, movement, rollTurn, type TurnRoll } from './dice';

/** Feeds exact die faces, one per call. `face` is 1-6. */
const dice = (...faces: number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) throw new Error('the scripted dice ran out');
    return (face - 1) / 6;
  };
};

describe('one die', () => {
  it('reads the scripted face', () => {
    const rng = dice(1, 6, 3);
    expect([d6(rng), d6(rng), d6(rng)]).toEqual([1, 6, 3]);
  });
});

describe('who earns a Bonus Roll', () => {
  it('gives a Freight one only on double six', () => {
    expect(earnsBonus('freight', [6, 6])).toBe(true);
    expect(earnsBonus('freight', [5, 5])).toBe(false);
    expect(earnsBonus('freight', [6, 5])).toBe(false);
  });

  it('gives an Express one on any double', () => {
    expect(earnsBonus('express', [2, 2])).toBe(true);
    expect(earnsBonus('express', [6, 6])).toBe(true);
    expect(earnsBonus('express', [2, 3])).toBe(false);
  });

  it('gives a Superchief one every turn', () => {
    expect(earnsBonus('superchief', [1, 2])).toBe(true);
    expect(earnsBonus('superchief', [6, 6])).toBe(true);
  });
});

describe('rolling a turn', () => {
  it('rolls two white dice and no bonus when none is earned', () => {
    expect(rollTurn('freight', dice(3, 4))).toEqual({ white: [3, 4], bonus: null });
  });

  it('rolls the bonus die exactly once when one is earned', () => {
    expect(rollTurn('freight', dice(6, 6, 2))).toEqual({ white: [6, 6], bonus: 2 });
  });

  it('never rolls a second bonus die, however the dice fall', () => {
    // Four faces are scripted; a second bonus die would throw on the fourth.
    expect(rollTurn('superchief', dice(6, 6, 6, 6)).bonus).toBe(6);
  });

  it('adds the bonus into the movement it grants', () => {
    expect(movement({ white: [3, 4], bonus: null })).toBe(7);
    expect(movement({ white: [6, 6], bonus: 5 })).toBe(17);
  });
});

describe('whether a bonus leg is still owed', () => {
  const withBonus: TurnRoll = { white: [4, 4], bonus: 3 };
  const without: TurnRoll = { white: [4, 4], bonus: null };

  it('is owed when the pawn arrived inside the white dice', () => {
    expect(bonusLegOwed(withBonus, 6, true)).toBe(true);
    expect(bonusLegOwed(withBonus, 8, true)).toBe(true);
  });

  it('is not owed when the pawn never arrived', () => {
    expect(bonusLegOwed(withBonus, 11, false)).toBe(false);
  });

  it('is not owed when the arrival came out of the bonus movement itself', () => {
    expect(bonusLegOwed(withBonus, 9, true)).toBe(false);
  });

  it('is not owed when no bonus was earned', () => {
    expect(bonusLegOwed(without, 4, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run engine/dice.test.ts`
Expected: FAIL — `Failed to resolve import "./dice"`.

- [ ] **Step 3: Write the dice**

Create `engine/dice.ts`:

```ts
import type { Rng } from './types';

/**
 * Freight to start. EXPRESS costs $4,000 and SUPERCHIEF $40,000 — prices the
 * money spec will charge. Nothing here upgrades a train; this type exists
 * because the Bonus Roll rule already turns on it, and threading it now costs
 * one parameter against a later change to every call site.
 *
 * There is no Fast Freight in this rulebook.
 */
export type TrainType = 'freight' | 'express' | 'superchief';

export interface TurnRoll {
  readonly white: readonly [number, number];
  /** null when this turn earned no Bonus Roll. */
  readonly bonus: number | null;
}

export const d6 = (rng: Rng): number => Math.floor(rng() * 6) + 1;

/**
 * "A player can get no more than one Bonus Roll per turn", and a player
 * entitled to one must take it — so this is a fact about the turn rather than
 * a choice offered to anyone.
 */
export function earnsBonus(train: TrainType, white: readonly [number, number]): boolean {
  switch (train) {
    case 'superchief': return true;
    case 'express': return white[0] === white[1];
    case 'freight': return white[0] === 6 && white[1] === 6;
  }
}

export function rollTurn(train: TrainType, rng: Rng): TurnRoll {
  const white: [number, number] = [d6(rng), d6(rng)];
  return { white, bonus: earnsBonus(train, white) ? d6(rng) : null };
}

export const movement = (roll: TurnRoll): number =>
  roll.white[0] + roll.white[1] + (roll.bonus ?? 0);

/**
 * Whether a second leg is still owed, and this is the one place the two legs
 * of a turn stop being interchangeable.
 *
 * Moving the white dice and the bonus die as one continuous run is equivalent
 * to the book's two legs *only while the pawn does not arrive*. If it arrives
 * inside the white dice, the book stops it dead, pays the player, has them
 * roll a **new** destination, and spends the Bonus Roll starting that new trip
 * with the used sections released. So the bonus movement can belong to a
 * different trip entirely, and the turn is not over.
 *
 * Arriving later than the white dice means the arrival happened during the
 * bonus movement of the same trip, which simply ends the turn.
 */
export function bonusLegOwed(roll: TurnRoll, spent: number, arrived: boolean): boolean {
  if (!arrived || roll.bonus === null) return false;
  return spent <= roll.white[0] + roll.white[1];
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run engine/dice.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing test for home-city collisions**

Append to `engine/roll.test.ts`:

```ts
describe('rolling a home city', () => {
  it('never lands on a home city another baron already holds', () => {
    const taken = new Set<CityId>();
    for (let baron = 0; baron < 6; baron++) {
      const outcome = rollDestination(null, Math.random, taken);
      expect(outcome.kind).toBe('home');
      const city = (outcome as { city: CityId }).city;
      expect(taken.has(city)).toBe(false);
      taken.add(city);
    }
    expect(taken.size).toBe(6);
  });

  it('takes the first roll when nothing is taken', () => {
    expect(rollDestination(null, () => 0, new Set())).toEqual(rollDestination(null, () => 0));
  });

  it('gives up rather than spinning for ever when every city is taken', () => {
    const everywhere = new Set(CITIES.map(city => city.id));
    expect(() => rollDestination(null, Math.random, everywhere)).toThrow(/home city/);
  });
});
```

Add `CITIES` and the `CityId` type to that file's existing engine imports if they are not already there.

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run engine/roll.test.ts`
Expected: FAIL — `rollDestination` takes two arguments, so the third is ignored: the throw test hangs rather than throwing (vitest reports a timeout) and the collision test eventually finds a duplicate.

- [ ] **Step 7: Widen `rollDestination`**

In `engine/roll.ts`, replace the function with:

```ts
/**
 * A baron's first roll is their home town and pays nothing. After that, a
 * roll that names the region they are already in hands the choice to the
 * player instead of picking a city.
 *
 * `taken` is the home cities other barons already hold. "If two players roll
 * the same home city, the second player must roll again — no players can have
 * the same home city." The book says to roll again for region *and* city, so
 * this rerolls the whole destination rather than picking another city inside
 * the region it first named. It applies only to the home roll: two barons may
 * perfectly well be heading for the same place.
 */
export function rollDestination(
  from: CityId | null, rng: Rng, taken: ReadonlySet<CityId> = new Set()
): RollOutcome {
  if (from === null) {
    let guard = 0;
    for (;;) {
      const region = rollRegion(rng);
      const city = rollCityIn(region, rng);
      if (!taken.has(city)) return { kind: 'home', city, region };
      if (++guard > 200) throw new Error('every home city is taken');
    }
  }

  const region = rollRegion(rng);
  if (region === cityById(from).region) return { kind: 'chooseRegion', rolled: region };

  const { city, payout } = destinationInRegion(from, region, rng);
  return { kind: 'arrived', city, region, payout };
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run engine/roll.test.ts`
Expected: PASS. The pre-existing tests in that file still pass — `taken` defaults to empty, so every existing call is unchanged.

- [ ] **Step 9: Re-export and run everything**

Append to `engine/index.ts`:

```ts
export { bonusLegOwed, d6, earnsBonus, movement, rollTurn } from './dice';
export type { TrainType, TurnRoll } from './dice';
export {
  canReach, isRejection, legalSteps, pathCost, sectionsLeft, stepCost, stepTo, useSection
} from './movement';
export type { Rejection, Step, Trip } from './movement';
```

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add engine/dice.ts engine/dice.test.ts engine/roll.ts engine/roll.test.ts engine/index.ts
git commit -m "feat: the movement dice, the Bonus Roll, and unique home cities

bonusLegOwed is where the turn's two legs stop being interchangeable: moving
the white dice and the bonus die as one run is equivalent to the book only
while the pawn does not arrive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The draft route

The half-built route a player is tapping out. It is screen state, never in the log, so undo is free — but the rules that govern it belong in the engine with everything else.

**Files:**
- Create: `engine/route.ts`
- Create: `engine/route.test.ts`
- Modify: `engine/index.ts`

**Interfaces:**
- Consumes: `legalSteps`, `stepTo`, `isRejection`, `Rejection`, `Step`, `Trip` from `./movement`; `nodeById`, `sectionKey`, `NodeId`, `RailroadId` from `./network`.
- Produces: `interface Draft { from, destination, rolled, before, steps }`, `startDraft(from, destination, rolled, before?): Draft`, `path(d): NodeId[]`, `here(d): NodeId`, `spent(d): number`, `remaining(d): number`, `arrived(d): boolean`, `usedAfter(d): Map<string, number>`, `rideNow(d): readonly RailroadId[] | null`, `tripOf(d): Trip`, `options(d): Step[]`, `extend(d, to): Draft | Rejection`, `back(d): Draft`, `complete(d): boolean`, `companies(d): RailroadId[]`.

- [ ] **Step 1: Find the node ids this task's tests need**

Run:

```bash
node -e "
const n=require('./engine/network.json');
const by=new Map(n.nodes.map(x=>[x.id,x]));
const at=id=>n.edges.filter(e=>e.a===id||e.b===id)
  .map(e=>{const o=e.a===id?e.b:e.a;return o+':'+by.get(o).kind+':'+(by.get(o).name||'');});
console.log('c13 (Minneapolis) ->', at('c13').join(' '));
const j=n.nodes.filter(x=>x.kind==='junction').map(x=>x.id);
const e=n.edges.find(x=>j.includes(x.a)||j.includes(x.b));
console.log('a junction edge ->', JSON.stringify(e));
"
```

Note down: a plain `dot` neighbour of `c13` (called `DOT` below), a node that is *not* a neighbour of `c13` (called `FAR` below), and the junction edge — its junction end (`JUNCTION`) and the node next to it (`BESIDE`). Substitute these into the test file rather than guessing.

- [ ] **Step 2: Write the failing test**

Create `engine/route.test.ts`, replacing `DOT`, `FAR`, `JUNCTION` and `BESIDE` with the ids from Step 1:

```ts
import { describe, expect, it } from 'vitest';
import { nodeById, nodeForCity, sectionKey } from './network';
import {
  arrived, back, companies, complete, extend, here, options,
  path, remaining, spent, startDraft, usedAfter, type Draft
} from './route';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);
const DOT = 'd66';        // a dot next to Minneapolis — from Step 1
const FAR = 'd0';         // not next to Minneapolis — from Step 1
const JUNCTION = 'j0';    // from Step 1
const BESIDE = 'd1';      // the node the junction edge joins — from Step 1

/** Extends a draft, failing loudly rather than silently, so a test reads. */
const walk = (draft: Draft, ...nodes: string[]): Draft =>
  nodes.reduce((current, to) => {
    const next = extend(current, to);
    if (typeof next === 'string') throw new Error(`step to ${to} refused: ${next}`);
    return next;
  }, draft);

describe('a fresh draft', () => {
  const draft = startDraft(MINNEAPOLIS, ST_PAUL, 7);

  it('stands where it started and has spent nothing', () => {
    expect(here(draft)).toBe(MINNEAPOLIS);
    expect(spent(draft)).toBe(0);
    expect(remaining(draft)).toBe(7);
    expect(path(draft)).toEqual([MINNEAPOLIS]);
  });

  it('has not arrived, and offers the steps the engine allows', () => {
    expect(arrived(draft)).toBe(false);
    expect(options(draft).map(step => step.to)).toContain(ST_PAUL);
  });

  it('is not committable — nothing spent and nowhere reached', () => {
    expect(complete(draft)).toBe(false);
  });
});

describe('extending a draft', () => {
  it('moves the head and charges the step', () => {
    const draft = walk(startDraft(MINNEAPOLIS, DOT, 7), DOT);
    expect(here(draft)).toBe(DOT);
    expect(spent(draft)).toBe(1);
    expect(path(draft)).toEqual([MINNEAPOLIS, DOT]);
  });

  it('charges nothing to cross into the twin city', () => {
    const draft = walk(startDraft(MINNEAPOLIS, ST_PAUL, 7), ST_PAUL);
    expect(spent(draft)).toBe(0);
    expect(arrived(draft)).toBe(true);
  });

  it('hands back the reason rather than a draft when the step is refused', () => {
    expect(extend(startDraft(MINNEAPOLIS, ST_PAUL, 7), FAR)).toBe('not-a-neighbour');
  });

  it('records the sections it has crossed', () => {
    const draft = walk(startDraft(MINNEAPOLIS, ST_PAUL, 7), ST_PAUL);
    expect(usedAfter(draft).get(sectionKey(MINNEAPOLIS, ST_PAUL))).toBe(1);
  });

  it('carries sections used earlier in the trip forward', () => {
    const before = new Map([[sectionKey(MINNEAPOLIS, ST_PAUL), 2]]);
    const draft = walk(startDraft(MINNEAPOLIS, ST_PAUL, 7, before), ST_PAUL);
    expect(usedAfter(draft).get(sectionKey(MINNEAPOLIS, ST_PAUL))).toBe(3);
  });

  it('refuses every step once the destination is underfoot', () => {
    const draft = walk(startDraft(MINNEAPOLIS, ST_PAUL, 7), ST_PAUL);
    expect(options(draft)).toEqual([]);
    expect(extend(draft, MINNEAPOLIS)).toBe('already-arrived');
  });
});

describe('undoing', () => {
  it('takes back the last step and everything it charged', () => {
    const draft = walk(startDraft(MINNEAPOLIS, DOT, 7), DOT);
    const undone = back(draft);
    expect(here(undone)).toBe(MINNEAPOLIS);
    expect(spent(undone)).toBe(0);
    expect(usedAfter(undone).size).toBe(0);
  });

  it('is harmless with nothing to take back', () => {
    const draft = startDraft(MINNEAPOLIS, ST_PAUL, 7);
    expect(back(draft)).toEqual(draft);
  });
});

describe('whether a draft may be committed', () => {
  it('may be, once it ends on the destination', () => {
    expect(complete(walk(startDraft(MINNEAPOLIS, ST_PAUL, 7), ST_PAUL))).toBe(true);
  });

  it('may be, once the whole roll is spent', () => {
    const draft = walk(startDraft(MINNEAPOLIS, FAR, 1), DOT);
    expect(spent(draft)).toBe(1);
    expect(arrived(draft)).toBe(false);
    expect(complete(draft)).toBe(true);
  });

  it('may not be with movement left and the destination unreached', () => {
    expect(complete(walk(startDraft(MINNEAPOLIS, FAR, 4), DOT))).toBe(false);
  });

  it('may not be with the pawn on a junction, which is not a dot', () => {
    expect(nodeById(JUNCTION).kind).toBe('junction');
    const draft = walk(startDraft(BESIDE, FAR, 0), JUNCTION);
    expect(spent(draft)).toBe(0);
    expect(complete(draft)).toBe(false);
  });
});

describe('which companies the route used', () => {
  it('is every company any of its steps could have ridden', () => {
    const draft = walk(startDraft(MINNEAPOLIS, ST_PAUL, 7), ST_PAUL);
    expect(companies(draft)).toEqual(
      expect.arrayContaining(['C&NW', 'CMStP&P', 'NP', 'GN'])
    );
  });

  it('is empty before a step has been taken', () => {
    expect(companies(startDraft(MINNEAPOLIS, ST_PAUL, 7))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run engine/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 4: Write it**

Create `engine/route.ts`:

```ts
import {
  isRejection, legalSteps, stepTo,
  type Rejection, type Step, type Trip
} from './movement';
import { nodeById, sectionKey, type NodeId, type RailroadId } from './network';

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
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run engine/route.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Prove the junction clause is load-bearing**

Temporarily delete the junction line from `complete` and re-run.
Expected: FAIL on "may not be with the pawn on a junction, which is not a dot" — `expected true to be false`. Restore it.

- [ ] **Step 7: Re-export and run everything**

Append to `engine/index.ts`:

```ts
export {
  arrived, back, companies, complete, extend, here, options, path,
  remaining, rideNow, spent, startDraft, tripOf, usedAfter
} from './route';
export type { Draft } from './route';
```

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add engine/route.ts engine/route.test.ts engine/index.ts
git commit -m "feat: the draft route a player taps out

Screen state, so undo is a slice and costs nothing — but the rules that
govern it live in the engine with the rest. complete() is where 'must move
the full number of dots' is enforced: a property of the finished route, not
of each step along it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The new events, and what replay derives from them

Three new event types, and the derivations that turn them back into a game: whose turn it is, where each pawn stands, and which sections this trip has spent.

**Files:**
- Create: `src/state/turns.ts`
- Create: `src/state/turns.test.ts`
- Modify: `src/state/events.ts`
- Modify: `src/state/game.ts`
- Modify: `src/state/game.test.ts` (append)
- Modify: `src/state/storage.test.ts` (append)

**Interfaces:**
- Consumes: `bonusLegOwed`, `nodeForCity`, `pathCost`, `sectionKey`, `TurnRoll`, `NodeId` from `../../engine`.
- Produces, from `src/state/events.ts`: the three event types below.
- Produces, from `src/state/game.ts`: `Seat` gains `at: NodeId | null` and `used: ReadonlyMap<string, number>`; `GameState` gains `order: readonly SeatId[]`, `turn: SeatId | null`, `rolled: TurnRoll | null`, and `phase` widens to `'setup' | 'homes' | 'playing'`.
- Produces, from `src/state/turns.ts`: `rotate(seats, first): SeatId[]`, `addSections(used, path): Map<string, number>`, `homeOf(seat): CityId | null`, `destinationOf(seat): CityId | null`, `needsDestination(seat): boolean`, `homesTaken(state): Set<CityId>`, `nextHomeSeat(state): SeatId | null`, `homesDone(state): boolean`.

**Import direction — this matters.** `src/state/game.ts` imports `rotate` and `addSections` from `turns.ts` at runtime. `turns.ts` must import `GameState` and `Seat` from `game.ts` with `import type` only, so the cycle is erased at compile time and never exists at runtime. A value import in that direction is a bug.

- [ ] **Step 1: Add the three event types**

In `src/state/events.ts`, add to the imports:

```ts
import { CITIES, NODES, REGIONS, cityById, type CityId, type RegionId } from '../../engine';
```

Extend the `GameEvent` union — and amend the doc comment on `arrived`:

```ts
  /**
   * `arrived` fires when a destination is *rolled*, not when the pawn gets
   * there: it is the companion app's event, kept under its old name because
   * renaming it would break every saved game for one word. Arrival at the
   * destination is `moved.arrived`.
   */
  | { type: 'arrived'; seat: SeatId; city: CityId; region: RegionId; payout: number | null }
  /**
   * Who goes first. "The players roll to see who goes first, the high roll" —
   * recorded rather than re-rolled, so a replayed game deals the same turns.
   * Its presence is also what moves the game from `homes` into `playing`.
   */
  | { type: 'orderRolled'; seat: SeatId; first: SeatId }
  /** The dice for one turn: both white dice, and the bonus die when earned. */
  | { type: 'turnRolled'; seat: SeatId; white: [number, number]; bonus: number | null }
  /** One leg of movement: the path as node ids, and whether it ended on the
   *  destination. Two of these in a turn means a Bonus Roll leg followed an
   *  arrival — see `bonusLegOwed`. */
  | { type: 'moved'; seat: SeatId; path: NodeId[]; arrived: boolean };
```

Add `export type NodeId = string;` near `SeatId`, and note that `orderRolled` carries a `seat` purely so the union stays uniform for `event.seat` narrowing — it is the seat that performed the roll and nothing reads it.

Add the validators, after `VALID_CITIES`:

```ts
const VALID_NODES: ReadonlySet<string> = new Set(NODES.map(node => node.id));

const isDie = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
```

and the three cases in `isGameEvent`:

```ts
    case 'orderRolled':
      return VALID_SEATS.has(event.seat as string) && VALID_SEATS.has(event.first as string);
    case 'turnRolled':
      return (
        VALID_SEATS.has(event.seat as string) &&
        Array.isArray(event.white) && event.white.length === 2 && event.white.every(isDie) &&
        (event.bonus === null || isDie(event.bonus))
      );
    case 'moved':
      // Two nodes minimum: a leg with no step is not a leg. Every id is
      // checked against the built network for the same reason cities are —
      // a log naming a node that was never real throws deep inside nodeById
      // on every replay and bricks the app.
      return (
        VALID_SEATS.has(event.seat as string) &&
        Array.isArray(event.path) && event.path.length >= 2 &&
        event.path.every(id => typeof id === 'string' && VALID_NODES.has(id)) &&
        typeof event.arrived === 'boolean'
      );
```

- [ ] **Step 2: Write the failing validator tests**

Append to `src/state/storage.test.ts`:

```ts
describe('the new turn events survive a round trip', () => {
  const good: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'started' },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
    { type: 'moved', seat: 'red', path: ['c13', 'c95'], arrived: true }
  ];

  it('keeps them all', () => {
    saveLog(good);
    expect(loadLog().events).toEqual(good);
  });

  it('discards a log whose die face was never on a die', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'turnRolled', seat: 'red', white: [3, 7], bonus: null }]
    }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a log naming a node that was never real', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'moved', seat: 'red', path: ['c13', 'nowhere'], arrived: false }]
    }));
    expect(loadLog().events).toEqual([]);
  });

  it('discards a leg that never went anywhere', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SAVE_VERSION, savedAt: Date.now(),
      events: [{ type: 'moved', seat: 'red', path: ['c13'], arrived: false }]
    }));
    expect(loadLog().events).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to see it fail, then pass**

Run: `npx vitest run src/state/storage.test.ts`
Expected before Step 1's edits: FAIL, the round-trip test loses every new event. With Step 1 applied: PASS.

If Step 1 is already applied, prove the guard instead: change `event.path.length >= 2` to `>= 1` and confirm "discards a leg that never went anywhere" fails. Restore it.

- [ ] **Step 4: Write `src/state/turns.ts`**

```ts
import { sectionKey, type CityId, type NodeId } from '../../engine';
import { SEATS, type SeatId } from './events';
// Types only. game.ts imports rotate and addSections from here at runtime, so
// a value import in this direction would close a real cycle.
import type { GameState, Seat } from './game';

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
  seat.stops.length >= 2 ? seat.stops[seat.stops.length - 1]!.city : null;

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
```

- [ ] **Step 5: Write the failing replay tests**

Append to `src/state/game.test.ts`:

```ts
import { nodeForCity } from '../../engine';
import { destinationOf, homesDone, needsDestination, nextHomeSeat, rotate } from './turns';

const MINNEAPOLIS_CITY = 43;
const ST_PAUL_CITY = 47;
const MINNEAPOLIS = nodeForCity(MINNEAPOLIS_CITY);
const ST_PAUL = nodeForCity(ST_PAUL_CITY);

/** Two seated barons, started, homes rolled, order settled on green. */
const twoBarons: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: MINNEAPOLIS_CITY, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: ST_PAUL_CITY, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'green' }
];

describe('the phases', () => {
  it('is setup before the game has started', () => {
    expect(replay([{ type: 'joined', seat: 'red', name: 'ADA' }]).phase).toBe('setup');
  });

  it('is homes once started, while home cities are still being rolled', () => {
    expect(replay(twoBarons.slice(0, 3)).phase).toBe('homes');
  });

  it('is playing once the order has been rolled', () => {
    expect(replay(twoBarons).phase).toBe('playing');
  });

  it('resumes a game saved before turn order existed in the homes phase', () => {
    // A v1.0.1 log: started, destinations rolled, no orderRolled. It lands in
    // `homes` with every home already in, so the only thing left is the roll
    // for first player — no migration code, and nothing discarded.
    const old = twoBarons.slice(0, 5);
    const state = replay(old);
    expect(state.phase).toBe('homes');
    expect(homesDone(state)).toBe(true);
  });
});

describe('where a pawn stands', () => {
  it('is nowhere until a home city is rolled', () => {
    expect(replay(twoBarons.slice(0, 3)).seats.red.at).toBeNull();
  });

  it('is the home city once one is', () => {
    expect(replay(twoBarons).seats.red.at).toBe(MINNEAPOLIS);
  });

  it('does not move when a destination is rolled', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 }];
    expect(replay(log).seats.red.at).toBe(MINNEAPOLIS);
    expect(destinationOf(replay(log).seats.red)).toBe(ST_PAUL_CITY);
  });

  it('is the last node of the last leg once one has been walked', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    expect(replay(log).seats.red.at).toBe(ST_PAUL);
  });
});

describe('the sections a trip has spent', () => {
  const trip = (arrived: boolean): GameEvent[] => [...twoBarons,
    { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
    { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived }];

  it('records every section a leg crossed', () => {
    expect(replay(trip(false)).seats.red.used.size).toBe(1);
  });

  it('releases them all on arrival', () => {
    expect(replay(trip(true)).seats.red.used.size).toBe(0);
  });
});

describe('turn order', () => {
  it('rotates the seated barons to start with the high roll', () => {
    expect(rotate(['red', 'green', 'blue'], 'green')).toEqual(['green', 'blue', 'red']);
    expect(rotate(['red', 'green', 'blue'], 'red')).toEqual(['red', 'green', 'blue']);
  });

  it('gives the first turn to whoever won the roll', () => {
    const state = replay(twoBarons);
    expect(state.order).toEqual(['green', 'red']);
    expect(state.turn).toBe('green');
  });

  it('stays with a baron whose turn is under way', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null }];
    const state = replay(log);
    expect(state.turn).toBe('green');
    expect(state.rolled).toEqual({ white: [3, 4], bonus: null });
  });

  it('passes to the left once the turn is spent', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [3, 4], bonus: null },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    const state = replay(log);
    expect(state.turn).toBe('red');
    expect(state.rolled).toBeNull();
  });

  it('keeps the turn when a bonus leg is still owed', () => {
    // Arrived inside the white dice with a bonus die rolled: the book has the
    // player roll a new destination and spend the bonus starting that trip.
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    const state = replay(log);
    expect(state.turn).toBe('green');
    expect(state.rolled).toEqual({ white: [6, 6], bonus: 4 });
  });

  it('ends the turn after the bonus leg', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true },
      { type: 'arrived', seat: 'green', city: ST_PAUL_CITY, region: 'PL', payout: 0 },
      { type: 'moved', seat: 'green', path: [MINNEAPOLIS, ST_PAUL], arrived: true }];
    expect(replay(log).turn).toBe('red');
  });
});

describe('who may be given a destination', () => {
  const nodeOf = nodeForCity;

  it('may be, with no home city yet', () => {
    expect(needsDestination(replay(twoBarons.slice(0, 3)).seats.red, nodeOf)).toBe(true);
  });

  it('may be, standing on the last destination reached', () => {
    expect(needsDestination(replay(twoBarons).seats.red, nodeOf)).toBe(true);
  });

  it('may not be, part-way along a trip', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'red', city: ST_PAUL_CITY, region: 'PL', payout: 0 }];
    expect(needsDestination(replay(log).seats.red, nodeOf)).toBe(false);
  });
});

describe('whose home city is owed', () => {
  it('is the first seated baron without one, in seat order', () => {
    expect(nextHomeSeat(replay(twoBarons.slice(0, 3)))).toBe('red');
    expect(nextHomeSeat(replay(twoBarons.slice(0, 4)))).toBe('green');
    expect(nextHomeSeat(replay(twoBarons))).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run src/state/game.test.ts`
Expected: FAIL — `Failed to resolve import "./turns"` and, once that resolves, `phase` is `'playing'` where `'homes'` is expected.

- [ ] **Step 7: Extend `src/state/game.ts`**

Replace the imports, the two interfaces, `emptyState` and `replay`:

```ts
import {
  bonusLegOwed, nodeForCity, pathCost,
  type CityId, type NodeId, type RegionId, type TurnRoll
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
}

function emptyState(): GameState {
  const seats = {} as Record<SeatId, Seat>;
  for (const id of SEATS) {
    seats[id] = {
      id, name: null, stops: [], awaiting: null, earned: 0, at: null, used: new Map()
    };
  }
  return { seats, phase: 'setup', order: [], turn: null, rolled: null };
}

export function replay(events: readonly GameEvent[]): GameState {
  const state = emptyState();
  let first: SeatId | null = null;
  /** Turns finished. The next one belongs to order[taken % order.length]. */
  let taken = 0;
  /** The turn under way, if any. */
  let open: { seat: SeatId; roll: TurnRoll; legs: number } | null = null;

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
          legs: 0
        };
        break;
      case 'moved':
        state.seats[event.seat] = {
          ...seat,
          at: event.path[event.path.length - 1]!,
          // "Everything is released on arrival" — the whole trip's sections,
          // not just this leg's.
          used: event.arrived ? new Map() : addSections(seat.used, event.path)
        };
        if (open !== null) {
          open.legs += 1;
          const over = open.legs >= 2
            || !bonusLegOwed(open.roll, pathCost(event.path), event.arrived);
          if (over) { taken += 1; open = null; }
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
  return state;
}
```

Leave `undo` and `currentCity` unchanged.

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run src/state/game.test.ts`
Expected: PASS. The file's existing tests still pass — nothing about `stops`, `earned` or `awaiting` changed.

- [ ] **Step 9: Prove the bonus-leg branch is load-bearing**

Temporarily change `const over = open.legs >= 2 || !bonusLegOwed(...)` to `const over = true;` and re-run.
Expected: FAIL on "keeps the turn when a bonus leg is still owed" — `expected 'red' to be 'green'`. Restore it.

- [ ] **Step 10: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `src/App.tsx` still compiles: it reads `state.phase === 'playing'`, which is now false during `homes` — Task 8 fixes the behaviour, and this task only has to keep the build green.

- [ ] **Step 11: Commit**

```bash
git add src/state/events.ts src/state/game.ts src/state/turns.ts \
        src/state/game.test.ts src/state/storage.test.ts
git commit -m "feat: turn events, and the turn order replay derives from them

Adds orderRolled, turnRolled and moved. A game saved before turn order
existed has no orderRolled, so it resumes in the new homes phase with every
home already rolled — the migration is the derivation, and no save is lost.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: `useGame` — the turn API, and a second tab that keeps up

The gate that holds a roll out of the log until it has been announced is extended to the dice, and the hook stops being deaf to what another tab wrote.

**Files:**
- Modify: `src/state/useGame.ts`
- Create: `src/state/useGame.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 4-6 produced.
- Produces, added to `useGame`'s return: `rollDice(seat): TurnRoll | null`, `commitDice(seat, roll): void`, `commitMove(seat, path, arrived): void`, `rollOrder(): void`. `roll(seat)` keeps its signature and gains the home-collision and turn-order guards.

- [ ] **Step 1: Write the failing test**

Create `src/state/useGame.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { nodeForCity } from '../../engine';
import { STORAGE_KEY, saveLog } from './storage';
import type { GameEvent } from './events';
import { useGame } from './useGame';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);

/** Feeds exact die faces so a roll is never a guess. */
const dice = (...faces: number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) return Math.random();
    return (face - 1) / 6;
  };
};

const seated: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' }
];

beforeEach(() => localStorage.clear());

describe('rolling the movement dice', () => {
  it('hands back the dice without putting them in the log', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    let rolled: unknown;
    act(() => { rolled = result.current.rollDice('red'); });
    expect(rolled).toEqual({ white: [3, 4], bonus: null });
    expect(result.current.state.rolled).toBeNull();
  });

  it('reaches the log only through commitDice', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    act(() => { result.current.commitDice('red', { white: [3, 4], bonus: null }); });
    expect(result.current.state.rolled).toEqual({ white: [3, 4], bonus: null });
  });

  it('refuses a baron whose turn it is not', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(dice(3, 4)));
    expect(result.current.rollDice('green')).toBeNull();
  });

  it('refuses a second roll inside one turn', () => {
    saveLog([...seated, { type: 'turnRolled', seat: 'red', white: [3, 4], bonus: null }]);
    const { result } = renderHook(() => useGame(dice(1, 1)));
    expect(result.current.rollDice('red')).toBeNull();
  });
});

describe('rolling a destination', () => {
  it('refuses one mid-trip', () => {
    saveLog([...seated,
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, 'd66'], arrived: false }]);
    const { result } = renderHook(() => useGame(Math.random));
    expect(result.current.roll('red')).toBeNull();
  });

  it('refuses a home city another baron already holds', () => {
    // Only red is seated and homed; green's home roll must avoid red's city.
    saveLog([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'GRACE' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }
    ]);
    const { result } = renderHook(() => useGame(Math.random));
    for (let attempt = 0; attempt < 40; attempt++) {
      const outcome = result.current.roll('green');
      expect(outcome).not.toBeNull();
      expect((outcome as { city: number }).city).not.toBe(43);
    }
  });
});

describe('committing a move', () => {
  it('appends one leg and moves the pawn', () => {
    saveLog([...seated,
      { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }]);
    const { result } = renderHook(() => useGame(Math.random));
    act(() => { result.current.commitMove('red', [MINNEAPOLIS, ST_PAUL], true); });
    expect(result.current.state.seats.red.at).toBe(ST_PAUL);
    expect(result.current.state.turn).toBe('green');
  });
});

describe('a second tab', () => {
  it('follows the log when another tab writes it', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(Math.random));
    expect(result.current.state.turn).toBe('red');

    // What another tab's write looks like from in here: the store already
    // holds the new log, and the event says which key moved.
    act(() => {
      saveLog([...seated,
        { type: 'turnRolled', seat: 'red', white: [2, 2], bonus: null }]);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current.state.rolled).toEqual({ white: [2, 2], bonus: null });
  });

  it('ignores a key that is not ours', () => {
    saveLog(seated);
    const { result } = renderHook(() => useGame(Math.random));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'acquire:log:v1' }));
    });
    expect(result.current.state.turn).toBe('red');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/state/useGame.test.tsx`
Expected: FAIL — `result.current.rollDice is not a function`.

- [ ] **Step 3: Extend `useGame`**

In `src/state/useGame.ts`, widen the imports:

```ts
import {
  destinationInRegion, movement, nodeForCity, rollDestination, rollTurn,
  type NodeId, type RegionId, type Rng, type RollOutcome, type TrainType, type TurnRoll
} from '../../engine';
import { SEATS, type GameEvent, type SeatId } from './events';
import { currentCity, replay, undo } from './game';
import { homesTaken, needsDestination, nextHomeSeat } from './turns';
import { STORAGE_KEY, clearLog, loadLog, saveLog } from './storage';
```

Add the storage listener, next to the existing save effect:

```ts
  /**
   * Follow the log when another tab writes it.
   *
   * Each tab used to read the store once, at mount, and never look again — so
   * a board on the tablet and a map on a second screen drifted apart the
   * moment either acted, and the stale one overwrote the other's work when it
   * next wrote. With committed moves and strict turn order that is a way to
   * lose a game rather than an inconvenience.
   *
   * `storage` fires in *other* tabs, never the one that wrote, so this cannot
   * hear its own save. Returning the current array unchanged when the logs
   * match keeps its identity, which keeps the save effect above from writing
   * it straight back and starting a volley.
   */
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      // A null key means the whole store was cleared, which concerns us too.
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      const loaded = loadLog().events;
      setEvents(current =>
        JSON.stringify(current) === JSON.stringify(loaded) ? current : loaded);
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);
```

Widen `roll`, and add the four new callbacks:

```ts
  const roll = useCallback((seat: SeatId): RollOutcome | null => {
    const current = state.seats[seat];
    if (current.awaiting !== null || current.name === null) return null;
    // A destination is rolled once per trip, at its start. The guard is here
    // rather than on the screen so that no future screen can route round it.
    if (!needsDestination(current, nodeForCity)) return null;
    if (state.phase === 'homes' && nextHomeSeat(state) !== seat) return null;
    if (state.phase === 'playing' && state.turn !== seat) return null;
    return rollDestination(currentCity(current), rng, homesTaken(state));
  }, [state, rng]);

  /**
   * The movement dice. Deliberately appends nothing, for the same reason
   * `roll` does not: the board announces the faces before the log carries
   * them, and `commitDice` is the only way in.
   */
  const rollDice = useCallback((seat: SeatId): TurnRoll | null => {
    if (state.phase !== 'playing' || state.turn !== seat) return null;
    if (state.rolled !== null) return null;             // one roll per turn
    if (needsDestination(state.seats[seat], nodeForCity)) return null;
    // Every baron starts on a Freight and nothing upgrades one yet; the money
    // spec is what makes this a lookup rather than a constant.
    const train: TrainType = 'freight';
    return rollTurn(train, rng);
  }, [state, rng]);

  const commitDice = useCallback((seat: SeatId, roll: TurnRoll) => {
    setEvents(log => [...log, {
      type: 'turnRolled', seat,
      white: [roll.white[0], roll.white[1]], bonus: roll.bonus
    }]);
  }, []);

  const commitMove = useCallback((seat: SeatId, path: readonly NodeId[], arrived: boolean) => {
    setEvents(log => [...log, { type: 'moved', seat, path: [...path], arrived }]);
  }, []);

  /**
   * "The players roll to see who goes first, the high roll." Rolled once and
   * recorded, so a replayed game deals the same turns; ties are settled by
   * rolling again rather than by seat order, which would quietly favour red.
   */
  const rollOrder = useCallback(() => {
    const seated = SEATS.filter(id => state.seats[id].name !== null);
    if (seated.length === 0) return;
    let best: SeatId[] = [];
    let high = 0;
    let guard = 0;
    do {
      best = [];
      high = 0;
      for (const id of seated) {
        const score = Math.floor(rng() * 6) + Math.floor(rng() * 6) + 2;
        if (score > high) { high = score; best = [id]; }
        else if (score === high) best.push(id);
      }
    } while (best.length > 1 && ++guard < 100);
    const first = best[0]!;
    setEvents(log => (log.some(e => e.type === 'orderRolled')
      ? log
      : [...log, { type: 'orderRolled', seat: first, first }]));
  }, [state, rng]);
```

Add the four to the returned object, and add `movement` to the import list only if the file uses it (it does not yet — drop it if the linter complains).

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/state/useGame.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the cross-tab listener is load-bearing**

Temporarily change `if (event.key !== null && event.key !== STORAGE_KEY) return;` to `return;` and re-run.
Expected: FAIL on "follows the log when another tab writes it" — `expected null to equal { white: [2,2], bonus: null }`. Restore it.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/state/useGame.ts src/state/useGame.test.tsx
git commit -m "feat: the turn API, and a tab that follows the log

rollDice mirrors roll — it hands back the faces and appends nothing, so the
board announces them before the log carries them. A storage listener brings a
second tab into line, which stops being a nicety once turns are strict.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: The homes phase, and the roll for first player

The setup the rulebook has an order to, and which strict turns make matter. Home rolls go through the existing announce-then-commit gate unchanged — that is the point of having built it.

**Files:**
- Create: `src/board/screens/homes.ts`
- Create: `src/board/screens/homes.test.ts`
- Modify: `src/board/types.ts`
- Modify: `src/board/screens/play.ts`
- Modify: `src/board/screens/play.test.ts` (append)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `homesDone`, `nextHomeSeat`, `needsDestination`, `destinationOf` from `../../state/turns`; `GameState` from `../../state/game`.
- Produces: `homes(state, pending?): ScreenDef`; `RowAction` gains `{ kind: 'order' }`.

- [ ] **Step 1: Widen `RowAction`**

In `src/board/types.ts`:

```ts
export type RowAction =
  | { kind: 'navigate'; to: ScreenId }
  | { kind: 'edit'; field: FieldId; placeholder: string }
  | { kind: 'act'; seat: SeatId }
  /** Roll for who goes first. One row, once per game, so it carries no payload. */
  | { kind: 'order' }
  | null;
```

Add `'homes'` to `ScreenId`.

- [ ] **Step 2: Write the failing test**

Create `src/board/screens/homes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../state/events';
import { replay } from '../../state/game';
import { homes } from './homes';

const started: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' }
];

const withRedHome: GameEvent[] = [...started,
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }];

const bothHomed: GameEvent[] = [...withRedHome,
  { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null }];

describe('the homes screen', () => {
  it('is always seven rows', () => {
    expect(homes(replay(started)).rows).toHaveLength(7);
  });

  it('offers the roll to the first baron without a home, and no one else', () => {
    const rows = homes(replay(started)).rows;
    expect(rows[0]!.action).toEqual({ kind: 'act', seat: 'red' });
    expect(rows[1]!.action).toBeNull();
  });

  it('moves the offer along in seat order', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.action).toBeNull();
    expect(rows[1]!.action).toEqual({ kind: 'act', seat: 'green' });
  });

  it('shows a home city once it is rolled', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.text).toBe('Minneapolis');
    expect(rows[0]!.status).toBe('Plains');
  });

  it('shows no payout for a home town — it pays nothing', () => {
    const rows = homes(replay(withRedHome)).rows;
    expect(rows[0]!.amount).toBe('');
    expect(rows[0]!.right).toBe('Home');
  });

  it('offers the roll for first player only once every home is in', () => {
    const before = homes(replay(withRedHome)).rows;
    expect(before.some(row => row.action?.kind === 'order')).toBe(false);
    const after = homes(replay(bothHomed)).rows;
    expect(after.some(row => row.action?.kind === 'order')).toBe(true);
  });

  it('shows only the rolling baron the region while it is still turning', () => {
    const rows = homes(replay(started), { seat: 'red', region: 'NE' }).rows;
    expect(rows[0]!.status).toBe('Northeast');
    expect(rows[0]!.text).toBe('');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/board/screens/homes.test.ts`
Expected: FAIL — `Failed to resolve import "./homes"`.

- [ ] **Step 4: Write the screen**

Create `src/board/screens/homes.ts`:

```ts
import { cityById, regionById, REGIONS, type RegionId } from '../../../engine';
import { SEATS, type SeatId } from '../../state/events';
import type { GameState } from '../../state/game';
import { homesDone, nextHomeSeat } from '../../state/turns';
import { SEAT_COLORS } from '../../game/tokens';
import { blankRow, BOARD_ROWS, padRows, type Row, type ScreenDef } from '../types';

/**
 * Home cities, then the roll for who goes first.
 *
 * The rulebook has an order to setup and strict turns make it matter: every
 * baron takes a home city, in seat order and no two the same, and only then do
 * the players roll to see who starts. Both are rolls, so both go through the
 * board's existing gate — the value is not in the log until the panel lands.
 */
export function homes(
  state: GameState,
  pending: { seat: SeatId; region: RegionId } | null = null
): ScreenDef {
  const owed = nextHomeSeat(state);
  const ready = homesDone(state);

  const rows: Row[] = SEATS
    .map(id => state.seats[id])
    .filter(seat => seat.name !== null)
    .map((seat, index) => {
      const home = seat.stops[0];
      const rolling = pending !== null && pending.seat === seat.id;
      return {
        // Stamped so the flap is started by the announcement rather than by
        // the text changing — the same reason the in-play screen carries it.
        turn: index,
        label: seat.name!,
        status: rolling
          ? regionById(pending!.region).name
          : (home ? regionById(home.region).name : ''),
        text: rolling ? '' : (home ? cityById(home.city).name : ''),
        // A home town pays nothing, and that is `payout: null` rather than a
        // zero — so there is no figure to print, and HOME stands in its place.
        amount: '',
        showDollar: true,
        right: home ? 'Home' : '',
        chip: SEAT_COLORS[seat.id],
        tone: home ? 'normal' : (seat.id === owed ? 'normal' : 'dim'),
        action: seat.id === owed && pending === null ? { kind: 'act', seat: seat.id } : null
      };
    });

  const withOrder = padRows(rows).slice(0, BOARD_ROWS - 1);
  withOrder.push(ready
    ? { ...blankRow(), label: 'Start', text: 'Roll for first', tone: 'normal',
        action: { kind: 'order' } }
    : { ...blankRow(), label: 'Start', text: 'Homes first', tone: 'dim' });

  return {
    title: 'Departures',
    sub: ready ? 'ROLL FOR FIRST' : 'HOME CITIES',
    back: 'home',
    cols: ['Baron', 'Region', 'Home city', '', ''],
    rows: withOrder,
    panel: REGIONS.map(region => region.name)
  };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/board/screens/homes.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing test for strict turns on the play screen**

Append to `src/board/screens/play.test.ts`:

```ts
describe('strict turn order', () => {
  const playing: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'joined', seat: 'green', name: 'GRACE' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
    { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'green' }
  ];

  it('offers the roll only to the baron whose turn it is', () => {
    const rows = play(replay(playing)).rows;
    // green is first, and sits in the second row: seating order is unchanged.
    expect(rows[0]!.action).toBeNull();
    expect(rows[1]!.action).toEqual({ kind: 'act', seat: 'green' });
  });

  it('dims every baron who is not up', () => {
    const rows = play(replay(playing)).rows;
    expect(rows[0]!.tone).toBe('dim');
    expect(rows[1]!.tone).toBe('normal');
  });

  it('offers nothing once the destination is rolled — movement is on the map', () => {
    const rows = play(replay([...playing,
      { type: 'arrived', seat: 'green', city: 43, region: 'PL', payout: 0 }])).rows;
    expect(rows[1]!.action).toBeNull();
  });
});
```

- [ ] **Step 7: Make it pass**

In `src/board/screens/play.ts`, inside the `.map(seat => ...)`, replace the `tone` and `action` fields:

```ts
        // Only the baron whose turn it is can act, and only to start a trip:
        // the dice are rolled from the board's own readout and the pawn is
        // walked on the map, so a row with a destination has nothing to offer.
        tone: state.turn === null || state.turn === seat.id ? 'normal' : 'dim',
        action: state.turn === seat.id && needsDestination(seat, nodeForCity)
          ? { kind: 'act', seat: seat.id }
          : (state.turn === null ? { kind: 'act', seat: seat.id } : null)
```

`state.turn === null` keeps the screen usable in the tests that predate turn order (a log with no `orderRolled` has no turn). Import `needsDestination` from `../../state/turns` and `nodeForCity` from `../../../engine`.

Run: `npx vitest run src/board/screens/play.test.ts`
Expected: PASS, including the file's existing tests — they build states with no `orderRolled`, so `state.turn` is null and every row stays live.

- [ ] **Step 8: Wire the phase into `App.tsx`**

Four changes:

```ts
// 1. resuming now means "past setup", not "playing".
const resuming = state.phase !== 'setup';

// 2. the game route picks the homes screen while homes are being rolled.
'/pass-and-play/game': state.phase === 'homes'
  ? homes(state, rolling && { seat: rolling.seat, region: regionOf(rolling.outcome) })
  : awaiting
    ? regionBallot(awaiting)
    : play(state, turns, rolling && { seat: rolling.seat, region: regionOf(rolling.outcome) })

// 3. onRowAct handles the new kind, before the 'navigate' branch.
if (row.action.kind === 'order') { rollOrder(); return; }

// 4. rollOrder comes out of useGame. Tasks 9 and 10 add the rest of the
//    turn API to this line; take only what this task uses.
const { state, savedAt, roll, commitRoll, chooseRegion, rename, start,
        rollOrder, undoLast, reset } = useGame(rng);
```

Import `homes` from `./board/screens/homes`. Leave the `awaitRegion` wiring exactly as it is — home rolls go through it unchanged, which is what makes the gate structural rather than a habit.

- [ ] **Step 9: Wire undo, which has existed unreachable since Phase 1**

The spec asks for it by name: "Undo takes back the last turn if someone acts for the wrong baron." `useGame.undoLast` already exists and truncates the log; no screen has ever called it.

Add a failing test to `src/board/screens/play.test.ts`:

```ts
  it('offers undo once anything has happened this game', () => {
    const rows = play(replay(playing)).rows;
    expect(rows.some(row => row.action?.kind === 'undo')).toBe(true);
  });

  it('offers no undo before the game has started', () => {
    const rows = play(replay(playing.slice(0, 2))).rows;
    expect(rows.some(row => row.action?.kind === 'undo')).toBe(false);
  });
```

Add `| { kind: 'undo' }` to `RowAction`. Undo gets its own row, immediately above the map row.

A row carries exactly one action — `RowAction` is a union so that a row cannot hold two — so undo cannot share the map row. The board is always seven rows, and play already spends six on barons plus one on the map when six are seated. So the undo row appears only when there is a spare, which is any game of five barons or fewer. Six-baron games do without it; that is the cost of the seven-row rule, and it is the right way round.

In `play.ts`, between building `rows` and the `padRows` call:

```ts
  // Its own row: a row carries one action, so undo cannot ride on the map
  // row. The board is seven rows, always — with six barons seated there is
  // no spare and this is left off rather than the board growing.
  if (state.phase === 'playing' && rows.length < BOARD_ROWS - 1) {
    rows.push({ ...blankRow(), label: 'Undo', text: 'Take back a turn',
                tone: 'dim', action: { kind: 'undo' } });
  }
```

In `App.tsx`'s `onRowAct`, before the `navigate` branch:

```ts
    if (row.action.kind === 'undo') { undoLast(); return; }
```

The two tests above therefore seat two barons, which leaves a spare row. Add a third:

```ts
  it('leaves undo off a full board rather than growing past seven rows', () => {
    const full: GameEvent[] = [
      ...(['red', 'green', 'blue', 'yellow', 'black', 'white'] as const)
        .map(seat => ({ type: 'joined', seat, name: seat.toUpperCase() }) as GameEvent),
      { type: 'started' },
      { type: 'orderRolled', seat: 'red', first: 'red' }
    ];
    const screen = play(replay(full));
    expect(screen.rows).toHaveLength(7);
    expect(screen.rows.some(row => row.action?.kind === 'undo')).toBe(false);
  });
```

Run: `npx vitest run src/board/screens/play.test.ts` — FAIL first, then PASS.

- [ ] **Step 10: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `src/App.test.tsx` may need its "start a game and roll" flow extended by one tap (the home roll now precedes play) — if a test there fails because the board shows HOME CITIES, add the home rolls and the first-player tap to that flow rather than weakening the assertion.

- [ ] **Step 11: Commit**

```bash
git add src/board/screens/homes.ts src/board/screens/homes.test.ts \
        src/board/screens/play.ts src/board/screens/play.test.ts \
        src/board/types.ts src/App.tsx
git commit -m "feat: the homes phase and the roll for first player

Home rolls go through the existing announce-then-commit gate untouched,
which is the whole reason it was built structurally. The play screen now
offers the roll only to the baron whose turn it is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The dice readout

Three split-flap dice, centred in the board's header, built to `Departures Board.dc.html` in the **Rail Baron Game Board Design** project on claude.ai/design. The design is the authority for every number in this task; the numbers below are copied from it.

**What the design specifies:**

| | |
|---|---|
| Placement | Absolutely centred in the 78px header: `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%)`. The whole group is one button — tapping the dice rolls them. |
| A die | 54 × 56px, `border-radius:7px`, background `#000`, `box-shadow:0 3px 8px rgba(0,0,0,0.55)`. 11px between dice. |
| Leaves | Two, 27px tall, top and bottom. Top leaf carries the arriving face, bottom still shows the outgoing one — the same two-leaf rule the rest of the board follows. |
| A face | A 3 × 3 pip grid, `padding:9px`, `gap:4px`, cells `border-radius:50%`. The bottom leaf's grid is offset `margin-top:-29px` so the two halves line up as one die. |
| Pips | `{ 0: [], 1: [4], 2: [0,8], 3: [0,4,8], 4: [0,2,6,8], 5: [0,2,4,6,8], 6: [0,2,3,5,6,8] }` — indexes into the 9 cells. Unlit cells are `transparent`, so the leaf colour shows through. |
| White die | top leaf `#efece2`, bottom leaf `#e5e1d5`, pips `#141210`. |
| Bonus die | Leaf `#c9261a` showing a number, `#0c0c0c` showing the blank. Pips `#fdf3e6`. Its drum carries **seven** faces — a blank plus 1-6 — and rests on the blank. That empty slot is the point: it shows a Freight player what a Superchief gets every turn. |
| Tick | 78ms, not the board's 52ms. |
| The turn | Each white drum runs a full lap plus its distance (`6 + ((target - cur + 6) % 6)`), both starting together. One tick after they land, the trailing leaves fall. Then, after 300ms on a bonus and immediately otherwise, the bonus drum turns: to its face plus a full lap when earned, or round to the blank when not. |

**Files:**
- Create: `src/board/dice.ts`
- Create: `src/board/dice.test.ts`
- Create: `src/board/Dice.tsx`
- Create: `src/board/Dice.test.tsx`
- Modify: `src/board/types.ts`
- Modify: `src/board/Board.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces, from `src/board/dice.ts`: `PIPS: Record<number, readonly number[]>`, `pipCells(value: number, color: string): { bg: string }[]`, `DIE`, `DICE_MS`, `WHITE_FACES`, `BONUS_FACES`, `dieTurn(from: number, to: number, faces: number, lap: boolean): number`.
- Produces, from `src/board/Dice.tsx`: `Dice({ roll, onRoll, onLanded, live })`.
- Produces: `ScreenDef` gains `dice?: DiceSlot | null`; `BoardProps` gains `awaitDice?: { onLanded: () => void } | null` and `onRollDice?: () => void`.

- [ ] **Step 1: Write the failing test for the pure part**

Create `src/board/dice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BONUS_FACES, PIPS, WHITE_FACES, dieTurn, pipCells } from './dice';

describe('the pip layouts', () => {
  it('lights the middle cell alone for a one', () => {
    expect(PIPS[1]).toEqual([4]);
  });

  it('lights nothing for the blank face', () => {
    expect(PIPS[0]).toEqual([]);
  });

  it('lights as many cells as the face is worth', () => {
    for (let face = 0; face <= 6; face++) expect(PIPS[face]!).toHaveLength(face);
  });

  it('never lights a cell that is not on the die', () => {
    for (const cells of Object.values(PIPS)) {
      for (const cell of cells) expect(cell).toBeGreaterThanOrEqual(0);
      for (const cell of cells) expect(cell).toBeLessThan(9);
    }
  });
});

describe('a rendered face', () => {
  it('is always nine cells, lit or not', () => {
    expect(pipCells(3, '#141210')).toHaveLength(9);
  });

  it('paints the lit cells and leaves the rest to the leaf beneath', () => {
    const cells = pipCells(2, '#141210');
    expect(cells[0]).toEqual({ bg: '#141210' });
    expect(cells[8]).toEqual({ bg: '#141210' });
    expect(cells[4]).toEqual({ bg: 'transparent' });
  });

  it('shows no pips at all on the blank', () => {
    expect(pipCells(0, '#fdf3e6').every(cell => cell.bg === 'transparent')).toBe(true);
  });
});

describe('how far a drum turns', () => {
  it('runs a full lap plus the distance when it must be seen to turn', () => {
    expect(dieTurn(0, 0, WHITE_FACES, true)).toBe(6);
    expect(dieTurn(0, 3, WHITE_FACES, true)).toBe(9);
    expect(dieTurn(5, 0, WHITE_FACES, true)).toBe(7);
  });

  it('turns only the distance when it need not', () => {
    expect(dieTurn(3, 0, BONUS_FACES, false)).toBe(4);
    expect(dieTurn(0, 0, BONUS_FACES, false)).toBe(0);
  });

  it('reckons the bonus drum over seven faces, blank included', () => {
    expect(BONUS_FACES).toBe(7);
    expect(WHITE_FACES).toBe(6);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/board/dice.test.ts`
Expected: FAIL — `Failed to resolve import "./dice"`.

- [ ] **Step 3: Write it**

Create `src/board/dice.ts`:

```ts
/**
 * The dice, as the departures-board design draws them.
 *
 * Every measurement and colour here is copied from `Departures Board.dc.html`
 * in the Rail Baron Game Board Design project. Change them there first.
 */

/** Which of the nine cells a face lights. */
export const PIPS: Record<number, readonly number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

/**
 * Nine cells, of which the lit ones carry the colour. The rest are
 * transparent rather than painted the leaf's colour: a leaf mid-fall is two
 * different backgrounds, and a hardcoded unlit colour shows the seam.
 */
export function pipCells(value: number, color: string): { bg: string }[] {
  const on = PIPS[value] ?? [];
  return Array.from({ length: 9 }, (_, cell) =>
    ({ bg: on.includes(cell) ? color : 'transparent' }));
}

export const DIE = {
  width: 54,
  height: 56,
  leafHeight: 27,
  radius: 7,
  gap: 11,
  padding: 9,
  pipGap: 4,
  /** The bottom leaf's grid is pushed up so the two halves read as one die. */
  bottomOffset: -29
} as const;

export const COLORS = {
  whiteTop: '#efece2',
  whiteBottom: '#e5e1d5',
  whitePip: '#141210',
  bonusLeaf: '#c9261a',
  bonusBlank: '#0c0c0c',
  bonusPip: '#fdf3e6',
  body: '#000'
} as const;

/** A die's own tick, slower than the board's 52ms — these are heavier leaves. */
export const DICE_MS = 78;

export const WHITE_FACES = 6;
/** Blank, then 1-6. The blank is the slot a Freight sees empty every turn. */
export const BONUS_FACES = 7;

/**
 * How many ticks a drum turns. `lap` adds a full revolution, so a die that
 * lands on the face it already showed is still visibly rolled — without it a
 * repeated six would sit there and read as a die that was never thrown.
 */
export const dieTurn = (from: number, to: number, faces: number, lap: boolean): number =>
  ((to - from + faces) % faces) + (lap ? faces : 0);
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/board/dice.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing component test**

Create `src/board/Dice.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dice } from './Dice';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Runs the drums to a standstill. */
const settle = () => act(() => { vi.advanceTimersByTime(4000); });

describe('the dice readout', () => {
  it('shows three dice, always', () => {
    render(<Dice roll={null} live={false} />);
    expect(screen.getAllByRole('img', { name: /die/i })).toHaveLength(3);
  });

  it('leaves the bonus die blank when none was earned', () => {
    render(<Dice roll={{ white: [3, 4], bonus: null }} live={false} />);
    settle();
    expect(screen.getByRole('img', { name: 'Bonus die, not earned' })).toBeInTheDocument();
  });

  it('shows the bonus die when one was', () => {
    render(<Dice roll={{ white: [6, 6], bonus: 5 }} live={false} />);
    settle();
    expect(screen.getByRole('img', { name: 'Bonus die, 5' })).toBeInTheDocument();
  });

  it('names the white faces once the drums stop', () => {
    render(<Dice roll={{ white: [3, 4], bonus: null }} live={false} />);
    settle();
    expect(screen.getByRole('img', { name: 'White die, 3' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'White die, 4' })).toBeInTheDocument();
  });

  it('does not name the faces while the drums are still turning', () => {
    render(<Dice roll={{ white: [3, 4], bonus: null }} live={false} />);
    act(() => { vi.advanceTimersByTime(78); });
    expect(screen.queryByRole('img', { name: 'White die, 3' })).not.toBeInTheDocument();
  });

  it('reports the landing once, when every drum has stopped', () => {
    const onLanded = vi.fn();
    render(<Dice roll={{ white: [3, 4], bonus: null }} live={false} onLanded={onLanded} />);
    act(() => { vi.advanceTimersByTime(78); });
    expect(onLanded).not.toHaveBeenCalled();
    settle();
    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  it('rolls when tapped, but only when it is live', async () => {
    const onRoll = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<Dice roll={null} live={false} onRoll={onRoll} />);
    await user.click(screen.getByRole('button', { name: /roll the dice/i }));
    expect(onRoll).not.toHaveBeenCalled();
    rerender(<Dice roll={null} live onRoll={onRoll} />);
    await user.click(screen.getByRole('button', { name: /roll the dice/i }));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run src/board/Dice.test.tsx`
Expected: FAIL — `Failed to resolve import "./Dice"`.

- [ ] **Step 7: Write the component**

Create `src/board/Dice.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { TurnRoll } from '../../engine';
import { BONUS_FACES, COLORS, DICE_MS, DIE, WHITE_FACES, dieTurn, pipCells } from './dice';

/** One drum: the face showing, the face still falling away, and ticks left. */
interface Drum { cur: number; prev: number; left: number; faces: number; }

const rest = (faces: number): Drum => ({ cur: 0, prev: 0, left: 0, faces });

const tick = (drum: Drum): Drum =>
  drum.left <= 0
    ? (drum.prev === drum.cur ? drum : { ...drum, prev: drum.cur })
    : { ...drum, cur: (drum.cur + 1) % drum.faces, prev: drum.cur, left: drum.left - 1 };

const stopped = (drum: Drum): boolean => drum.left <= 0 && drum.prev === drum.cur;

export interface DiceProps {
  /** The dice of the turn under way, or null when none has been rolled. */
  roll: TurnRoll | null;
  /** Whether tapping does anything — only the baron whose turn it is may roll. */
  live: boolean;
  onRoll?: () => void;
  /** Fires once, when every drum has stopped. The gate for committing a roll. */
  onLanded?: () => void;
}

/**
 * Three drums in the middle of the header: one pair of white dice on the
 * table, shared, plus the bonus die's own drum.
 *
 * The bonus drum is always there and rests on a black blank. That empty slot
 * is the design's point — it shows a Freight player what a Superchief gets
 * every turn, and makes the upgrade legible before you buy it rather than
 * after.
 *
 * Faces are not readable until the drums stop: the accessible name is the
 * value only once settled, which is the same rule the region panel follows.
 * A caller waiting on `onLanded` therefore cannot learn the roll early.
 */
export function Dice({ roll, live, onRoll, onLanded }: DiceProps) {
  const [drums, setDrums] = useState<[Drum, Drum, Drum]>(
    () => [rest(WHITE_FACES), rest(WHITE_FACES), rest(BONUS_FACES)]
  );
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const landed = useRef<(() => void) | undefined>(onLanded);
  landed.current = onLanded;

  // Keyed on the faces rather than the object: the caller rebuilds `roll`
  // every render, and keying on identity would restart the drums every tick.
  const key = roll === null ? '' : `${roll.white[0]}-${roll.white[1]}-${roll.bonus ?? 0}`;
  const started = useRef(key);
  const [begun, setBegun] = useState(key);

  useEffect(() => {
    if (started.current === key) return;
    started.current = key;
    setBegun(key);
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (roll === null) return;

    setDrums(current => [
      { ...current[0], left: dieTurn(current[0].cur, roll.white[0] - 1, WHITE_FACES, true) },
      { ...current[1], left: dieTurn(current[1].cur, roll.white[1] - 1, WHITE_FACES, true) },
      // The bonus drum laps only when it is showing something: falling round
      // to the blank should look like the die being put away, not thrown.
      { ...current[2],
        left: dieTurn(current[2].cur, roll.bonus ?? 0, BONUS_FACES, roll.bonus !== null) }
    ]);

    timer.current = setInterval(() => {
      setDrums(current => {
        const next: [Drum, Drum, Drum] = [tick(current[0]), tick(current[1]), tick(current[2])];
        if (next.every(stopped)) {
          if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
          landed.current?.();
        }
        return next;
      });
    }, DICE_MS);
  }, [key, roll]);

  useEffect(() => () => { if (timer.current !== null) clearInterval(timer.current); }, []);

  const turning = begun !== key || !drums.every(stopped);

  return (
    <div
      role="button"
      aria-label="Roll the dice"
      aria-disabled={!live}
      onClick={() => { if (live) onRoll?.(); }}
      style={{
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        display: 'flex', alignItems: 'center', gap: DIE.gap,
        cursor: live ? 'pointer' : 'default'
      }}
    >
      {drums.map((drum, index) => {
        const bonus = index === 2;
        const face = (at: number) => (bonus ? at : at + 1);
        const leaf = (at: number) =>
          bonus
            ? (face(at) === 0 ? COLORS.bonusBlank : COLORS.bonusLeaf)
            : (at === drum.cur ? COLORS.whiteTop : COLORS.whiteBottom);
        const pip = bonus ? COLORS.bonusPip : COLORS.whitePip;
        const value = face(drum.cur);
        const name = turning
          ? (bonus ? 'Bonus die, turning' : 'White die, turning')
          : bonus
            ? (value === 0 ? 'Bonus die, not earned' : `Bonus die, ${value}`)
            : `White die, ${value}`;

        return (
          <span
            key={index}
            role="img"
            aria-label={name}
            style={{
              position: 'relative', display: 'inline-block',
              width: DIE.width, height: DIE.height, borderRadius: DIE.radius,
              background: COLORS.body, overflow: 'hidden',
              boxShadow: '0 3px 8px rgba(0,0,0,0.55)'
            }}
          >
            <Leaf half="top" bg={leaf(drum.cur)} pips={pipCells(face(drum.cur), pip)} />
            <Leaf half="bottom" bg={leaf(drum.prev)} pips={pipCells(face(drum.prev), pip)} />
          </span>
        );
      })}
    </div>
  );
}

function Leaf({ half, bg, pips }: {
  half: 'top' | 'bottom'; bg: string; pips: { bg: string }[];
}) {
  const top = half === 'top';
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', left: 0, [top ? 'top' : 'bottom']: 0,
        width: DIE.width, height: DIE.leafHeight, overflow: 'hidden', background: bg,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,${top ? 0.18 : 0.12})`
      }}
    >
      <div
        style={{
          width: DIE.width, height: DIE.height, boxSizing: 'border-box',
          padding: DIE.padding, display: 'grid',
          gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)',
          gap: DIE.pipGap,
          ...(top ? {} : { marginTop: DIE.bottomOffset })
        }}
      >
        {pips.map((cell, i) => (
          <div key={i} style={{ borderRadius: '50%', background: cell.bg }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run src/board/Dice.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 9: Prove the readable-only-when-settled rule is load-bearing**

Temporarily replace `const turning = begun !== key || !drums.every(stopped);` with `const turning = false;` and re-run.
Expected: FAIL on "does not name the faces while the drums are still turning". Restore it.

- [ ] **Step 10: Put it on the board**

In `src/board/types.ts`:

```ts
export interface ScreenDef {
  // ...existing fields...
  /**
   * The dice this screen shows. There is one pair on the table and everyone
   * uses it, so this belongs to the screen rather than to a row.
   */
  dice?: { roll: TurnRoll | null; live: boolean } | null;
}
```

`types.ts` has no engine import today; add `import type { TurnRoll } from '../../engine';` at the top.

In `src/board/Board.tsx`, add to `BoardProps`:

```ts
  /** Fires once the dice have finished turning — the gate, as `awaitRegion` is. */
  awaitDice?: { onLanded: () => void } | null;
  onRollDice?: () => void;
```

and render inside the `<header>`, which already has `justify-content: space-between` — give it `position: 'relative'` so the absolutely-centred group has something to centre against:

```tsx
        {screen.dice && (
          <Dice
            roll={screen.dice.roll}
            live={screen.dice.live}
            onRoll={onRollDice}
            onLanded={awaitDice?.onLanded}
          />
        )}
```

In `src/board/screens/play.ts`, return `dice: { roll: pendingDice ?? state.rolled, live: ... }` — take the pending roll as a fourth parameter, exactly as `pending` is taken for the region, so the faces turn before the log carries them:

```ts
export function play(
  state: GameState,
  turns: Partial<Record<SeatId, number>> = {},
  pending: { seat: SeatId; region: RegionId } | null = null,
  pendingDice: TurnRoll | null = null
): ScreenDef
```

and in the returned object:

```ts
    dice: {
      roll: pendingDice ?? state.rolled,
      // Live only when the baron up has a destination and no dice yet.
      live: state.turn !== null
        && state.rolled === null
        && pendingDice === null
        && !needsDestination(state.seats[state.turn], nodeForCity)
    }
```

In `src/App.tsx`, hold the pending dice beside the pending destination roll and commit them on landing:

```ts
  /** Dice rolled but not yet told. Same gate as `rolling`, same reason. */
  const [rollingDice, setRollingDice] = useState<{ seat: SeatId; roll: TurnRoll } | null>(null);
```

```ts
    '/pass-and-play/game': state.phase === 'homes'
      ? homes(state, rolling && { seat: rolling.seat, region: regionOf(rolling.outcome) })
      : awaiting
        ? regionBallot(awaiting)
        : play(state, turns,
               rolling && { seat: rolling.seat, region: regionOf(rolling.outcome) },
               rollingDice?.roll ?? null)
```

and on the `<Board>`:

```tsx
        onRollDice={() => {
          if (state.turn === null || rollingDice !== null) return;
          const rolled = rollDice(state.turn);
          if (rolled === null) return;
          setRollingDice({ seat: state.turn, roll: rolled });
        }}
        awaitDice={rollingDice && {
          onLanded: () => { commitDice(rollingDice.seat, rollingDice.roll); setRollingDice(null); }
        }}
```

- [ ] **Step 11: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/board/dice.ts src/board/dice.test.ts src/board/Dice.tsx src/board/Dice.test.tsx \
        src/board/types.ts src/board/Board.tsx src/board/screens/play.ts src/App.tsx
git commit -m "feat: the shared dice readout, built to the departures-board design

Three split-flap drums centred in the header, pip faces, and a bonus drum
that rests on a black blank when none was earned — the empty slot shows a
Freight player what a Superchief gets every turn. The faces are unreadable
until the drums stop, so the dice cannot leak a roll the board has not told.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: The map becomes the play surface

You cannot tap dots on a departures board. This is where a turn is actually played: legal next dots light, the route builds as you tap, undo takes a step back, and commit appends the leg.

**Files:**
- Modify: `src/state/game.ts` (add `leg` to `GameState`)
- Modify: `src/state/game.test.ts` (append)
- Modify: `src/map/lit.ts`
- Modify: `src/map/lit.test.ts` (append)
- Create: `src/map/useRoute.ts`
- Create: `src/map/useRoute.test.tsx`
- Modify: `src/map/MapView.tsx`
- Modify: `src/map/MapView.test.tsx` (append)
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `GameState.leg: number`; `pawns(state): Map<NodeId, SeatId[]>`; `useRoute(state, onMove): RouteApi` where `RouteApi = { draft, legal, at, remaining, tap, undo, canCommit, commit, refused }`.

- [ ] **Step 1: Add the leg counter to replay**

Task 6 derived everything the map needs except one thing: which leg of the turn is being walked. The first leg spends the whole roll; a bonus leg spends only the bonus die.

Add to `GameState`:

```ts
  /**
   * Legs of the current turn already walked: 0 normally, 1 while a Bonus Roll
   * leg is owed. It decides how much movement the leg has — the whole roll,
   * or just the bonus die.
   */
  leg: number;
```

Initialise it to `0` in `emptyState`, and set `state.leg = open?.legs ?? 0;` beside `state.rolled` at the end of `replay`.

Append to `src/state/game.test.ts`, inside the "turn order" block:

```ts
  it('counts the leg so the bonus leg knows what it has to spend', () => {
    const base: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [6, 6], bonus: 4 }];
    expect(replay(base).leg).toBe(0);
    const after: GameEvent[] = [...base,
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    expect(replay(after).leg).toBe(1);
  });
```

Run: `npx vitest run src/state/game.test.ts` — FAIL first (`expected undefined to be 0`), then PASS.

- [ ] **Step 2: Write the failing test for pawns**

Append to `src/map/lit.test.ts`:

```ts
describe('where the pawns are', () => {
  it('is empty before anyone has a home city', () => {
    expect(pawns(replay([{ type: 'joined', seat: 'red', name: 'ADA' }])).size).toBe(0);
  });

  it('puts a baron on their home city node', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null }
    ]);
    expect(pawns(state).get(nodeForCity(43))).toEqual(['red']);
  });

  it('stacks two barons standing on the same node', () => {
    const state = replay([
      { type: 'joined', seat: 'red', name: 'ADA' },
      { type: 'joined', seat: 'green', name: 'GRACE' },
      { type: 'started' },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
      { type: 'arrived', seat: 'green', city: 47, region: 'PL', payout: null },
      { type: 'orderRolled', seat: 'red', first: 'red' },
      { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'red', path: [nodeForCity(43), nodeForCity(47)], arrived: false }
    ]);
    expect(pawns(state).get(nodeForCity(47))).toEqual(['red', 'green']);
  });
});
```

- [ ] **Step 3: Write `pawns`**

Append to `src/map/lit.ts`:

```ts
import type { NodeId } from '../../engine';

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
```

Run: `npx vitest run src/map/lit.test.ts` — FAIL first, then PASS.

- [ ] **Step 4: Write the failing test for the route hook**

Create `src/map/useRoute.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { nodeForCity } from '../../engine';
import type { GameEvent } from '../state/events';
import { replay } from '../state/game';
import { useRoute } from './useRoute';

const MINNEAPOLIS = nodeForCity(43);
const ST_PAUL = nodeForCity(47);

/** Red is up, heading for St. Paul from Minneapolis, with a roll of two. */
const midTurn: GameEvent[] = [
  { type: 'joined', seat: 'red', name: 'ADA' },
  { type: 'joined', seat: 'green', name: 'GRACE' },
  { type: 'started' },
  { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
  { type: 'arrived', seat: 'green', city: 29, region: 'SC', payout: null },
  { type: 'orderRolled', seat: 'red', first: 'red' },
  { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
  { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
];

describe('the draft route on the map', () => {
  it('offers nothing before the dice are rolled', () => {
    const state = replay(midTurn.slice(0, 7));
    const { result } = renderHook(() => useRoute(state, vi.fn()));
    expect(result.current.draft).toBeNull();
    expect(result.current.legal.size).toBe(0);
  });

  it('lights the legal next nodes once they are', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    expect(result.current.legal.has(ST_PAUL)).toBe(true);
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('extends the route on a tap and moves the head', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap(ST_PAUL); });
    expect(result.current.at).toBe(ST_PAUL);
  });

  it('reports why a tap was refused rather than swallowing it', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap('d0'); });
    expect(result.current.refused).toBe('not-a-neighbour');
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('takes a step back on undo', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    act(() => { result.current.tap(ST_PAUL); });
    act(() => { result.current.undo(); });
    expect(result.current.at).toBe(MINNEAPOLIS);
  });

  it('offers commit only once the route is complete', () => {
    const { result } = renderHook(() => useRoute(replay(midTurn), vi.fn()));
    expect(result.current.canCommit).toBe(false);
    act(() => { result.current.tap(ST_PAUL); });
    expect(result.current.canCommit).toBe(true);
  });

  it('hands the whole leg over on commit, once', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useRoute(replay(midTurn), onMove));
    act(() => { result.current.tap(ST_PAUL); });
    act(() => { result.current.commit(); });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('red', [MINNEAPOLIS, ST_PAUL], true);
  });

  it('refuses to commit an unfinished route', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useRoute(replay(midTurn), onMove));
    act(() => { result.current.commit(); });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('gives a bonus leg only the bonus die to spend', () => {
    const bonus: GameEvent[] = [...midTurn.slice(0, 7),
      { type: 'turnRolled', seat: 'red', white: [6, 6], bonus: 3 },
      { type: 'moved', seat: 'red', path: [MINNEAPOLIS, ST_PAUL], arrived: true },
      { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: 0 }];
    const { result } = renderHook(() => useRoute(replay(bonus), vi.fn()));
    expect(result.current.remaining).toBe(3);
  });
});
```

- [ ] **Step 5: Write the hook**

Create `src/map/useRoute.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import {
  arrived as hasArrived, back, complete, extend, here, movement, nodeForCity,
  options, path as pathOf, remaining as leftOf, startDraft,
  type Draft, type NodeId, type Rejection
} from '../../engine';
import type { SeatId } from '../state/events';
import type { GameState } from '../state/game';
import { destinationOf } from '../state/turns';

export interface RouteApi {
  draft: Draft | null;
  /** Nodes a tap would accept right now. */
  legal: ReadonlySet<NodeId>;
  at: NodeId | null;
  remaining: number;
  tap: (id: NodeId) => void;
  undo: () => void;
  canCommit: boolean;
  commit: () => void;
  /** Why the last tap was refused, or null. Cleared by the next accepted tap. */
  refused: Rejection | null;
}

const NOTHING: ReadonlySet<NodeId> = new Set();

/**
 * The route a player is tapping out, held here and nowhere else.
 *
 * It never touches the log, so undo is free and a reload loses it — an
 * annoyance on one tablet, not a lost game. It also does not cross tabs, which
 * is the right split: route-building happens in the tab that is playing, and
 * the other watches the committed move play back like any other spectator.
 */
export function useRoute(
  state: GameState,
  onMove: (seat: SeatId, path: readonly NodeId[], arrived: boolean) => void
): RouteApi {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refused, setRefused] = useState<Rejection | null>(null);

  const seat = state.turn === null ? null : state.seats[state.turn];
  const destination = seat === null ? null : destinationOf(seat);
  const roll = state.rolled;

  /**
   * How much this leg may spend. The first leg has the whole roll; a Bonus
   * Roll leg has only the bonus die, because the movement the white dice
   * bought was lost the moment the pawn arrived.
   */
  const legMovement = roll === null
    ? 0
    : state.leg === 0 ? movement(roll) : (roll.bonus ?? 0);

  // Rebuild whenever the turn, the leg or the destination changes — a draft
  // outliving the turn that started it would let a player spend last turn's
  // dice on this one.
  const key = `${state.turn ?? ''}|${state.leg}|${destination ?? ''}|${legMovement}`;
  useEffect(() => {
    if (seat === null || seat.at === null || destination === null || roll === null) {
      setDraft(null);
      setRefused(null);
      return;
    }
    setDraft(startDraft(seat.at, nodeForCity(destination), legMovement, seat.used));
    setRefused(null);
    // `key` is the whole dependency: seat and roll are rebuilt every render,
    // and depending on them would reset the draft on every tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tap = useCallback((id: NodeId) => {
    setDraft(current => {
      if (current === null) return current;
      const next = extend(current, id);
      if (typeof next === 'string') { setRefused(next); return current; }
      setRefused(null);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setRefused(null);
    setDraft(current => (current === null ? current : back(current)));
  }, []);

  const canCommit = draft !== null && complete(draft) && draft.steps.length > 0;

  const commit = useCallback(() => {
    if (draft === null || state.turn === null) return;
    if (!complete(draft) || draft.steps.length === 0) return;
    onMove(state.turn, pathOf(draft), hasArrived(draft));
    setDraft(null);
  }, [draft, state.turn, onMove]);

  return {
    draft,
    legal: draft === null ? NOTHING : new Set(options(draft).map(step => step.to)),
    at: draft === null ? (seat?.at ?? null) : here(draft),
    remaining: draft === null ? 0 : leftOf(draft),
    tap, undo, canCommit, commit, refused
  };
}
```

Run: `npx vitest run src/map/useRoute.test.tsx` — FAIL first, then PASS, 9 tests.

- [ ] **Step 6: Prove the leg rule is load-bearing**

Temporarily replace `state.leg === 0 ? movement(roll) : (roll.bonus ?? 0)` with `movement(roll)` and re-run.
Expected: FAIL on "gives a bonus leg only the bonus die to spend" — `expected 15 to be 3`. Restore it.

- [ ] **Step 7: Make the map tappable**

In `src/map/MapView.tsx`:

```ts
export interface MapViewProps {
  state: GameState;
  onBack: () => void;
  onMove: (seat: SeatId, path: readonly NodeId[], arrived: boolean) => void;
  /** The dice, threaded through so the map can roll them too — see below. */
  dice: { roll: TurnRoll | null; live: boolean };
  onRollDice: () => void;
  onDiceLanded: () => void;
}
```

**Why the dice appear on both surfaces.** The spec puts the readout on the board, shared. On one tablet that would mean tapping the dice on the board and then navigating to the map to move — an extra trip every turn, on the view that is *not* where the turn happens. The same `Dice` component renders here too, through the same `onRollDice`/`onDiceLanded` gate, so there is one implementation and one gate on two surfaces. If the design would rather the map carried its own idiom, that is a change to this component and nothing else.

Inside the component:

```tsx
  const route = useRoute(state, onMove);
  const standing = useMemo(() => pawns(state), [state]);
```

Give both lamp components two new props — `candidate: boolean` and `onTap?: () => void` — and have each render its `<g>` with a role only when tappable, so a lamp nobody may tap is not announced as a button:

```tsx
function Tappable({ label, onTap, children }: {
  label: string; onTap?: () => void; children: React.ReactNode;
}) {
  if (!onTap) return <g>{children}</g>;
  return (
    <g role="button" aria-label={label} onClick={onTap} style={{ cursor: 'pointer' }}>
      {children}
    </g>
  );
}
```

`CityLamp` wraps its existing contents in `<Tappable label={node.name ?? node.id} onTap={onTap}>`, `RouteLamp` in `<Tappable label={`Dot ${node.id}`} onTap={onTap}>`. A candidate lamp is also drawn lit, so `lit` becomes `lit={marker !== undefined || candidate}` on cities and `lit={candidate}` on dots.

Both lamp groups are then rendered as they already are, with the two extra props:

```tsx
              const candidate = route.legal.has(node.id);
              const onTap = candidate && replaying.done ? () => route.tap(node.id) : undefined;
```

**Junctions are never tappable**, and are not in `board.nodes.filter(...)` for either group — they are already excluded, since the existing code filters on `kind === 'dot'` and `kind === 'city'`. A junction is where the printed line forks, not a place, so the route passes through it rather than stopping on it. That means a legal step *into* a junction is never offered to the player and must be taken for them, as part of the tap that reaches the dot beyond. Do it in `useRoute.tap`, after a step is accepted:

```ts
      setRefused(null);
      // A junction is not a place. Taking it automatically means the player
      // taps dots — which is what the printed board looks like — and never has
      // to notice that the graph carries extra nodes. Only an unambiguous
      // continuation is taken: at a genuine fork the player must choose, and
      // the dots beyond both branches are offered instead.
      let landed = next;
      for (;;) {
        const onward = options(landed)
          .filter(step => nodeById(step.to).kind === 'junction');
        if (onward.length !== 1) break;
        const through = extend(landed, onward[0]!.to);
        if (isRejection(through)) break;
        landed = through;
      }
      return landed;
```

This needs `nodeById`, `options` and `isRejection` added to `useRoute.ts`'s engine import.

There is a consequence worth stating: with the pawn sitting on a junction after such a pass, `route.legal` is computed from that junction, so the dots it offers are the ones beyond the fork. That is the behaviour you want and it falls out — but it also means `complete()` refuses to commit there, which is why the junction clause in Task 5 exists.

Draw the drafted route as a bright line over the track, and a pawn per baron:

```tsx
          {route.draft && (
            <g>
              {pathOf(route.draft).slice(1).map((id, i) => {
                const a = board.byId.get(pathOf(route.draft!)[i]!);
                const b = board.byId.get(id);
                if (!a || !b) return null;
                return <line key={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                             stroke="#fff6e2" strokeWidth={3.4} strokeLinecap="round"
                             opacity={0.9} />;
              })}
            </g>
          )}
          <g>
            {[...standing].map(([id, seats]) => {
              const node = board.byId.get(id);
              if (!node) return null;
              return seats.map((seatId, i) => (
                <circle key={`${id}-${seatId}`} cx={node.x + i * 5} cy={node.y - 11} r={5}
                        fill={SEAT_COLORS[seatId]} stroke="#100c08" strokeWidth={1.4}>
                  <title>{state.seats[seatId].name}</title>
                </circle>
              ));
            })}
          </g>
```

and a HUD along the bottom, beside the existing roster strip:

```tsx
        {state.turn !== null && (
          <div style={{ position: 'absolute', top: 26, right: 34, zIndex: 4, display: 'flex', gap: 10 }}>
            <span style={{ /* the existing button styling */ }}>
              {route.remaining} left
            </span>
            <button onClick={route.undo} disabled={!route.draft?.steps.length}>UNDO</button>
            <button onClick={route.commit} disabled={!route.canCommit}>COMMIT</button>
          </div>
        )}
```

- [ ] **Step 8: Write the failing map test**

Append to `src/map/MapView.test.tsx`:

```tsx
describe('playing a turn on the map', () => {
  const midTurn: GameEvent[] = [
    { type: 'joined', seat: 'red', name: 'ADA' },
    { type: 'started' },
    { type: 'arrived', seat: 'red', city: 43, region: 'PL', payout: null },
    { type: 'orderRolled', seat: 'red', first: 'red' },
    { type: 'arrived', seat: 'red', city: 47, region: 'PL', payout: 0 },
    { type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null }
  ];
  const props = {
    onBack: vi.fn(), onRollDice: vi.fn(), onDiceLanded: vi.fn(),
    dice: { roll: null, live: false }
  };

  it('will not commit before a route has been tapped out', () => {
    render(<MapView state={replay(midTurn)} onMove={vi.fn()} {...props} />);
    expect(screen.getByRole('button', { name: 'COMMIT' })).toBeDisabled();
  });

  it('commits the tapped route as one leg', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    render(<MapView state={replay(midTurn)} onMove={onMove} {...props} />);
    await user.click(screen.getByRole('button', { name: /St\. Paul/ }));
    await user.click(screen.getByRole('button', { name: 'COMMIT' }));
    expect(onMove).toHaveBeenCalledWith(
      'red', [nodeForCity(43), nodeForCity(47)], true);
  });

  it('shows a pawn where the baron stands', () => {
    render(<MapView state={replay(midTurn)} onMove={vi.fn()} {...props} />);
    expect(screen.getAllByTitle('ADA').length).toBeGreaterThan(0);
  });
});
```

A tappable lamp must therefore carry `role="button"` and an accessible name of the city (or `Dot <id>` for a route dot) when it is a candidate, and no role at all when it is not.

- [ ] **Step 9: Run it, wire App, run everything**

Run: `npx vitest run src/map/MapView.test.tsx` — FAIL first, then PASS.

In `src/App.tsx`, pass the new props to `<MapView>`: `onMove={commitMove}`, and the same `dice` / `onRollDice` / `onDiceLanded` values the Board is given. Hoist the roll handler into a named function so both call sites share it rather than diverging.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/state/game.ts src/state/game.test.ts src/map/ src/App.tsx
git commit -m "feat: the map becomes the play surface

Legal next dots light, the route builds as you tap, undo is a slice and
commit appends one leg. Junctions are taken automatically — they are not
places, so the player taps dots and never learns the graph has extra nodes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Watching the move play back

A committed turn is a decisive move, not a sequence of taps — but it should still be watchable, in the tab that made it and in the one looking on.

**Files:**
- Modify: `src/state/game.ts` (add `lastMove`)
- Modify: `src/state/game.test.ts` (append)
- Create: `src/map/usePlayback.ts`
- Create: `src/map/usePlayback.test.tsx`
- Modify: `src/map/MapView.tsx`

**Interfaces:**
- Produces: `GameState.lastMove: { seat: SeatId; path: readonly NodeId[]; arrived: boolean } | null`; `usePlayback(path, stepMs?): { shown: readonly NodeId[]; done: boolean; skip: () => void }`.

- [ ] **Step 1: Expose the last committed move**

Playback has to come from the log, not from the draft — otherwise only the tab that played would see it, and the second screen is exactly who this is for.

Add to `GameState`:

```ts
  /** The leg most recently committed, for the map to walk. */
  lastMove: { seat: SeatId; path: readonly NodeId[]; arrived: boolean } | null;
```

`null` in `emptyState`, and in replay's `moved` case: `state.lastMove = { seat: event.seat, path: event.path, arrived: event.arrived };`

Append to `src/state/game.test.ts`:

```ts
describe('the last committed move', () => {
  it('is nothing before anyone has moved', () => {
    expect(replay(twoBarons).lastMove).toBeNull();
  });

  it('is the most recent leg, whoever walked it', () => {
    const log: GameEvent[] = [...twoBarons,
      { type: 'arrived', seat: 'green', city: MINNEAPOLIS_CITY, region: 'PL', payout: 0 },
      { type: 'turnRolled', seat: 'green', white: [1, 1], bonus: null },
      { type: 'moved', seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true }];
    expect(replay(log).lastMove)
      .toEqual({ seat: 'green', path: [ST_PAUL, MINNEAPOLIS], arrived: true });
  });
});
```

Run: `npx vitest run src/state/game.test.ts` — FAIL first, then PASS.

- [ ] **Step 2: Write the failing playback test**

Create `src/map/usePlayback.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayback } from './usePlayback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const PATH = ['a', 'b', 'c', 'd'];

describe('walking a committed path', () => {
  it('starts on the first node alone', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    expect(result.current.shown).toEqual(['a']);
    expect(result.current.done).toBe(false);
  });

  it('takes one node per step', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.shown).toEqual(['a', 'b']);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.shown).toEqual(PATH);
  });

  it('is done once it reaches the end, and stops there', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
  });

  it('finishes early when told to skip', () => {
    const { result } = renderHook(() => usePlayback(PATH, 100));
    act(() => { result.current.skip(); });
    expect(result.current.shown).toEqual(PATH);
    expect(result.current.done).toBe(true);
  });

  it('has nothing to walk without a path', () => {
    const { result } = renderHook(() => usePlayback(null, 100));
    expect(result.current.shown).toEqual([]);
    expect(result.current.done).toBe(true);
  });

  it('starts over when a new path arrives', () => {
    const { result, rerender } = renderHook(({ p }) => usePlayback(p, 100), {
      initialProps: { p: PATH as string[] | null }
    });
    act(() => { vi.advanceTimersByTime(1000); });
    rerender({ p: ['x', 'y'] });
    expect(result.current.shown).toEqual(['x']);
  });
});
```

- [ ] **Step 3: Write it**

Create `src/map/usePlayback.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeId } from '../../engine';

/** A dot a second is too slow to watch and too fast to follow; this is the middle. */
export const PLAYBACK_MS = 100;

/**
 * Walks a committed path one node at a time.
 *
 * The path comes from the log, not from the draft, so the tab that played the
 * turn and the tab watching it walk the same pawn over the same dots. A tap
 * finishes it early — the same rule the board already applies to a flap.
 */
export function usePlayback(
  path: readonly NodeId[] | null,
  stepMs: number = PLAYBACK_MS
): { shown: readonly NodeId[]; done: boolean; skip: () => void } {
  const [at, setAt] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Identity changes every render for a derived array, so key on the content.
  const key = path === null ? '' : path.join('|');

  useEffect(() => {
    setAt(0);
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    if (path === null || path.length === 0) return;
    timer.current = setInterval(() => {
      setAt(current => {
        const next = current + 1;
        if (next >= path.length - 1 && timer.current !== null) {
          clearInterval(timer.current);
          timer.current = null;
        }
        return Math.min(next, path.length - 1);
      });
    }, stepMs);
    return () => {
      if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stepMs]);

  const skip = useCallback(() => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    setAt(path === null ? 0 : Math.max(0, path.length - 1));
  }, [key]);

  const shown = path === null ? [] : path.slice(0, at + 1);
  return { shown, done: path === null || at >= path.length - 1, skip };
}
```

Run: `npx vitest run src/map/usePlayback.test.tsx` — FAIL first, then PASS, 6 tests.

- [ ] **Step 4: Walk the pawn on the map**

In `src/map/MapView.tsx`:

```tsx
  const replaying = usePlayback(state.lastMove?.path ?? null);
```

Draw the walked portion as a trail, and put the moving baron's pawn at `replaying.shown[replaying.shown.length - 1]` rather than at `seat.at` while `!replaying.done`. Add `onClick={replaying.skip}` to the cabinet so a tap anywhere finishes it. Suppress route-tapping while `!replaying.done` — a player must not start building a route over an animation of the last one.

Append to `src/map/MapView.test.tsx`:

```tsx
  it('will not take a tap while the last move is still playing back', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    const played: GameEvent[] = [...midTurn,
      { type: 'moved', seat: 'red', path: [nodeForCity(43), nodeForCity(47)], arrived: false }];
    render(<MapView state={replay(played)} onMove={onMove} {...props} />);
    expect(screen.queryByRole('button', { name: /St\. Paul/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 5: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/state/game.ts src/state/game.test.ts src/map/
git commit -m "feat: watch the committed move play back

The path comes from the log rather than the draft, so the tab that played
the turn and the tab looking on walk the same pawn over the same dots. A tap
finishes it early, as it does a flap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Golden games — the rules, stored as data

Borrowed from `acquire-startups-m1`, which holds seventeen of these in `engine/golden/` and calls them the executable rules spec. Each game is a fixture plus steps, and each step carries an intent and either the state it must produce or **the rejection code it must produce, with the state unchanged**.

These rules are mostly edge cases and every one of them is awkward to reach by playing normally, which is exactly why they are written down rather than found.

**Files:**
- Create: `engine/golden/types.ts`
- Create: `engine/golden/runner.ts`
- Create: `engine/golden/games.ts`
- Create: `engine/golden/index.ts`
- Create: `engine/golden/golden.test.ts`
- Create: `src/state/replay.golden.test.ts`

**Interfaces:**
- Produces: `FixtureSpec`, `GoldenIntent`, `StateAssertion`, `GoldenStep`, `GoldenGame`, `runGoldenGame(game): GoldenState`, `GAMES: readonly GoldenGame[]`.

- [ ] **Step 1: Write the types**

Create `engine/golden/types.ts`:

```ts
import type { TrainType, TurnRoll } from '../dice';
import type { Rejection } from '../movement';
import type { NodeId, RailroadId } from '../network';

export interface FixtureSpec {
  at: NodeId;
  destination: NodeId;
  train?: TrainType;
  /** Sections already spent this trip, as node pairs. */
  used?: readonly (readonly [NodeId, NodeId])[];
}

export type GoldenIntent =
  /** Roll the turn's dice, with the faces scripted so the game is a game. */
  | { kind: 'roll'; faces: readonly number[] }
  | { kind: 'step'; to: NodeId }
  | { kind: 'back' }
  | { kind: 'commit' }
  /** A new destination, named after arriving — the bonus-leg case. */
  | { kind: 'destination'; to: NodeId };

export type GoldenRejection = Rejection | 'route-incomplete' | 'no-roll' | 'nothing-to-undo';

export interface StateAssertion {
  at?: NodeId;
  spent?: number;
  remaining?: number;
  arrived?: boolean;
  complete?: boolean;
  /** How many sections the trip has spent. 0 after an arrival releases them. */
  usedCount?: number;
  bonus?: number | null;
  legOwed?: boolean;
  companies?: readonly RailroadId[];
}

export interface GoldenStep {
  name: string;
  intent: GoldenIntent;
  /** When set, the step must be REJECTED with this code and change nothing. */
  expectError?: GoldenRejection;
  then?: StateAssertion;
}

export interface GoldenGame {
  id: string;
  title: string;
  setup: FixtureSpec;
  steps: GoldenStep[];
  final?: StateAssertion;
}

export interface GoldenState {
  at: NodeId;
  destination: NodeId;
  train: TrainType;
  used: ReadonlyMap<string, number>;
  roll: TurnRoll | null;
  leg: number;
  draft: import('../route').Draft | null;
  /**
   * Every leg this game has committed, in order — exactly what a `moved`
   * event carries. It is here so the same story can be replayed through the
   * app's event log and the two made to agree.
   */
  legs: readonly { path: readonly NodeId[]; arrived: boolean }[];
}
```

- [ ] **Step 2: Write the runner**

Create `engine/golden/runner.ts`. It composes the engine's own functions in the same order `useGame` and `useRoute` do — deliberately, so a divergence between them is a bug one of the two suites catches:

```ts
import { expect } from 'vitest';
import { bonusLegOwed, movement, rollTurn } from '../dice';
import { isRejection } from '../movement';
import { sectionKey } from '../network';
import {
  arrived, back, companies, complete, extend, here, path as pathOf,
  remaining, spent, startDraft, usedAfter
} from '../route';
import type { GoldenGame, GoldenState, GoldenRejection, StateAssertion } from './types';

const scripted = (faces: readonly number[]) => {
  const queue = [...faces];
  return () => {
    const face = queue.shift();
    if (face === undefined) throw new Error('the golden game ran out of dice');
    return (face - 1) / 6;
  };
};

function build(game: GoldenGame): GoldenState {
  const used = new Map<string, number>();
  for (const [a, b] of game.setup.used ?? []) {
    const key = sectionKey(a, b);
    used.set(key, (used.get(key) ?? 0) + 1);
  }
  return {
    at: game.setup.at,
    destination: game.setup.destination,
    train: game.setup.train ?? 'freight',
    used, roll: null, leg: 0, draft: null, legs: []
  };
}

/** Applies one intent, or names why it could not be applied. */
function apply(state: GoldenState, step: GoldenGame['steps'][number]): GoldenState | GoldenRejection {
  const intent = step.intent;
  switch (intent.kind) {
    case 'roll': {
      if (state.roll !== null) return 'no-roll';
      const roll = rollTurn(state.train, scripted(intent.faces));
      const left = state.leg === 0 ? movement(roll) : (roll.bonus ?? 0);
      return {
        ...state, roll,
        draft: startDraft(state.at, state.destination, left, state.used)
      };
    }
    case 'step': {
      if (state.draft === null) return 'no-roll';
      const next = extend(state.draft, intent.to);
      if (isRejection(next)) return next;
      return { ...state, draft: next };
    }
    case 'back': {
      if (state.draft === null || state.draft.steps.length === 0) return 'nothing-to-undo';
      return { ...state, draft: back(state.draft) };
    }
    case 'commit': {
      if (state.draft === null) return 'no-roll';
      if (!complete(state.draft)) return 'route-incomplete';
      const draft = state.draft;
      const landed = arrived(draft);
      const owed = state.roll !== null && bonusLegOwed(state.roll, spent(draft), landed);
      return {
        ...state,
        at: here(draft),
        // "Everything is released on arrival" — the whole trip, not the leg.
        used: landed ? new Map() : usedAfter(draft),
        roll: owed ? state.roll : null,
        leg: owed ? state.leg + 1 : 0,
        draft: null,
        legs: [...state.legs, { path: pathOf(draft), arrived: landed }]
      };
    }
    case 'destination': {
      return {
        ...state,
        destination: intent.to,
        draft: state.roll === null
          ? null
          : startDraft(state.at, intent.to,
                       state.leg === 0 ? movement(state.roll) : (state.roll.bonus ?? 0),
                       state.used)
      };
    }
  }
}

function assertState(state: GoldenState, want: StateAssertion, where: string): void {
  const at = (what: string) => `${where} — ${what}`;
  if (want.at !== undefined) expect(state.at, at('at')).toBe(want.at);
  if (want.usedCount !== undefined) expect(state.used.size, at('used sections')).toBe(want.usedCount);
  if (want.bonus !== undefined) expect(state.roll?.bonus ?? null, at('bonus die')).toBe(want.bonus);
  if (want.legOwed !== undefined) expect(state.leg > 0, at('bonus leg owed')).toBe(want.legOwed);
  if (state.draft !== null) {
    if (want.spent !== undefined) expect(spent(state.draft), at('spent')).toBe(want.spent);
    if (want.remaining !== undefined) expect(remaining(state.draft), at('remaining')).toBe(want.remaining);
    if (want.arrived !== undefined) expect(arrived(state.draft), at('arrived')).toBe(want.arrived);
    if (want.complete !== undefined) expect(complete(state.draft), at('complete')).toBe(want.complete);
    if (want.companies !== undefined) {
      expect([...companies(state.draft)].sort(), at('companies'))
        .toEqual([...want.companies].sort());
    }
  } else {
    for (const field of ['spent', 'remaining', 'arrived', 'complete', 'companies'] as const) {
      expect(want[field], at(`${field} asserted with no draft`)).toBeUndefined();
    }
  }
}

export function runGoldenGame(game: GoldenGame): GoldenState {
  let state = build(game);

  game.steps.forEach((step, index) => {
    const where = `${game.id} step ${index + 1} (${step.name})`;
    const before = JSON.stringify(state, (_, value) =>
      value instanceof Map ? [...value] : value);
    const result = apply(state, step);

    if (step.expectError !== undefined) {
      expect(result, `${where} — expected rejection ${step.expectError}`).toBe(step.expectError);
      const after = JSON.stringify(state, (_, value) =>
        value instanceof Map ? [...value] : value);
      expect(after, `${where} — a rejected intent must change nothing`).toBe(before);
    } else {
      expect(typeof result, `${where} — unexpected rejection: ${String(result)}`)
        .not.toBe('string');
      state = result as GoldenState;
    }

    if (step.then) assertState(state, step.then, where);
  });

  if (game.final) assertState(state, game.final, `${game.id} final`);
  return state;
}
```

- [ ] **Step 3: Write the games**

Create `engine/golden/games.ts` with one game per row of the spec's table. Before writing them, print the neighbourhood each one needs:

```bash
node -e "
const n=require('./engine/network.json');
const by=new Map(n.nodes.map(x=>[x.id,x]));
const at=id=>n.edges.filter(e=>e.a===id||e.b===id)
  .map(e=>{const o=e.a===id?e.b:e.a;
    return o+':'+by.get(o).kind+':'+(by.get(o).name||'')+':['+e.railroads.join(',')+']';});
for (const id of ['c13','c95','c40','c41']) console.log(id, by.get(id).name, '->', at(id).join(' '));
const j=n.nodes.filter(x=>x.kind==='junction');
for (const x of j) console.log('junction', x.id, '->', at(x.id).join(' '));
"
```

Write these nine, using the real ids that prints:

| `id` | Title | What it pins |
|---|---|---|
| `reuse-by-another-line` | a trip that re-crosses its own dots by a different line | no-reuse is per *section*, not per dot: an edge carrying two companies takes two crossings, and a third is `section-used` |
| `trip-across-turns` | a trip that spans several turns | `used` survives a commit that did not arrive, and is empty after one that did |
| `junction-company` | a route through a junction | a step off a junction onto another company's line is `wrong-company` |
| `twin-minneapolis` | Minneapolis and St. Paul | the pair costs one dot: the crossing is `cost: 0` |
| `twin-bay` | San Francisco and Oakland | the same, for the other pair — both, not one |
| `stranding` | a step that would strand the pawn | `would-strand`, and the state unchanged |
| `arrive-with-spare` | a roll that arrives with movement to spare | the route is `complete` with `remaining > 0`, and no further step is offered |
| `bonus-die` | double six on Freight, any double on Express, every turn on Superchief | who earns a Bonus Roll, and never twice |
| `bonus-leg` | arriving on the white dice, then a bonus leg | `legOwed`, a *new* destination, and `usedCount: 0` |

Each game must be written against the ids the script printed, not against ids assumed here. `bonus-die` is three games in one file if that reads better — split it rather than parameterising it, because a golden game's value is that it states one rule exactly.

Create `engine/golden/index.ts`:

```ts
export { runGoldenGame } from './runner';
export { GAMES } from './games';
export type { FixtureSpec, GoldenGame, GoldenStep, StateAssertion } from './types';
```

- [ ] **Step 4: Run them**

Create `engine/golden/golden.test.ts`:

```ts
import { describe, it } from 'vitest';
import { GAMES } from './games';
import { runGoldenGame } from './runner';

describe('golden games', () => {
  for (const game of GAMES) {
    it(`${game.id}: ${game.title}`, () => { runGoldenGame(game); });
  }
});
```

Run: `npx vitest run engine/golden/golden.test.ts`
Expected: PASS, nine or more games.

- [ ] **Step 5: Prove they can fail**

Break one rule at a time in the engine and confirm the matching game — and only it — fails:

| Break | Game that must fail |
|---|---|
| `stepCost` always returns 1 | `twin-minneapolis`, `twin-bay` |
| `stepTo` drops the `would-strand` check | `stranding` |
| `sectionsLeft` returns `Infinity` | `reuse-by-another-line` |
| `earnsBonus('freight', …)` returns true always | `bonus-die` |
| `bonusLegOwed` returns false always | `bonus-leg` |

Restore each before moving to the next. A break that fails *no* game means that game is not pinning what it claims to — fix the game, not the note.

- [ ] **Step 6: Cross-check the runner against replay**

The runner composes the same engine functions `useGame` and `useRoute` do, and nothing forces the two to agree. This is the test that does. It is why `GoldenState.legs` exists.

Create `src/state/replay.golden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cityAt } from '../../engine';
import { GAMES } from '../../engine/golden/games';
import { runGoldenGame } from '../../engine/golden/runner';
import type { GameEvent } from './events';
import { replay } from './game';

/**
 * A golden game and the event log say the same thing two different ways: the
 * runner folds the engine's functions, replay folds the log. They are two
 * implementations of one rule, so this is where they are made to agree.
 * Without it the executable rules spec could drift away from the game the app
 * actually plays, and neither suite would notice.
 *
 * The log is built rather than scripted: a baron seated at the fixture's
 * starting node, then one `moved` per committed leg. `turnRolled` is included
 * because replay's leg counter reads it, and its faces are irrelevant here —
 * this test is about where the pawn ends and what the trip has spent, not
 * about the dice.
 */
describe('replay agrees with the golden runner', () => {
  for (const game of GAMES) {
    it(`${game.id}: leaves the pawn and the trip in the same state`, () => {
      const finished = runGoldenGame(game);

      const home = cityAt(game.setup.at);
      if (home === null) return;    // a fixture starting on a dot has no home roll

      const log: GameEvent[] = [
        { type: 'joined', seat: 'red', name: 'ADA' },
        { type: 'started' },
        { type: 'arrived', seat: 'red', city: home, region: 'PL', payout: null },
        { type: 'orderRolled', seat: 'red', first: 'red' }
      ];
      for (const leg of finished.legs) {
        log.push({ type: 'turnRolled', seat: 'red', white: [1, 1], bonus: null });
        log.push({ type: 'moved', seat: 'red', path: [...leg.path], arrived: leg.arrived });
      }

      const seat = replay(log).seats.red;
      expect(seat.at, 'where the pawn ended').toBe(finished.at);
      expect(seat.used.size, 'sections the trip has spent').toBe(finished.used.size);
    });
  }
});
```

The `home === null` escape covers fixtures that start on a route dot rather than a city — a home city is a city, so those games have no log to build. Every fixture in Step 3's table starts on a city, so no game should actually take that branch; if one does, either start it on a city or drop the escape and give the fixture a home explicitly.

The region on the synthesized `arrived` must be the one the starting city really belongs to, or `isGameEvent` would reject the log. Use `cityById(home).region` rather than the literal `'PL'` above.

Run: `npx vitest run src/state/replay.golden.test.ts`
Expected: PASS, one test per game.

Then prove it can fail: temporarily make replay's `moved` case keep `used` on arrival (drop the `event.arrived ? new Map() :` branch) and re-run.
Expected: FAIL on every game that arrives, with `sections the trip has spent`. Restore it.

- [ ] **Step 7: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add engine/golden src/state/replay.golden.test.ts
git commit -m "test: golden games, the movement rules stored as data

Nine games, one rule each, every one of them awkward to reach by playing
normally. The cross-check against replay is what stops the executable rules
spec drifting away from the game the app actually plays.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the last task

Nothing in this plan touches money, ownership, auctions or the win condition — the next spec. Two things it deliberately leaves standing, both already noted in the spec:

- **The Train column and the Baron/Total tiles** in `Departures Board.dc.html` are not built. The train is a money concept and the total is cash; both belong with the money spec. The design's train list includes "Fast Freight", which this rulebook does not have — do not copy it.
- **Dev-only routes seeded from the golden games**, and a `check:bundle` script keeping the fixtures out of production, are worth having for the same reason Acquire has them. They are a follow-on, not part of this spec.
