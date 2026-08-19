# Rail Baron React port — design

**Date:** 2026-08-11
**Status:** Design agreed; Phase 0 data complete and validating clean
**Covers:** Phase 1 of [ROADMAP.md](../../../ROADMAP.md) — replacing the 2013 jQuery app

## What and why

Rail Baron is played on a physical board. The app is a **destination roller**: on a
player's turn it rolls a region, then a city within it, and reports what that journey
pays. The 2013 version does this with jQuery and split-flap displays and is still
playable; the port keeps the job identical and replaces the execution.

**Scope ruling: the roller only.** No movement, no railroad ownership, no cash, no win
condition. The map graph carries dot counts and railroad attribution anyway, so movement
can be layered on later without re-extracting anything — but nothing in Phase 1 reads them.

Two things are new. The board is redesigned as a **departures board** — six player rows of
split-flap, styled from the concepts in the Rail Baron Game Board Design project. And the
network gets a **vector map**, reachable as a second view.

## Decisions

| Decision | Why |
|---|---|
| Roller now, full graph captured anyway | The expensive part is reading the board by hand. Doing it once, completely, costs one pass; discovering later that dot counts were skipped costs the whole pass again. |
| Real geography (Albers), not scan pixels | Resolution-independent and already half-built in the map concepts. Pinning every dot to a lat/lon means the printed route's real shape survives into a geographic rendering — the two are not a trade-off. |
| Tablet, landscape, single layout | Where the app actually sits during a game. Six 14-character split-flap rows cannot fit a phone in portrait without becoming a different design. |
| Departures board primary, map second view | Both designs keep their drawn proportions. Squeezing them onto one screen shrinks each below what it was designed for. |
| Delete the jQuery app rather than keep it alongside | Git history keeps it. Two Rail Barons in one repo is how the wrong one gets edited. |

## The data model

Three node kinds, and the cost model falls out of them rather than being enforced:

| On the board | `kind` | Costs a move |
|---|---|---|
| White square, black stroke | `city` | yes |
| Plain black dot, no stroke | `dot` | yes |
| Nothing — the line forks, or bends | `junction` | **no** |

A path's cost is the count of `dot` nodes traversed. Junctions contribute zero because
they are not dots — no rule, no special case at movement time.

**Junctions do two jobs.** Three or more edges is a fork. Exactly two is a *bend point*,
placed to shape the drawn route so a coastal line follows the shore instead of cutting
across water. Both are free.

**Edges are undirected adjacency between neighbouring nodes**, each carrying the list of
railroads running over it. Shared trackage is one edge naming several railroads, not
parallel edges. Node ids are positional (`d12` is index 12 in the editor's dots array,
including rejected entries) so an id never shifts meaning; a rejected endpoint orphans its
edges rather than silently repointing them.

## The data pipeline

```
data/rail-baron-graph.json     editor export, scan pixel space, hand-verified
        ↓  scripts/build-network.mjs          (to be written)
src/data/network.json          what the app ships
```

The build fits a scan→lat/lon warp from the 67 city correspondences, pushes every dot and
junction through it, attaches names and regions to cities, and **fails on any structural
defect**.

**The warp is a thin-plate spline over the 67 city control points, not the affine fit** the
registration script uses. Affine is right for registration — it is rigid enough to stop a
mis-assignment bending the fit to accommodate itself — but it cannot absorb the printed
map's local distortions, and a 50px residual in the Bay Area would put dots in the water.
A TPS interpolates the control points exactly and distributes the error between them. The graph is hand-traced and will drift as it is corrected; a build that refuses
to emit bad data is what stops a mistake reaching the board. Output is committed, so the
app never needs the scan at runtime.

Two scripts already exist and stay:

- **`scripts/validate-graph.mjs`** — dead-end dots, dangling junctions, orphan edges,
  duplicate edges, self-loops, unrouted nodes, per-railroad connectivity, whole-network
  connectivity, city count. Exits non-zero. When a railroad is in two pieces it reports the
  closest cross-piece node pair, because that is almost always where the missing edge goes.
- **`scripts/propose-city-names.mjs`** — registers the 67 known lat/lons onto the city
  nodes (US Albers, then iterated affine fit, then one-to-one assignment) and reports
  residuals so doubtful matches surface. It found the missing 67th city by elimination.

### Current state of the data

Validates clean: **471 dots, 67 cities, 12 junctions, 710 edges** (36 shared by more than
one railroad), 28 railroads, one connected component.

**Names are settled.** `data/city-names.json` holds all 67, keyed by node id, each one
checked to match `engine/cities.ts` exactly — the build joins the two by name string, not
by id, so a typo drops a bulb off the map rather than failing loudly.

Five sat inside twin pairs where a swap costs no payout — both members share a region and
pay each other $0 — so nothing in the roller could have caught a mistake. They resolved
differently:

- **Bay Area, from the graph.** `c40`–`c41` is a direct AT&SF/SP edge 5.5px long, so that
  pair is the bay crossing; `c94` sits 29–33px inland on WP/SP. Within the pair, `c40`'s
  only edge is to `c41` — a single-edge peninsula terminus is San Francisco, and `c41` is
  the mainland hub with track running east. This is what the registration's worst residual
  in all 67 cities was reporting: it had put San Francisco at `c94`, scoring 49.93.
  `c40` = San Francisco, `c41` = Oakland, `c94` = Sacramento.
- **Twin Cities, by ruling.** The westward ordering made `c13` Minneapolis; the railroad
  topology argued the other way, GN and NP having been headquartered in St. Paul. Settled
  on the drawn network: every route points at the hub, the hub is Minneapolis, and St. Paul
  is a spur off it. `c13` = Minneapolis, `c95` = St. Paul — `c95` had carried no name at
  all, Minneapolis being the single unclaimed one.

`scripts/propose-city-names.mjs --write` still emits `data/city-names-proposed.json`. That
is a diagnostic to compare against the verified file, never a substitute for it.

**What remains for the map is the warp**, not the names — `scripts/build-network.mjs` is
still to write.

## The game data, and what to fix while porting

All of it is in [`js/railbaronv2.js`](../../../js/railbaronv2.js) — one file, IIFE
singleton, no modules:

- **`codes`** — 22 rows indexed by `roll()`, which is one d6 + one d6 + a d2×11. Column 0
  gives the region; columns 1–7 give the city within each region.
- **`regions`** — 7 entries; `index` is 1-based and indexes into `cities`.
- **`cities`** — 7 groups, 67 cities, each with a globally unique `index` 0–66.
- **`payouts`** — triangular, `payouts[high][low]` by global city index, in thousands.
  Verified structurally sound: 67 rows, row *n* holding exactly *n* entries, so every pair
  is covered.

Carry these across as fixes, not as faithful reproductions:

1. **`cities[4]` and `cities[5]` are labelled `"South Central"`** and should be Plains and
   Northwest. Three groups carry that label but only two wrongly — `cities[3]` really is
   South Central, and `cities[6]` is already correctly `"Southwest"`. The current app
   survives it because region names are read from `regions`, never from the city groups.
2. **`player.chooseRegion` is dead code** duplicating the live path, and would throw if
   called — it uses `game.getRandomRegion`, which is not on the controller's interface.
   Drop it rather than porting it.
3. **The payout matrix has never been checked against the board.** Structure is sound;
   values are unverified. A single transposed number is invisible until it pays someone
   wrong.

### The $0 hazard

**Minneapolis↔St. Paul and San Francisco↔Oakland both pay exactly $0** — the only two zero
pairs in the whole matrix. They are legal destinations you can be sent to; the journey is
simply worth nothing.

A zero payout is falsy. Any `if (payout)` or `payout || fallback` turns a legitimate roll
into a missing value. It has to reach the board as `$0`. This is the single most likely
silent bug in the port, and it is worth a test that asserts both pairs render.

## The app

Vite + React + TypeScript. Four pieces that do not reach into each other:

| Path | Contents |
|---|---|
| `engine/` | The rules. Pure, no React, no DOM. Roll tables, regions, cities, payout lookup, destination selection. Where the tests live. |
| `src/game/` | Components. The departures board — `SplitFlap`, `DeparturesRow`, `RegionBallot`, `SignupRow` — and the map view. |
| `src/state/` | The event log and its reducer. |
| `src/data/` | Built `network.json`. Generated, committed, never hand-edited. |

**State is derived by replaying an event log**, not mutated in place. Events are
`playerJoined`, `playerNamed`, `rolled`, `regionChosen`. Undo is truncating the log; the
whole game state is a fold over it. This is also what makes a server-authoritative rewrite
possible later without redesigning the state layer.

**Persistence is namespaced `localStorage`** — both this game and Acquire will share the
GitHub Pages origin, so unprefixed keys would collide.

### Interaction

The board carries six rows, one per baron. A row starts as *tap to join*, which opens a
name field. Once playing, tapping a row rolls that baron's next destination: the region
flap settles first, then the city, then the payout.

**When the roll returns the region a player is already in**, the destination column becomes
a seven-row ballot — the region names replace the destination text across the board and the
player picks one. This is the existing app's `"ask"` branch, redesigned. It is the only
modal state in the app.

The map view shows the network in Albers projection: one bulb per real dot at its real
place, cities as larger lamps, each player's destination lit in their colour.

### Testing

`engine/` is pure, so it tests directly: the roll table's shape and distribution, payout
matrix symmetry and coverage, the same-region re-pick path, and the two $0 pairs. Prove a
new test can fail by breaking the code and reading real output — never by reading the
assertion.

## What Phase 1 owes Phase 3

Online multiplayer will consume the lobby extracted from `acquire-startups-m1`, whose
extraction design names this repo as its intended second consumer and sets the shape above:
a pure `engine/`, components under `src/game/`, state replayed from a log, namespaced
storage keys. Adopting it now costs nothing; retrofitting it later costs a rewrite of the
state layer. The lobby is turn-agnostic — it knows seats, tokens, lifecycle and presence,
never turns — so a roller with no turn order sits on it unchanged.

## Out of scope

Movement and route-finding. Railroad ownership, purchase and fees. Cash and the win
condition. Phone layouts. The pass-and-play menu (Phase 2). Anything online (Phase 3).
Changing the map editor, which is a one-off living in the design project and has done
its job.
