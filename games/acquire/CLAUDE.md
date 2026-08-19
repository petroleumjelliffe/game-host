# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current focus

The **React app revamp**, following the roadmap in
`docs/superpowers/specs/2026-07-31-react-app-revamp-roadmap-design.md`. **Every phase on it — 0
through 5 — is built.** The server is the authority (Phase 3a) and a real client speaks its
protocol (Phase 3b): `src/net/`'s `NetworkSession` wraps the same `GameSession`/`GameScreen`
pass-and-play uses, so two browsers can create a room, join it, and play a game against the server
over real sockets. The legacy modal UI (`src/Game.tsx`, `src/components/`, `src/context/`) is
deleted.

**Phase 5 (2026-08-06) closed twenty-six findings from playing it by hand** —
`docs/superpowers/plans/2026-08-06-phase-5-online-ui.md`. Most of the panel changed: the step stack
attributes every step and shows the previous turn, the staging piles are removable, the active
zone's *height* is the panel's one animation, and the founding step is one row carrying a share
certificate. Read that plan before changing anything in `src/game/panel/` — several of its tasks
reverse decisions the 3b carry-forward describes as shipped.

**By-hand passes are what find bugs here.** All twenty-six of Phase 5's findings came from one;
none came from the suite. (The full two-browser game this paragraph used to call "still not done"
*is* done — Stage 0, 2026-08-07, G2's merger reaching both players and G9 to final scoring, in
`specs/2026-08-07-full-game-by-hand-notes.md`. It had survived three carry-forwards not because it
was hard but because nobody had built the setup: `POST /dev/rooms` made it two commands.)

**Phase 4 (2026-08-07) is built** — presence and recovery. A game now survives a page refresh, a
dropped socket and a server restart, and all three were driven by hand in real browsers as well as
tested. `server/store.ts` keeps the roster and its rejoin tokens and is read back before `listen`;
a `resume` state reason hands a reconnecting actor its own **open draft** rather than the state at
the start of their turn, which is the bug the phase turned out to exist for. A room the server does
not have says so by name; a dropped player shows on the seat and in the toast. See
`docs/superpowers/specs/2026-08-07-phase-4-carry-forward.md`, and
`2026-08-07-phase-4-by-hand-notes.md` for the five findings a human found that 661 tests could not.

**Phase 4's prod debt is paid** (2026-08-07) — `specs/2026-08-07-prod-by-hand-notes.md`. A refresh
mid-turn on Render comes back to the actor's **open draft**, undo and all, and a dropped socket
shows the pill on one side and **the away dot on the other — observed on prod for the first time**.
The draft also stayed private across the drop: the other player's board read `C2: empty` while it
was held uncommitted.

**Still owed:** a recovery *time* — the reconnect beat the first 500ms sample, so there is still no
number — and the clipped away dot, which needs five or six seats. The prod pass was heads-up, so the
disconnected player was the **actor** and rotation kept them visible, which is the case that already
worked.

**The cold-start copy ruling may not be owed at all.** It was raised against copy for a server
*waking up*, which assumed a free instance that sleeps. The service is on `starter` and does not
sleep (see Environment, below), so the routine cold start the copy was written for does not happen.
What remains is **online-but-unreachable** — a deploy restart, or Render being down — which is a
different sentence and a rarer one. Re-ask the question before answering the old version of it.

**Continuing from another machine? Start at `plans/2026-08-07-continuation.md`** — it holds the
verify-merge-deploy steps for the pending branch, the machine-setup gotchas, and the queue.

**The next round is sequenced in `specs/2026-08-07-next-round-sequencing.md`.** **Stages 0–2 are
built and deployed** (2026-08-07): the two-browser full game was driven by hand (a dev-only
seeding route, `POST /dev/rooms` — registered only under `npm run dev:server`, absent from
`npm run serve` / `start:server` — makes any golden-game state two clicks away in a browser); the
wire and the save record carry versions (`PROTOCOL_VERSION` in `session/protocol.ts`,
`SAVE_VERSION` 5, skew refused with its own `versionMismatch` code and screen, `/health` reports
both); and **pass-and-play persists** — one game per device in `localStorage`
(`src/game/local/localSave.ts`), written at every segment close, resumed from `/pass-and-play`'s
Continue card, cleared only by End game or a confirmed discard.

**Protocol v2 is merged and deployed** (2026-08-07, `aef9428`) — `/health` reports
`protocolVersion: 2`. The board lost its row/column headers, the buy step gained a Pass gate so a
turn cannot end over an empty basket by accident, and the Lobby Flow design landed — in two passes,
not one. The first did Create Room (seats you immediately, no name form; `CreateRoomPage` deleted)
and left **Join Room untouched**, still a separate screen with "Room code" and "Your name" inputs.
An earlier version of this paragraph called that "implemented in full"; it was not, and the owner
found it by hand on 2026-08-07.

The corrections are in
`plans/2026-08-07-lobby-flow-corrections.md`: **New Room and Join Room are one card**
(`online/LobbyCard.tsx`) differing only in whether the code block is typed into or read from;
**no row has a ×** (`Leave` was always the same action — a deliberate deviation from the mockup);
and **nothing asks for a name anywhere**, so `name` is optional on the wire and the server names
an unnamed seat `Player N` from its seat index. `needName` and `JoinForm` are gone; a refused
join gets `RoomRefused` and a retry.

`PROTOCOL_VERSION` stayed 2 through all of that, because v2 was still undeployed and its shape was
therefore free to change. That window closed when v2 went live; the v3 cutover has since happened
too (below).

**A Render deploy is ~40 seconds, push to live** — measured end to end on 2026-08-08
(`dep-d9r8a0rncjis7391usa0`): push returned 01:23:14, the deploy fired one second later, the build
finished at 01:23:32 and it was live at 01:23:53. **39 seconds.** Any note claiming ~6 or ~12
minutes is measuring waiting, not deploying, and is wrong.

**Auto-deploy is on and verified** (`autoDeploy: yes`, `autoDeployTrigger: commit`) — repaired by
the owner on 2026-08-08 after it was found broken, and confirmed by a push that produced a
`trigger: "new_commit"` deploy one second later.

**Check that a deploy fired before timing one.** The v2 deploy is `trigger: "manual"`: the push
before it started nothing at all, and the eleven idle minutes before a human deployed by hand got
written up as deploy duration, along with a "silent /health window" that was really a gap in the
polling loop. `mcp__render__list_deploys` reports the trigger and the true timings; **`/health`
alone cannot tell "still building" from "never started"**, so polling it until it changes measures
an interval and then invites you to attribute it to whatever you assumed.

The GH Pages bundle hash needs the same discipline — it served the old file for ~90 seconds. Read
the version back before believing either half.

**The turn-order draw is built, merged and deployed — protocol v3 is live** (2026-08-08;
`/health` reports `protocolVersion: 3`, and the v3 draw was smoke-tested on prod across two
isolated clients, including the last-drawer-wins commit case). Each
player draws their own tile in seat order; the order resolves when the last one lands. `startGame`
is gone, replaced by `drawTurnOrderTile`. Almost none of it is new machinery: `getCurrentActor`
returns `players[turnOrderDraws.length]` during the draw, and because that function is the segment
seam, the curtain, the hand-off, the toast and the server's per-draw commit all follow from it.
Design and plan: `specs/2026-08-07-turn-order-draw-design.md`,
`plans/2026-08-07-turn-order-draw.md`.

Two owner rulings landed: a curtain rises **between** draws but not in front of the first (seat one
is already holding the device), and the winner is **announced** as its own step rather than merely
arrived at.

**Curtain and commit are no longer the same event, and that is the subtle part.** Leaving the draw
closes a segment even when the actor does not change — which happens whenever the last drawer wins
their own draw — because `server/room.ts` derives its commit from `segmentStart` moving, and
without it the table would not see who won until the winner finished their whole first turn. The
*curtain* stays narrower and rises only on a real actor change, since its job is handing the device
to somebody else. `server/room.test.ts` pins the difference on G17.

**Merging it is a second cutover.** Prod speaks v2; every open tab takes the stale-client screen
once.

**Stage 3 is diagnosed but not solved** — see the `verify:layout` note under Commands. Twenty
consecutive runs came back green, so the flakiness never reproduced; two real run-history hazards
were found and removed, but neither was ever shown to turn a run red, so the caveat stands. The
PWA's two stated gates (persistence, protocol version) both now exist. A spectator seat and a
panel-only phone view are wanted together, and are their own design pass. Presence still has two
open findings from Stage 0: the away dot rides a roster row designed to clip, and final scoring has
no presence at all.

**Dev surfaces — dev builds only:** `/catalog` is every component state; `/scenarios` loads any
golden-game state and plays on from it, which is how to reach a merger in two clicks rather than
several minutes. **Neither exists in a production build** (owner ruling, 2026-08-08):
`import.meta.env.DEV` guards in `src/App.tsx` mean the routes and their golden-data chunks are
never emitted, and `check:bundle` greps `dist/` for golden title strings to hold it there. The
client-side twin of the server's `/dev/rooms`, which itself exists only under `npm run dev:server`.

Design specs and implementation plans live in `docs/superpowers/{specs,plans}/`. Each phase ends
with a carry-forward doc in `specs/` recording what it hands to the next one — read the newest
before starting work.

## Layout

| Path | What it is |
|---|---|
| `engine/` | The rules. Pure, immutable, no React. `applyIntent(state, intent)` is the single reducer; `history.ts` adds snapshot undo. |
| `engine/golden/` | Golden games G1–G17 (`ALL_GOLDEN_GAMES`) — the executable rules spec, stored as data. Run by `golden.test.ts` against the engine and by `server/goldenSocket.test.ts` over real sockets. |
| `src/game/` | The new component layer (Phase 1b). Pure, props-in, styled through `tokens.ts`. |
| `src/game/catalog/` | `/catalog` route — every component state, mostly replayed from golden games. The acceptance surface. Also `/scenarios`: any golden-game state, playable on from that point. Both lazily routed so the golden data stays out of the main chunk. |
| `session/` | Shared between client and server (Phase 3a). `GameSession` — the local draft/session model — and `protocol.ts`'s wire types (`WireIntent`, `StateMessage`, …). No React, no transport. |
| `vendor/lobby/` | **A git submodule**, not this repo's code — [multiplayer-game-lobby](https://github.com/petroleumjelliffe/multiplayer-game-lobby), shared with Rail Baron. `protocol/` is the wire half (node-safe; `session/protocol.ts` imports from it, never the reverse). `server/` is seating, tokens, join/rejoin/reclaim, presence and roster broadcast behind `onBegin`/`onSeated`, generic over the room via `LobbyRoomLike`. `client/` is headless React — `createIdentityStore`, `createLobbyConnection`, `useLobbyRoom`, and `lobbyView`, which hands a game its seats (empty ones included), `canBegin` and terminal state as data. It carries **no UI and no badge**: decoration is derived by the game from the seat. Left Acquire on 2026-08-13 with all fifteen commits, via `git filter-repo`. |
| `src/game/lobby/` | Acquire's *own* lobby screens — `RoomLobby`, `JoinRoomCard`, `LobbyCard`, `ConnectionStrip`, `RoomGone`, `RoomRefused`, `StaleClient`, `ShareRoomButton`. These used to live in `src/lobby/ui/` and be described as a themeable kit; they are not one, and Rail Baron draws its lobby as a split-flap departures board instead. |
| `src/net/` | Now the game's thin layer on top of the lobby. `NetworkSession` — a `GameSession` whose authority is the server: six intents apply optimistically, three (`endTurn`, `tradeInDeadTiles`, `drawTurnOrderTile`) wait on a `correction`. The game transport and its wrappers: `useRoom` ranking `gone`/`stale` above `playing`, the `acquire` identity instantiation, and the composed connection. |
| `server/` | Express + Socket.io. Authoritative over intents as of Phase 3a — runs `applyIntent`, projects state per player before broadcast, rejects out-of-turn/illegal intents. `store.ts` (Phase 4) persists a room's roster, rejoin tokens and last committed state; `rooms.restore()` seats them at boot, before `listen`, forcing every seat disconnected. `recovery.test.ts` kills a server and reboots it against the same store. The XState layer is deleted. |
| `src/pages/` | Routes. `/room/:roomId` is the online game; `useRoom` (in `src/net/`) owns its `connecting → joining → lobby → playing` phase machine, plus `error`, `gone` and `stale`. (`needName` is gone — nothing asks for a name any more.) |
| `prototype/` | The buildless design lab the component layer was ported from. Reference, not a build target. |

**Root-level `*.md` are history, not guidance.** `MULTIPLAYER_ARCHITECTURE.md` and
`XSTATE_REFACTOR_PLAN.md` say so in a banner; `TESTING.md` (drives a deleted `server/test.html`) and
`TESTING_PLAN.md` ("no test suite exists" — there are 664, in 63 files) do not. `README.md` and
`DEPLOYMENT.md` are still current.

## Commands

```bash
npm run dev            # Vite dev server (7932), serving under BASE_PATH like build does —
                       # base is uniform now. Pass-and-play, /catalog and /scenarios only
npm run dev:server     # Socket.io server (4002). Sets NODE_ENV=development (registers
                       # POST /dev/rooms) but no SOCKET_PATH — it falls through to the
                       # prefixed default, which is what the dev client asks for. Needed
                       # for anything under /online or /room
npm run dev:all        # both, concurrently — what an online by-hand pass needs
npx vitest run         # full suite
npx vitest run server/recovery.test.ts        # one file
npx vitest run -t 'the roster, the tokens'    # one test by name
npx vitest run --project node                 # engine + session + server only
npm run typecheck      # never run bare `tsc`
npx vite build
npm run check:bundle   # guards vitest and golden data out of the main chunk
npm run verify:layout  # drives a real Chrome over CDP — see the caveat below
```

- **Two vitest projects, and the split is load-bearing.** `node` runs
  `engine/`, `session/` and `server/`; `app` runs `src/` under jsdom with
  `src/test/setup.ts`. `engine`/`session`/`server` run in the *server process* in production, so a
  stray `window.` or `localStorage` there is a production crash that a single jsdom suite could
  never catch. `session/nodeEnvironment.test.ts` asserts that boundary; don't add root-level
  `setupFiles` (vitest 4 merges the array into both projects, silently disarming it).
- **`npm run verify:layout`'s flakiness is explained and fixed** (2026-08-08). It needs Chrome at
  `CHROME_PATH` (defaults to the macOS app bundle) and drives pass-and-play only — presence and
  online states are not on its path.

  **It was the gate's own arithmetic, not the app.** Each zone's height was rounded to the nearest
  pixel and *then* summed and compared exactly. Layout heights are fractional — a real run reports
  `staging: 173.5`, `net: 16.5`, `hand: 117.5` — so a value sitting near `.5` rounds up on one run
  and down on the next, and the `stepstack+active` sum could differ by 1px (2px worst case) with no
  layout change whatsoever. Caught at last as
  `1440px: stepstack+active grew 550px -> 551px`, once in 15 runs.

  Heights are now captured **raw**, compared through `moved()` against `EPSILON_PX = 1`, and
  rounded only for the message. The tolerance sits far below every real defect this gate has caught
  — the Phase 1b reservation was 6px, the holdings floor 4px, the unstuck history 40px+ — and that
  was verified rather than assumed: shrinking the holdings floor from 68px to 64px still fails at
  both widths with the original message.

  **Treat a green run as ordinary evidence now.** Five phases of "weaker than it reads" were
  standing on a bug in the measurement, and no document ever recorded a failure shape — the belief
  was quoted forward, not the observation. Worth remembering: the caveat's first appearance
  (`37b8139`, 2026-08-07) already called it "pre-existing" with nothing behind it.

  Two run-history hazards were removed on the way and are worth keeping removed, though neither
  ever turned a run red: Chrome's singleton lock (a second Chrome on the same `--user-data-dir`
  exits, leaving the first holding the port) and a stale `vite --strictPort` (a survivor from
  another checkout would let this gate measure the wrong tree while reporting green). Each run now
  gets a `mkdtemp` profile, its own vite port, and `--remote-debugging-port=0` read back from
  `DevToolsActivePort`, so two gates can run concurrently. Cost: ~25% slower per run (33–35s vs
  25–29s), because no profile is reused.
- **Before any by-hand pass, check which tree is serving.** Vite silently moves to the next free
  port when another checkout already holds 5173, and a Phase 4 round was measured against `main`
  before anyone noticed.

## Working rules

- **`vendor/lobby` is a submodule, and changing it takes two commits.** Commit and **push inside
  `vendor/lobby` first**, then commit the bumped pointer here. The other order commits a gitlink to
  a SHA that exists on one machine, and the repo becomes unclonable for everyone else — the failure
  is invisible where you made it and total everywhere else. Clones need `--recurse-submodules`, or
  `git submodule update --init --recursive` after the fact; CI needs `actions/checkout` with
  `submodules: true`. `npm run build:server` fails loudly if the submodule is empty, because `tsx`
  compiles nothing at build time and the server would otherwise die at boot with a green build log.
- **Derive from the engine, never hardcode.** Every price, total and board position in the UI comes
  from replayed state. Phase 0 shipped a wrong-number bug from a copied figure; the catalog exists so
  that cannot recur.
- **No `as any`.** Narrow with the engine's type guards (`isStartupId`, …).
- **Never import `engine/golden/runner` from `src/`** — it pulls vitest into the bundle. Use
  `replayGoldenGame`.
- **Verify in a browser.** jsdom reports zero for all layout, so a structural test can pass while the
  thing it guards is visibly broken. This has happened. Measure real pages for anything about size,
  fit or overflow.
- **Prove a new test can fail — by breaking the code and reading real output, never by reading the
  check.** Eleven "hollow gates" have been caught this way and every one was found by running the
  break: a shared temp filename that made a write-ordering test pass by luck, an absence assertion
  looping over an empty array, a mount test satisfied by a `useState` initializer rather than the
  effect it claimed to guard. A green test that could never go red is worse than no test.
- **A measurement you did not measure is the same defect.** Phase 4 wrote up a confident "4–7
  seconds" from an unmeasured gap; against a shared clock it was 98ms.
- **Review the whole branch at the end, not only each task.** Both of Phase 4's worst bugs — a
  dead-looking board after a restart, and one bad save record stopping the server booting — spanned
  two tasks each and survived ten clean per-task reviews.

## Key concepts

- **Safe chain** = ≥11 tiles; two safe chains cannot merge. A tile whose placement would join two
  safe chains is permanently unplayable — a dead tile.
- **Segment** = a run of steps by one actor, ending when a *different* player must act. It is the
  undo boundary, the pass-the-device boundary, and (Phase 3a) the server's commit boundary — a
  segment close is what turns a private draft into `room.committed()` and broadcasts it.
- **Panel-height stability**: a zone's reservation is a *floor*, not a fixed height. Reserve enough
  that ordinary content changes move nothing (the point is to stop labels and controls jittering
  between transitions). Growing to fit a genuinely new row is fine — mark the zone
  `data-may-grow="true"` and let it adjust gracefully; the panel scrolls. What is not fine is a zone
  changing height *without* gaining a row, or clipping its own content. `npm run verify:layout`
  checks all three on a real page.
- Panel zone order: `stepstack → active → staging → hand → players`.
- **The panel has exactly one animation**, and it is the active zone's *height* (`panel/StepReveal`).
  The step stack has none: it moves because the zone below it grows, so its bottom edge is that
  zone's top edge. Two earlier attempts animated the contents instead, both passed their gates, and
  both were wrong — if a transform appears on the step list again, that is the mistake returning.
- Respect `prefers-reduced-motion` (skip enter animations).
- **Persistence is best-effort and silent by design.** `save()` never rejects, so a commit lost to a
  failed write is unknowable to the room. `SAVE_VERSION` (4) covers the record's shape only —
  `isSavedRoom` trusts `state` past "is an object", so a `GameState` change without a bump is not
  caught. `rooms.restore()` is boot-only: at runtime it would swap live room objects out from under
  their socket bindings.

## Environment and deployment

Client on GitHub Pages under the base path `/acquire-startups-m1` — **one copy, in `basePath.ts`**
(the old duplicate hardcodes in `vite.config.ts` and `src/main.tsx` are gone; the config imports
it, the router derives its basename from Vite's `BASE_URL`, and the manifest generator reads it
too); server on Render, service `srv-d3klnhnfte5s73diht90`, **plan `starter`** (paid) —
*not* free, whatever older notes say. The client is origin-relative (`src/net/connection.ts`):
with no `VITE_SERVER_URL` set, pages, assets and sockets all ride the page's own origin, sockets
at `${BASE_URL}socket.io` — so a phone on the LAN works for free, and no client code names a host
or port. A build that sets `VITE_SERVER_URL` (Pages → Render) wins outright and keeps socket.io's
default path; the Render service sets `SOCKET_PATH=/socket.io` (env, read at the boot seam) so its
mount matches — the server's own default mount is `/acquire-startups-m1/socket.io`, which is what
`npm run serve` and the game-host front door use. The server reads `PORT` (4002; Acquire's slot in
the game-host repo's PORTS.md) and writes rooms to `server/games/`, gitignored.

**Rooms are durable as of 2026-08-08, and the gone-room ending is no longer the normal case.** A
1 GB disk (`dsk-d9rafvlbedkc73coe2k0`) is mounted at **`/var/data`**, and `GAMES_DIR` — set on the
service — points the store at `/var/data/games`. Proven, not assumed: a real two-browser room was
created on prod, a deploy was triggered, the boot logged **`✓ Restored 1 room(s)`**, and a browser
reload came back to the same mid-draw state with both seats. Every prior boot in this service's log
history shows `Server listening` with no restore line, because there was never anything to restore.

**The durable-`RoomStore` epic turned out to be one line.** It was queued as "provision Key Value or
Postgres and write a second `RoomStore` implementation" — the right plan for a *free* instance,
which cannot have a disk. This service is on `starter`, which can, and the file store was always
durable: it was writing to the instance's ephemeral filesystem. No second implementation exists and
none is needed. `store.ts` staying an interface is still worth it; it simply did not have to be
exercised. **The plan was not wrong, it outlived its assumption** — worth re-reading any queued item
that was scoped against "Render free".

**Two consequences that are now live and were not before:**

- **`.bad` quarantine files are never evicted.** [store.ts:212](server/store.ts#L212) skips any name
  not ending `.json`, so a quarantined save is never read, never aged out, never deleted. That was
  invisible while restarts wiped the disk. It is slow (only genuinely unparseable saves quarantine —
  protocol skew is a *skip*, and those still age out) but unbounded, and it is the deferred Stage 1
  sweep item finally becoming real.
- **The gone-room copy and the 7-day eviction policy were both written for an ephemeral world**, and
  neither has been revisited. A disk-backed service pins to one instance and recreate deploys, which
  this already was.

**Being a paid instance also means it does not spin down.** Free instances sleep after inactivity;
`starter` does not. This is Render's documented behaviour rather than something measured here (it
would take a 15-minute idle window to observe), but it is why the cold-start story below is
suspect.

**The client is a PWA** (built 2026-08-08, `revamp/pwa`). Installable, `display: standalone`;
pass-and-play works fully offline (shell from the worker's cache, game from `localStorage`); online
modes say plainly that they need a network — the server is the authority and there is deliberately
no local fallback. The pieces, and where they live:

- `public/manifest.webmanifest` is **generated at every build** (`prebuild` →
  `scripts/generate-manifest.ts`) from `APP_COLORS` in `src/game/tokens.ts`; `index.html`'s
  theme-color goes through a Vite plugin reading the same token. Change the palette in tokens and
  both follow — never edit the manifest or the tag by hand. Icons are static PNGs
  (`scripts/generate-icons.mjs` re-renders them via headless Chrome when the art changes).
- `dist/sw.js` is generated after every build from `scripts/sw.template.js` — the precache list is
  derived from the files actually emitted, the cache name is a content hash, and activation prunes
  old caches. Network-first navigations (falling back to the cached shell on failure *or* a
  non-ok response), cache-first hashed assets, same-origin GETs only. **No `skipWaiting` on
  install:** updates activate on next launch (owner ruling), with two explicit exceptions —
  the mode chooser's "Update ready" button, and `StaleClient`'s reload, which now runs
  `forceUpdateAndReload` (`src/pwa/update.ts`): **unregister → clear caches → reload in a
  `finally`**. Unregister, not just cache-clearing — clearing alone left an active worker whose
  install never re-runs, i.e. no offline cache until the next deploy. Observed live before fixed.
- When templating anything (`sw.template.js`, `index.html`): **`replaceAll`, never `replace`**, and
  keep placeholder names out of comments — `.replace()` substituted a placeholder named in its own
  explanatory comment twice in one day.
- **Still owed before the first real install:** the update path driven on a real installed app
  against a real protocol bump. Zero installs exist, so nothing can wedge yet — but a broken
  updater is the one bug that survives its own fix being deployed, so that verification is the
  hard cutoff before handing anyone the app.
