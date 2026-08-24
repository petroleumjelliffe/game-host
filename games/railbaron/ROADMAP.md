# Rail Baron — roadmap

A companion for the Avalon Hill board game *Rail Baron*. You play on the physical board;
the app rolls destinations, computes payouts, and shows the network.

**v1.0.0 is the companion release** — Phases 0 to 2, deployed to GitHub Pages. It is
complete for what it claims to be: a roller and a map, used beside a board that people
are playing themselves. Phase 4 is the game itself, and it is a different application
wearing the same clothes.

## What's next, in order

1. **Finish online mode** — play a full game over local wifi, reconcile the lobby copy;
   deployment is deferred. The close-out checklist is in Phase 3. It goes first because
   every money event will also be a wire event — `legal.ts`, the session protocol and
   the server handlers all grow with the money spec — so the pipe gets proven while the
   event surface is small.
2. **Roll animation on the map** — destination and payout rolls animated; the design
   already exists in the design project. A small, shovel-ready win before the big
   design effort. Phase 5.
3. ~~**The money spec, second half**~~ — landed 2026-08-23: ownership at the
   transcribed prices, user fees as a derivation (three tiers, settled at turn
   close), the declared endgame with the rover play, and the forced-sale stub.
   See the game-host repo's `specs/2026-08-23-money-phase-2.md`; its still-owed
   list (forced-sale/elimination text, starting cash, train purchase timing,
   two fee confirms) is what remains of the economy. The first half — cash,
   banked-vs-earned, house rules, seeded dice — landed 2026-08-22.
4. **Auto-zoom to the current player** — gated on a design-project pass first, so it
   trails the money work. Phase 5.

## Phase 0 — map data

Convert the printed map into a graph. Done in a one-off editor that runs against a scan of
the board: cities, movement dots, and junctions as nodes; track between them as edges,
each attributed to one or more of the 28 railroads.

- [x] Detect and hand-clean the point set — 471 dots, 67 cities, 12 junctions
- [x] Trace every railroad's route
- [x] Find the missing 67th city — Minneapolis, by elimination in the registration
- [x] Attach names and regions to city nodes — `data/city-names.json`, all 67
      confirmed against `engine/cities.ts`
- [x] Validate: no dead-end dots, no orphan edges, one connected component
- [x] Fit the scan→lat/lon warp so every node has real coordinates —
      `npm run network:build`

**Phase 0 is done.** `data/rail-baron-graph.json` (scan pixel space, hand-verified)
plus `data/city-names.json` (names and regions, keyed by node id) build into
`engine/network.json` — 550 nodes in WGS84 degrees, each city carrying the
`cityId` that indexes [`engine/cities.ts`](engine/cities.ts), so the map and the
roller agree about what a destination is without matching strings at runtime.

The warp is a thin-plate spline over the 67 cities, fitted scan→Albers so the
spline corrects only the drawing's distortions rather than also learning the
projection; lat/lon comes back by inverting Albers. Control points are
reproduced to 3e-12°. `engine/network.test.ts` re-checks the build's output
against the real engine module — the build reads city ids by parsing
`engine/cities.ts`, which it cannot import, so the test is what makes a drifting
parse fail rather than ship.

## Phase 1 — the React port

Replace the 2013 jQuery app. Same game, redesigned board, plus the map.

- [x] Vite + React + TypeScript, tablet landscape
- [x] Departures-board UI: split-flap rows, region ballot on a same-region roll, naming.
      Rebuilt in Phase 2 as one board driven by screen definitions — see below
- [x] Map as a second view: real US geometry, one lamp per real dot, cities tinted by
      region, track drawn in each railroad's own colour. Reached from the last row of the
      in-play board. Each baron's destination and the city they set out from light in
      their colour. No path was drawn between them at this point, because which route a
      baron takes depends on the railroads they can use and the roller did not model
      that — Phase 4 does, and the map draws the committed leg
- [x] Game logic ported from [`engine/`](engine/) — roll tables, 67 cities, payout matrix —
      with the two mislabelled regions fixed. The source it was transcribed from,
      `js/railbaronv2.js`, lived at the repo root and was deleted once the port had a
      passing test suite covering the same ground; it's still reachable in git history.

The roller — departures board plus the ported game logic — is done. Scope for it was the
roller only: no movement, no railroad ownership, no cash. The graph carries dot counts and
railroad attribution anyway, so those can be layered on without redoing the extraction.

## Phase 2 — pass-and-play menu — done

A front door: start a game, pick how many barons, name them, resume a game in progress.

Landed as **board-as-lobby** rather than as a menu bolted onto the roller. The split-flap
board is the whole interface, and every screen — home, setup, saved games, discard confirm,
play, region ballot — is a `ScreenDef` in [`src/board/screens/`](src/board/screens/)
rendered by one `Board`. Adding a screen means adding a definition, not a component, and
the flap animation is written once in `useFlap` instead of per screen. The original
`SplitFlap`/`DeparturesRow`/`DeparturesBoard`/`RegionBallot` components were retired in the
process; they are in git history.

Saved games carry an age and migrate from the v1 record shape, so an in-progress game
survives the upgrade rather than being silently dropped.

## Phase 3 — online multiplayer

> **Built, with notes.** Tasks 1–10 of
> `docs/superpowers/plans/2026-08-14-online-mode.md` are done: the authoritative server,
> the client hooks, the lobby boards and the routes, all tested. **A first by-hand pass
> has run across two real machines** and found five bugs — four in the client glue the
> test exemption had excused, all fixed — plus one correction to our own record; it's all
> in `docs/superpowers/specs/2026-08-14-online-by-hand-notes.md`. The design it was built
> to is `2026-08-14-online-mode-design.md`. The decisions listed below were made there,
> except hosting, which is deferred (see the checklist).

Closing it out means:

- [x] A first by-hand pass, two real machines — five bugs found and fixed, notes filed,
      the consumer checklist upstreamed to the lobby repo
- [ ] Play a full game by hand over local wifi — `vite --host` plus the game server on
      the LAN; this is the current test rig
- [ ] Reconcile the 1d/1f board copy against the design project
- [ ] Deploy the game server — **deferred**, not being done yet. When it happens, the
      hosting decision below gets made there (owner's Render workspace, or one process
      for both games)

Reuse the lobby from [`acquire-startups-m1`](../acquire-startups-m1) rather than building
one. That repo extracted its lobby — rooms, seats, join/rejoin tokens, presence, rename,
leave, and the screens around them — into a game-agnostic piece specifically so the next
game could consume it, and its design names this repo as the intended second consumer.

**This is "the lift"** described in
`acquire-startups-m1/docs/superpowers/specs/2026-08-08-generic-lobby-extraction-design.md`:
when Rail Baron is ready for online, the three lobby directories (`lobby/`,
`server/lobby/`, `src/lobby/`) move out of that repo into a shared home and both games
point at it. Leading candidate is shared TypeScript source via git — both repos are
Vite+TS and compile the source directly, so two consumers with one owner need no publish
pipeline. The final call is made at the lift.

Decisions that repo deliberately deferred to this one, to make when we get there:

- **Hosting** — a second Render service is a second paid instance; the alternative is both
  games' servers in one process
- **Honor-reclaim policy** — whether same-name seat capture fits this game's trust model
- **Game-flavoured rejection codes** — `notYourTurn`, `wrongStage`, `unknownIntent` are
  wire-level names that a turn-agnostic lobby shouldn't have

### What Phase 1 owes Phase 3

The lobby plugs into a particular shape, so the port adopts it from the start rather than
refactoring into it later:

- A pure **`engine/`** with no React
- Game components under **`src/board/`** (the extraction design says `src/game/`; the name
  moved in Phase 2, the separation it was asking for did not)
- **State derived by replaying an event log**, not mutated in place
- **Namespaced `localStorage` keys** — both games will share the GitHub Pages origin

The lobby is turn-agnostic by design: it knows seats, tokens, lifecycle and presence,
never turns or timing. A roller with no turn order at all sits on it unchanged.

## Phase 4 — the game itself

Modelling Rail Baron rather than assisting it: a baron rolls, **moves**, chooses a
route, and pays for the track they used. Then the parts that make it a game rather
than a journey — buying railroads, the auction, user fees, cash, and winning.

**Turns and movement are built.** Barons take strict turns in rolled order; the
movement dice are rolled from the board's own readout or the map's, through the same
gate a destination roll goes through; the route is tapped out dot by dot on the map,
refused where the rulebook refuses it, and committed as one `moved` event that every
tab watches play back. The movement rules are stored as data rather than prose in
[`engine/golden/`](engine/golden/) — one game per rule, run by a fixture runner and
cross-checked against the event log's own replay. The Bonus Roll, the once-per-trip
section rule, twin cities and stranding are all in there.

**The money landed in two phases** (2026-08-22 and 2026-08-23 — the game-host
repo's `specs/2026-08-22-money-phase-1.md` and `2026-08-23-money-phase-2.md`):

1. **Cash, ownership, and the bill per turn** — done. Each baron's money and
   railroads fold from the log, and a turn's fee derives from the edges the
   recorded paths crossed — every edge names its railroads, exactly as this
   file predicted. The declared endgame and the rover play came with it.
2. **The auction** — still stubbed by decision: a forced sale to the bank at
   half price, an ordinary log event, until the auction gets its own design
   pass against the still-owed forced-sale text.
3. **Train upgrades, shown on the board** — still gated on the rulebook's
   purchase-timing text. `startingTrain` is a house rule and the fold reads
   it; the upgrade event is designed in the phase-2 spec and not built. The
   design file's train list includes "Fast Freight", which this rulebook does
   not have — do not copy it.

The rulebook's forced-sale rule rides along: a baron who cannot pay must sell rail
lines until they can, and is out of the game if still short. Model it; don't guard
against reaching it.

Every event this adds is also a wire event — `legal.ts`, the session protocol and
the server handlers grow with each one — which is why online mode closes out first
(see What's next). The second of the two questions below is the one that decides
how far all of this goes; the first is answered: the app keeps turn order.

### What the map already gives us

Phase 0 captured more than the roller needed, on purpose, so this phase does not
mean reading the board again:

- **Path cost is the count of `dot` nodes traversed.** Junctions cost nothing by
  construction rather than by rule — they are not dots — so route-finding needs no
  special case for them.
- **Every edge names the railroads running over it.** Shared trackage is one edge
  naming several, which is exactly the shape a "whose track did you use, and what
  do you owe them" calculation wants.
- **Both spaces are available** — real geography for the map view, scan pixels in
  `data/design-network.json` for anything that needs the printed board's own layout.

### The two questions

- **Whose turn is it?** — *answered.* The roller had no turn order at all: any row
  could be tapped at any time, which is right for a companion and wrong for a referee.
  Turns are now rolled for, recorded (`orderRolled`) and enforced by replay, and undo
  takes back a whole turn rather than an event.
- **How much does the app decide?** There is a wide gap between showing a baron their
  legal routes and choosing one for them, and a wider one between tracking cash and
  enforcing it. The further it goes, the less the physical board is being played.

### What it must not break

The `$0` constraint, the event log as the single source of truth, and the rule that
a roll is not told until the board has finished announcing it. Those are load-bearing
and documented in [CLAUDE.md](CLAUDE.md).

## Phase 5 — map experience

Map work that is design-first: each item goes through the **Rail Baron Game Board
Design** project on claude.ai/design before it is buildable here.

- [ ] **Roll animation** — destination and payout rolls animated on the map. The
      design already exists in the design project, which makes this the shovel-ready
      one; it is slotted before the money spec (see What's next).
- [ ] **Auto-zoom to the current player** — zoom to the moving baron's surroundings
      while they walk their route. A playtest idea; it needs its design pass first,
      so it trails the money work.

Parked, unprioritized: **keyboard accessibility on the map lamps.** Tap targets are
`<circle role="button">` with no `tabIndex` and no key handler. This needs a design
decision about pointerless map navigation, not a patch.
