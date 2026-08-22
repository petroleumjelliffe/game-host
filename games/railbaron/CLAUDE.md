# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **companion app** for the Avalon Hill board game *Rail Baron*, not an implementation of
it. Players use the physical board; the app rolls each baron's next destination — region,
then city — looks up the payout for the journey, and since Phase 4 walks the pawn: strict
turn order, the movement dice, and a route tapped out dot by dot on the map. Since 2026-08-22 the money's
first half is modelled: `banked` per baron (completed trips only — `earned` still
includes the trip in flight), a win rule (reach the target, then reach home; see the
game-host repo's `specs/2026-08-22-money-phase-1.md`), house rules from
`DATA_DIR/railbaron/rules.json` stamped into the log at Begin, and optional seeded
dice that `legal.ts` verifies. Still not modelled — phase 2 — are ownership,
purchases, user fees, auctions, train upgrades, and the rover play (whose rule must be
transcribed from the table before designing anything).

The repo holds the React port. The original 2013 jQuery app was deleted once the port
was complete and tested — it remains in git history, but there is only one Rail Baron in
this repo now. [ROADMAP.md](ROADMAP.md) has the phases and the reasoning; Phases 1 and 2
(the roller, the pass-and-play front door) are done, and so is Phase 4's first half —
turns and movement, with the map as the play surface and the movement rules stored as
data under [`engine/golden/`](engine/golden/). The money spec's first half (cash, the win condition, house rules, seeded dice)
landed 2026-08-22; its second half (ownership, fees, trains, the rover) is ahead.

## Commands

```bash
npm install

npm run dev        # Vite dev server, http://localhost:7931/railbaron/
npm run dev:server  # game server (online mode), port 4001
npm run dev:all     # both at once; online mode needs both
npm test            # vitest run — every project, once
npm run test:watch  # vitest, watch mode
npm run typecheck   # tsc --noEmit
npm run build        # vite build, production bundle to dist/
npm run preview      # serve the production build locally
npm run serve        # build, then one process hosting client + sockets on 4001

npx vitest run engine/payouts.test.ts        # one test file
npx vitest run --project node                # one project (node | app)
npx vitest run src/board/screens/play.test.ts -t "shows a zero-paying"  # one test by name
# scope -t to a file: a bare name filter marks every non-matching file as failed

npm run graph:validate  # structural checks on data/rail-baron-graph.json
npm run network:build   # rebuild engine/network.json from the traced graph
npm run outline:build   # rebuild the coastline outline
```

Ports come from the cross-game registry — canonical in the sibling
[`game-host`](../game-host) repo's `PORTS.md`, alongside the Caddy reverse proxy and
game-night menu that consume it: each game hosted from this machine gets a server slot
(4001+) and a dev-client slot (7931+); Rail Baron is 4001/7931, and the numbers live in
exactly three places — that registry, the server's boot default, and `vite.config.ts`.
The client is origin-relative (`src/config.ts`): pages, assets and sockets ride the
page's origin, sockets mounted at `/railbaron/socket.io`, and health answers at both
`/health` and `/railbaron/health`. In dev, Vite's proxy carries the one socket path to
the server on 4001; hosted (`npm run serve`, or behind game-host's front door), the
server answers it itself. Vite pins its port with `strictPort` and listens on the LAN
(`host: true`), so friends on the wifi reach it directly or through the proxy. (The
LAN-hosting spec,
[docs/superpowers/specs/2026-08-16-lan-hosting-design.md](docs/superpowers/specs/2026-08-16-lan-hosting-design.md),
is design history: its client-side `hostname:port` derivation was retired for
origin-relative sockets — see the game-host repo's
`specs/2026-08-17-origin-relative-clients.md`.) A build that sets `VITE_SERVER_URL`
wins outright and keeps socket.io's default path — that server owns its whole origin.
`SOCKET_PATH` in the environment moves the socket mount at boot (nothing sets it
today; it exists for a deploy that owns its whole origin). To move the server port for
a one-off, put `VITE_SERVER_PORT=<port>` in `.env.local` (gitignored) and move
`vite.config.ts`'s proxy target with it; `PORT` still overrides.

Tests run as two Vitest projects (`vite.config.ts`). **`node`** takes everything that runs
inside the server process in production — `engine/`, `session/`, `server/`, the pure half
of `src/state/`, and the lobby's `protocol/` and `server/` halves. **`app`** takes the rest
of `src/` and the lobby's `client/`, under `jsdom` with `src/test/setup.ts` loaded.

The split of `src/state` is one honest line: `storage.test.ts` is the file whose subject
*is* `localStorage`, so it stays in jsdom, and the extglob `src/state/!(storage).test.ts`
names it once for both projects to read. Do not add a root-level `setupFiles` — vitest 4
merges those into every project, which would bridge jsdom's Storage into the node project
and silently disarm `session/nodeEnvironment.test.ts`, the test that guards the boundary.
`engine/smoke.test.ts` asserts `window` is `undefined` in the engine project, so a React
or DOM dependency creeping into `engine/` fails a test rather than surviving unnoticed.
(It does not also assert `localStorage` is `undefined`: Node 26 defines
`globalThis.localStorage` as a getter that returns `undefined` without
`--localstorage-file`, in both the plain-node project and a bare jsdom project alike —
jsdom's real `Storage` only reaches `globalThis` via the bridge described below, which
this project doesn't load — so that half would pass in both environments and guard
nothing.)

## The game data, and its known bugs

Everything the roller needs is under [`engine/`](engine/) — no React, no DOM. The 2013
source it was transcribed from, `js/railbaronv2.js`, no longer exists in the working tree
but is still in git history (`git log --all --full-history -- js/railbaronv2.js`).

- **[`engine/rollTable.ts`](engine/rollTable.ts)'s `CODES`** — a 22-row lookup indexed by
  `rollRow()`, which is one d6 + one d6 + a d2×11. Column 0 gives the region; columns 1–7
  give the city within each region.
- **[`engine/regions.ts`](engine/regions.ts)'s `REGIONS`** — 7 entries.
- **[`engine/cities.ts`](engine/cities.ts)'s `CITIES`** — 7 region groups, 67 cities, each
  with a globally unique `id` 0–66.
- **[`engine/payouts.ts`](engine/payouts.ts)'s `PAYOUT_TABLE`** — a triangular matrix
  indexed `[high][low]` by those global city ids, in thousands.

Each table carries a digest test pinning the transcription — `PAYOUT_TABLE_DIGEST` in
[`engine/payouts.test.ts`](engine/payouts.test.ts), `CODES_DIGEST` in
[`engine/rollTable.test.ts`](engine/rollTable.test.ts) — an FNV-1a hash over every cell.
Range and coverage checks can pass on a transposed or mis-copied value; the digest can't.
If you deliberately change a cell (a real correction, not a transcription fix), recompute
and update the digest constant in the same commit, and say why in the commit message.

Defects carried across from the source rather than reproduced-and-fixed:

- **The two mislabelled city groups are fixed.** Counting `engine/cities.ts`'s `GROUPS`
  array in file order, 1-indexed, the 2013 source labelled the 5th and 6th groups —
  **the group containing Denver, Kansas City, Minneapolis and St. Paul** (actually Plains)
  and **the group containing Billings, Seattle and Spokane** (actually Northwest) — both
  `"South Central"`. The 4th group (Birmingham, Dallas, Houston) genuinely is South
  Central and was labelled correctly; three groups carry the literal string, only two are
  wrong. The port's `engine/cities.ts` uses the correct region for each, so this is not a
  live bug — noted here only because it explains why the 2013 file and the port disagree.
  This exact off-by-one (miscounting which two groups are the wrong ones) has recurred in
  project docs before — if you're editing this again, name the groups by contents as
  above, not only by ordinal.
- **The payout matrix was checked against the source, not against the physical board.**
  The digest tests prove the transcription is faithful to `js/railbaronv2.js`; they cannot
  prove the source itself was ever right. See task-3-report.md for how the comparison was
  done.
- `chooseRegion` (the source's second, unreachable destination-computation path) was
  dropped rather than ported — there is only one path now.

### The `$0` constraint

Minneapolis↔St. Paul and San Francisco↔Oakland are the board's only two zero-paying
journeys — legal destinations, worth nothing to land on. `payoutBetween` returns `0` for
them, a real, displayable amount. This is unrelated to `payout: null`, which means "no
payout applies" (the roll landed on the baron's own home town) and renders as `Home`
instead of a dollar figure — see the `paid` derivation in
[`src/board/screens/play.ts`](src/board/screens/play.ts). Anywhere on this path,
`if (payout)` or `payout || fallback` is a bug: both are falsy-on-zero and would treat a
real $0 payout as if it were the null case. Three tests guard the distinction —
`engine/payouts.test.ts` for the matrix, `src/board/screens/play.test.ts` for the two
render cases ("says HOME rather than a payout for a home town", "shows a zero-paying
journey as a real zero, not as blank"), and `src/state/events.ts`'s validator, which
accepts `payout: 0` and would silently discard every saved $0 journey if written as a
truthiness check.

## The map graph

Phase 0 converts the printed map into a graph. Three node kinds, and the distinction is
the cost model:

| On the board | In the data | Costs a move |
|---|---|---|
| White square, black stroke | `city` | yes |
| Plain black dot, no stroke | `dot` | yes |
| Nothing — the line simply forks | `junction` | **no** |

So path cost is the count of `dot` nodes traversed; junctions fall out for free with no
special case. Edges are undirected adjacency between *neighbouring* nodes, carrying the
list of railroads running over them — shared trackage is one edge with several railroads,
not parallel edges.

**Junctions do two jobs, and only one of them is forking.** Three or more edges means a
fork. Exactly two means a *bend point*, placed to shape the drawn route — a coastal line
needs them to follow the shore instead of cutting across water. Both are free, so neither
affects movement; a two-edge junction is correct data, not an unfinished fork.

**Node ids are positional and load-bearing.** `d12` means index 12 in the editor's dots
array *including rejected entries*, so ids stay stable when a point is rejected. Never
renumber; a rejected endpoint orphans its edges rather than silently repointing them.

Coordinates in `data/` are **scan pixel space, 1280×642**. The pipeline:
[`data/rail-baron-graph.json`](data/rail-baron-graph.json) is the hand-traced source of
truth; [`scripts/build-network.mjs`](scripts/build-network.mjs) (`npm run network:build`)
fits a scan→geography warp — a thin-plate spline through the 67 city correspondences,
via Albers — and writes [`engine/network.json`](engine/network.json), which is what the
app imports (via `engine/network.ts`). So the shipped data is real geography while the
printed map's actual route shapes survive — one rendered bulb per real dot, at its real
place. After editing the traced graph, run `npm run graph:validate` (dead ends, orphans,
railroads secretly in two pieces) and rebuild the network; the build fails loudly rather
than emitting suspect data.

### The editor is not in this repo

The one-off tool that produced the graph lives in the **Rail Baron Game Board Design**
project on claude.ai/design, alongside the board concepts it was designed from. It runs
against a scan of the map and holds its working state in browser `localStorage` plus
`graph-base.json` in that project. Don't go looking for it here, and don't rebuild it —
ask before changing it.

The design project also holds the visual direction the port is built to: a departures-board
split-flap treatment for the main screen, and a lightbulb-map treatment for the map view.

## Online mode

Built, tested, and **not yet deployed or played by hand** — see
[`docs/superpowers/specs/2026-08-14-online-by-hand-notes.md`](docs/superpowers/specs/2026-08-14-online-by-hand-notes.md)
for what building it found and what is still owed.

**The log is the wire.** The acting client rolls locally behind the existing
roll→announce→commit gates and sends the resulting `GameEvent`; the server validates it,
appends, persists and broadcasts *the whole log*; every client's state is `replay(log)`,
exactly as pass-and-play is `replay(localStorage)`. There is no incremental sync and no
optimistic apply — a client that missed a broadcast is repaired by the next one.

| Directory | What lives there |
|---|---|
| `session/` | The game half of the wire — versions, message shapes, rejection codes. Node-safe. |
| `server/` | The authoritative server: store, rooms, the two game handlers, boot. |
| `src/net/` | The client half — transport, `useRoom`, `useOnlineGame`. |
| `src/board/screens/online.ts` | Boards 1d/1f and the terminals. |
| `src/GameShell.ts` | The board-driving glue both modes share. |
| `src/OnlineApp.tsx` | The online routes. |

Three things carry the design, and breaking any of them breaks it quietly:

- **`src/state/legal.ts` is the whole authority**, and it is pure over
  `(log, event, sender)`. It is built from the same helpers `useGame`'s own guards read, so
  the client's "may I?" and the server's "you may not" cannot drift into disagreeing. Both
  directions are tested: `gameSocket.test.ts` proves it refuses illegal appends,
  `goldenSocket.test.ts` proves it accepts every legal game. A table that refused
  everything would pass the first suite alone.
- **The lobby's seat ids ARE the game's colours.** `SEAT_SPACE.ids` is `SEATS`, so a lobby
  `playerId` of `'red'` is the `SeatId` `'red'` and no mapping layer exists anywhere. Note
  the server seats in `SEATS` order, so a two-player room is **red and green**, not
  red and blue.
- **The server seeds `joined` and `started` itself at Begin.** Clients can never append
  them, and `appendLegality` refuses all three of `joined`/`renamed`/`started`.

Two owner rulings are encoded rather than derivable: any *seated* player may report the
roll for first player (`orderRolled` is the one event exempt from seat-matching), and undo
belongs to the seat whose action would be popped.

The lobby is the `@game-host/lobby` workspace package — an unresolvable workspace
dependency fails at `npm install`, so there is no separate boot-time guard for it.

## What Phase 1 owes Phase 3

Online multiplayer will consume the lobby extracted from the sibling repo
[`acquire-startups-m1`](../acquire-startups-m1), whose extraction design names this repo
as its intended second consumer. That lobby plugs into a particular shape, so the port
adopts it from the start rather than refactoring into it:

- A pure **`engine/`** at the top level, no React
- Game components under **`src/board/`** — the extraction design says `src/game/`, and the
  board-as-lobby refactor moved them. The requirement is that components live under one
  directory separate from `engine/` and `src/state/`, not that it carries a particular
  name; rename at the lift if the shared lobby turns out to care.
- **State derived by replaying an event log**, not mutated in place
- **Namespaced `localStorage` keys** — both games share the GitHub Pages origin

That repo's `CLAUDE.md` carries the house conventions this one inherits. Two that bind
hardest: derive every displayed value from replayed state rather than hardcoding it, and
prove a new test can fail by breaking the code and reading real output — never by reading
the assertion.

## Testing notes

**`src/test/setup.ts` bridges jsdom's real `localStorage` onto `globalThis` — do not
delete it, even though it looks like dead weight.** Node 26 ships its own experimental
`globalThis.localStorage`, which returns `undefined` unless the process is started with
`--localstorage-file`. Vitest's `populateGlobal` only copies a jsdom `window` property
onto `global` when that key is *absent* from `global` — and `localStorage` is not absent,
because Node already defined it (however uselessly). So jsdom's genuine `Storage`
implementation never gets bridged through, and Node's stub silently wins. jsdom itself is
fine; this is a Node-version interaction, not a jsdom bug. Every test under `src/` that
touches storage (`src/state/storage.test.ts`, plus anything rendering through
`useGame`/`App`) depends on this bridge running before it; without it they fail in a way
that looks unrelated to storage at all.

## Working notes

- **Every push to `main` deploys to GitHub Pages**, gated by the suite and the
  typecheck — a companion that is wrong about a payout is worse than one that is down.
- **The branch is `main`.** Renamed from `master` 2026-08-11; `origin/master` is deleted.
  `bugfixes`, `flippy` and `jsfixes` are 2013–2014 leftovers, deliberately kept.
- **The 2013 jQuery app is gone from the working tree.** `index2.html`, `js/`, `css/`, and
  the rest were deleted once the React port had a passing test suite covering the same
  ground; `git log --all --full-history -- <path>` reaches any of it. Two Rail Barons in
  one repo is how the wrong one gets edited, so there is deliberately only one now.
