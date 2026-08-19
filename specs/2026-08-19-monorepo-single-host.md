# One repo, one process: the games behind a single front door

**Status:** designed 2026-08-19, not yet started.
**Home:** this repo, which becomes the monorepo. The hosting properties this
spec buys are the ones game-host already owns — a single address, a path per
game, a port registry — so the repo that enforces them is the repo that
absorbs the games rather than the other way round.

Successor to `specs/2026-08-17-origin-relative-clients.md` (implemented
2026-08-18), which made every client indifferent to how it is fronted. That
change is what makes this one cheap: a client that addresses everything
relative to its own origin does not care whether the thing serving it is
three processes behind Caddy or one process on Render.

## The property being bought

**One deployable.** Three games, one shared lobby and the host configuration
live in one repository and build into one Node process, which serves every
game's pages, assets, sockets and health under its own path prefix, plus the
menu at the root.

The immediate reason is cost: Acquire's Render service is a paid `starter`,
and putting Rail Baron and Marco Polo on Render the way Acquire is deployed
would triple that for three games that are idle most of the week. One
instance hosts all three for what one costs today.

What follows from it, and matters more than the money:

- **The Render deployment and the game-night machine run the same process.**
  Today the LAN topology (three processes behind Caddy) and the deployed
  topology (one game, split client and server) share no code path, so a bug
  in one is not exercised by the other. After this, game night *is* the
  staging environment.
- **Adding a game stops being a six-step checklist across five files.** The
  menu, the port registry, the Caddyfile block and the start script all
  collapse into a package that exports its own mount.
- **The lobby stops being a submodule.** It becomes a workspace package with
  its own test suite, instead of code with no toolchain whose tests only run
  by being pulled into three consumers.

Code sharing between games is a secondary bonus, and this spec treats it that
way: it names the duplication it found but defers all of it except the pieces
composition actually forces.

## Current state

| Repo | LOC | Vite | vitest | Server seam | Deployed |
| --- | --- | --- | --- | --- | --- |
| acquire-startups-m1 | 25.7k | 7 | 4 | `createServer() → {app, httpServer, io, rooms}` | Pages + Render (`starter`, 1 GB disk) |
| railbaron | 15.5k | 8 | 4 | `startServer(opts) → RunningServer` | Pages (client-only companion) |
| marco-polo | 2.3k | 6 | 3 | `createAppServer() → {httpServer, io, stop}` | nothing |
| multiplayer-game-lobby | 1.6k | — | — | consumed as `vendor/lobby` submodule | n/a |
| game-host | config | — | — | Caddy + three launchd agents | LAN only |

All three games pin the same lobby commit (`17da30d`), so there is no
divergence to reconcile. All three already separate a factory from a boot
block that reads the environment — the seam a composed process needs — and
all three already serve their client under `BASE_PATH`, mount socket.io at
`${BASE_PATH}/socket.io`, and twin `/health` under the prefix.

## The design

### 1. Composition: three socket.io servers, one HTTP server

Each game keeps its own `socket.io` `Server` at its own `path`; all three
attach to one `http.Server`. The alternative — one `Server` with a namespace
per game — was rejected, and the reason is worth recording because it is not
the obvious one.

engine.io's two attachment paths do not behave the same way
(`node_modules/engine.io/build/server.js`):

- **`request`**: `attach` caches the server's existing listeners, removes
  them, and installs one that delegates on a path miss. Three servers chain
  cleanly down to Express. This is by design and needs nothing from us.
- **`upgrade`**: `attach` simply calls `server.on("upgrade", …)`, caching
  nothing. Every attached engine sees every upgrade, and the ones whose path
  does not match fall into an `else` branch that schedules a 1-second timer
  ending the socket if it has written no bytes.

So a websocket upgrade to `/railbaron/socket.io/` is seen by all three
engines, and Marco Polo's and Acquire's each arm a timer to kill it. It
survives only because the handshake writes bytes well inside a second — a
race that would surface as sockets randomly failing under load, on the
slowest client, in the least reproducible way.

**Every game's `Server` is therefore constructed with
`destroyUpgrade: false`** (and `serveClient: false`, since no client loads
socket.io from the server). These options reach engine.io because socket.io's
`attach` merges them straight through to `initEngine`.

The namespace approach would additionally have broken Marco Polo silently:
`server/gameHandlers.ts` broadcasts by iterating `io.sockets.sockets` — every
socket on the server — and filtering by seat. Per-game `Server` instances keep
that correctly scoped. Under one shared `Server` it would have walked all
three games' sockets twenty times a second, still correct but coupled in a
way nothing in the code would have warned about.

### 2. The host contract

Each game exports one uniform entry point and stops owning a process:

```ts
export interface HostContext {
  app: express.Express;
  httpServer: http.Server;
  dataDir?: string;          // host-allocated; absent for Marco Polo
}
export interface MountedGame {
  basePath: string;
  title: string;             // for the generated menu
  version(): { protocolVersion: number; saveVersion?: number };
  io: SocketServer;
  close(): Promise<void>;
}
export function mount(ctx: HostContext): Promise<MountedGame>;
```

`apps/host` creates the app and HTTP server, calls each `mount`, registers the
menu **last**, and listens on `PORT`. The standalone boot blocks do not
disappear — they become thin wrappers over `mount`, so `npm run dev:server` in
one package still works and every existing socket suite keeps booting its own
server on port 0.

Three collisions composition creates, each a migration task:

- **Marco Polo's root static mount must go.** `server/app.ts` does
  `app.use(express.static(dist))` at the root so a bare port lands on the
  game. Composed, that serves Marco Polo's `index.html` as the menu.
- **The bare `/health` twins collide.** All three register `app.get('/health')`
  and Express matches in order, so whichever mounts first silently owns it.
  Games register only their prefixed twin; the host owns bare `/health` and
  answers with an aggregate built from each `MountedGame.version()`. One curl
  then reports all three, which is strictly more than any game can say today.
- **Route order becomes a cross-package invariant.** Each game's SPA fallback
  is `app.use(BASE_PATH, …)` and so is prefix-scoped, but that is currently an
  accident of each game being alone in its process. It becomes something a
  test asserts.

### 3. The per-game error boundary

One process means an uncaught throw in any game's socket handler kills all
three. The host therefore wraps each game's handler registration so a throw is
logged, reported to the originating socket as a rejection, and contained.

This is not theoretical. Acquire's `server/index.ts` already carries a long
comment explaining that `isWireIntent` exists because a malformed payload
"throws synchronously and takes the whole process down for every room, not
just this one." Composed, *every room* becomes *every game* — and the game
with the most to lose is Marco Polo, which persists nothing, so a crash costs
a live round outright while Rail Baron and Acquire restore from disk.

### 4. Simultaneous play

The three games have very different load shapes, and the composed process has
to hold all of them at once.

Marco Polo is the only continuous consumer: `server/gameHandlers.ts` runs a
`setInterval` per active room at `TUNING.tickHz = 20`, stepping the sim and
serializing a per-player snapshot for up to eight players — roughly 160
snapshot builds a second for the 90 seconds of a round. Rail Baron and Acquire
are turn-based and do work only when someone acts, and both stores use
`fs/promises`, so a save lands on the libuv threadpool rather than blocking
the loop. A Marco Polo round with simultaneous Rail Baron and Acquire play
fits inside a 50 ms tick budget with room to spare.

Memory moves the right way too: one V8 heap and one copy of
express/socket.io/engine.io, rather than three.

### 5. Saves

`GAMES_DIR` — three per-game absolute paths set by three start scripts —
collapses into one `DATA_DIR`, with the host allocating and creating
`${DATA_DIR}/<game>` per mounted game. Marco Polo gets none, as today.

Render and the LAN then have the same layout: `/var/data/*` on the instance,
`infra/saves/*` on the game machine. The README's lesson stands unchanged —
the path is absolute because a service's working directory is wherever its
plist says — it is simply centralised.

**Live-data step:** Acquire's Render disk holds real saved rooms at
`/var/data/games`. The cutover does a one-shot `mv /var/data/games
/var/data/acquire` on the instance. A permanent special case for Acquire's
directory name is the wrong trade against a single move.

### 6. The menu, and what the registry becomes

The menu is generated from the list of mounted games rather than
hand-maintained HTML — `basePath` and `title` come off `MountedGame`. Adding a
game becomes: write the package, add one import to `apps/host`.

PORTS.md's server block collapses with it. One process needs one `PORT`, so
4001/4002/4003 retire; the 7931/7932/7933 dev-client slots survive, because
three Vite dev servers still coexist during development. The registry shrinks
to that one column and the path list.

### 7. Acquire's path becomes `/acquire`

`/acquire-startups-m1` is a GitHub Pages repository name that leaked into the
URL — PORTS.md already apologises for it, and the menu link exists partly to
hide it. Retiring the Pages deploy removes its only reason to exist, so the
rename happens here rather than never.

**It cannot happen any earlier than step 9, and that is a hard constraint.**
Acquire's `BASE_PATH` *is* its Pages path: `gh-pages` publishes to
`petroleumjelliffe.github.io/acquire-startups-m1/`, and a built client whose
base disagrees with where it is served requests every asset from a path that
does not exist. So the rename is coupled to Pages retirement — the same
commit, or the deployment breaks.

The consolidation `basePath.ts` already did makes the change small. The
literal appears in exactly three places in the codebase:

- `basePath.ts` — the one true source
- `server/clientOverWire.test.ts` — a hardcoded socket path
- `src/pages/HomePage.test.tsx` — a hardcoded route

Vite's `base`, the router basename, the PWA `start_url` and `scope`, the
socket mount and the health twin all derive from it and follow for free.

Nothing player-visible is lost: `createIdentityStore('acquire')` is keyed on
the app id, never the path, so stored identities and remembered names survive
untouched, and saved rooms are keyed by room id under a directory this spec
already names `acquire`.

Two costs, both accepted:

- **Old links.** `apps/host` keeps a permanent redirect from
  `/acquire-startups-m1/*` to `/acquire/*`, preserving the suffix so shared
  room links keep working. Two lines, kept indefinitely.
- **Installed PWAs orphan.** An installed app is scoped to the old path.
  Following the redirect takes it outside its own scope, so it opens in a
  browser tab instead of standalone until reinstalled. Unavoidable, affects a
  handful of phones, and the redirect means nothing actually breaks.

### 8. Layout

```
game-host/
  apps/host/            # composes everything; the only deploy artifact
  games/railbaron/
  games/acquire/
  games/marcopolo/
  packages/lobby/       # was the vendor/lobby submodule
  infra/                # Caddyfile, launchd plist, install script
  specs/  docs/
```

`games/acquire/` is the directory name from step 3 onward, while
`BASE_PATH` stays `/acquire-startups-m1` until step 9 renames it (§7).
Directory names are not URL paths, and the short directory name is free
immediately — only the URL has to wait for Pages to retire.

npm workspaces — all three are already npm with lockfiles. One
`tsconfig.base.json`, one vitest workspace, one version each of Vite 8,
vitest 4 and `@vitejs/plugin-react` 6. History comes across by subtree merge
for all four source repos, so `git log --follow` and blame survive the move.

Retiring the submodule deletes the `build:server` guard scripts in Rail Baron
and Acquire (both exist only to catch an unfetched submodule) and the
`submodules: recursive` special case in Rail Baron's CI checkout.

## Phase 0 — hardening in the separate repos, before any migration

These changes are independently correct, land in their own repos with their
own review, and come across in the subtree merge. Doing them inside the
migration would produce a diff nobody can review and a history nobody can
bisect: if something breaks afterwards, "did the move do it or did a type fix
do it?" must remain answerable.

**Measured, not estimated** — `tsc --noUncheckedIndexedAccess` run against
each repo on 2026-08-19:

| Repo | Errors | Shape |
| --- | --- | --- |
| Rail Baron | 0 | flag already on |
| Marco Polo | 0 | flag off, passes clean anyway |
| Acquire | 633 | 520 in tests, 113 in source, across 42 files |

1. **Marco Polo: turn on `noUncheckedIndexedAccess`.** Free — zero errors
   today. Locks the property in before the codebase grows.
2. **Acquire: add a CI workflow** (test + typecheck). Acquire and Marco Polo
   have none; Rail Baron's `deploy.yml` is the only workflow in any repo. A
   633-error refactor should not be gated only by a laptop.
3. **Acquire: turn on `noUncheckedIndexedAccess`**, tests first (mechanical),
   source second (113 sites, in its own commit — that is where reading the
   code might find a real bug rather than a false positive).
4. **Rail Baron: split `tsconfig.server.json`** to NodeNext and add `.js`
   extensions to server imports. Its server currently runs only because tsx
   patches Node's resolver to accept extensionless ESM imports; plain `node`
   would reject them, which blocks compiling `apps/host` later. Acquire
   already has exactly this split and is the pattern to copy.
5. **Acquire: make the dev seed safe.** `server/devSeed.ts` registers
   `POST /dev/rooms` — unprefixed, and guarded by
   `process.env.NODE_ENV !== 'production'`, which **fails open**: an unset
   `NODE_ENV` would register a route that installs arbitrary game state.
   `NODE_ENV=production` is confirmed set on the live Render service
   (2026-08-19), so nothing is exposed today — this is hygiene, not an
   incident. Prefix the route under `BASE_PATH` and invert the guard to
   `=== 'development'`, so the protection comes from the code rather than
   from an environment variable staying set. Composition raises the stakes:
   the route currently sits at the root of what becomes a shared app.
6. **Acquire: make the dev base symmetric.** `vite.config.ts` sets
   `base: command === 'build' || isPreview ? BASE_PATH : "/"`. That single
   asymmetry is the sole cause of three workarounds — the two-key socket
   proxy, `SOCKET_PATH=/socket.io` in `dev:server`, and the `__PWA_BASE__`
   placeholder in `index.html`. Rail Baron's config comment states the
   contrast plainly: *"One key suffices because `base` is BASE_PATH in dev and
   build alike."* Making dev base `BASE_PATH` deletes all three.

## Migration sequence

Each phase leaves a working tree; nothing below is a flag day except step 10.

1. **Phase 0** above, in the three game repos.
2. Monorepo skeleton in this repo: workspaces, `tsconfig.base.json`, vitest
   workspace, root scripts.
3. Subtree-merge all four source repos into their target directories. Nothing
   is refactored in this step — packages still build the way they did.
4. Lobby: submodule to workspace package. Rewrite `../vendor/lobby/…` imports,
   delete the `build:server` guards, give the lobby its own suite.
5. Toolchain unification, one package at a time, suite green after each:
   Vite 8, vitest 4, plugin-react 6, shared tsconfig, one linter/formatter
   (there is none in any repo today, which is why quote style and operator
   placement differ).
6. Factory refactor, one game at a time: each exposes `mount(ctx)`; the boot
   block becomes a wrapper.
7. `apps/host`: composition, generated menu, aggregate `/health`, `DATA_DIR`,
   per-game error boundary.
8. Composition test suite (below).
9. Render cutover: point the service at the monorepo, `DATA_DIR=/var/data`,
   `mv /var/data/games /var/data/acquire`, drop `SOCKET_PATH` and
   `VITE_SERVER_URL`, retire Acquire's Pages deploy and its `gh-pages`
   dependency and `.env.production` and `public/404.html` — and in the same
   commit rename `BASE_PATH` to `/acquire`, adding the redirect from the old
   prefix. The rename and the Pages retirement are one atomic step (§7);
   splitting them breaks whichever deployment goes second.
10. LAN cutover: one launchd agent instead of three; the Caddyfile collapses to
    a single `reverse_proxy` for everything on port 80.
11. Archive the four source repos on GitHub, read-only.

Rail Baron's Pages deploy **stays** — it is a client-only offline companion
you use at the table, a different product from the hosted game, and it costs
nothing to keep. Its workflow moves into the monorepo with a path filter.

## Verification

1. **Composition, the load-bearing test.** Boot `apps/host` on port 0 and
   assert all three socket paths connect *simultaneously*, with a Marco Polo
   round ticking while an Acquire turn commits. This is the regression guard
   for both the `destroyUpgrade` race and cross-game event-loop interference,
   and neither is caught by any per-game suite.
2. **Route isolation.** The menu is served at `/`; each game's prefixed
   `/health` answers with its own versions; bare `/health` aggregates all
   three; each game's SPA fallback does not answer under another's prefix.
3. **Per-game suites unchanged.** Every existing socket suite still boots its
   own standalone server on port 0 — the proof that the factory seam survived.
4. **Error boundary.** A handler that throws in one game leaves the other two
   serving and the throwing socket rejected rather than the process dead.
5. **Saves across a restart**, with `DATA_DIR` set: a Rail Baron and an
   Acquire room both come back, from the paths the host allocated.
6. **Render shape**, on the deployed instance: all three games playable on one
   origin, `/dev/rooms` absent, and Acquire's rooms intact across the disk
   rename.
7. **The Acquire rename**: `/acquire/` serves the game with every asset
   resolving; `/acquire-startups-m1/room/ABCD` redirects to `/acquire/room/ABCD`
   rather than 404ing; and a browser holding a stored identity from before the
   rename still rejoins its room, proving the app-id keying held.

## Deferred, deliberately

Named here so they are decisions rather than oversights.

- **A shared `packages/room-store`.** Rail Baron's and Acquire's stores are
  one design implemented twice: same envelope, same atomic temp-and-rename,
  same validate-on-load. The divergence is naming (`skipped` vs `unreadable`)
  plus one real capability gap — Acquire has `quarantine()` and Rail Baron
  does not. Unifying would give Rail Baron quarantine for free. Not on the
  critical path for one process.
- **`RoomPlayer`** in Acquire is `export type RoomPlayer = SeatHolder` — a
  pure alias creating apparent divergence where there is none. Delete when
  touching that file for another reason.
- **A shared remembered name.** `createIdentityStore` keys the name
  `${appId}.name`, so a player types theirs once per game. On a shared origin
  a single `lobby.name` key would carry it across all three — a real
  game-night nicety that only becomes possible after this migration.
- **Tightening CORS.** Rail Baron and Acquire both run `origin: '*'`;
  Acquire's DEPLOYMENT.md already lists this under known loosenesses. One
  public origin makes it easy to close.
- **Compiling `apps/host`.** All three servers run under `tsx`, which
  transpiles the whole server graph at every cold start — three servers plus
  the lobby, on every Render restart. Measure first; Phase 0's NodeNext work
  is what makes compiling possible at all.
- **`useRoom.ts` in Rail Baron and Acquire** looks like duplication and is
  not: 81 and 119 lines differing across most of them, because the two games
  genuinely need different things from a room. Left alone on purpose.

## Risks accepted

- **Deploy coupling is sharper than crash coupling.** A Render service with a
  disk gets no zero-downtime deploys, so every deploy of any game restarts the
  instance and drops any live Marco Polo round — and Marco Polo persists
  nothing. A one-line Rail Baron fix can end a game in progress. The error
  boundary does not help here; only deploy timing does.
- **Build fan-in.** One build now runs three Vite builds plus Acquire's
  manifest prebuild, and a failure in any one blocks all three from shipping.
- **Single-instance ceiling.** A service with a disk cannot scale past one
  instance. That is already true of Acquire today and is not a new constraint,
  but it now applies to every game at once.
- **Protocol coupling.** A `protocolVersion` bump in one game redeploys all
  three. Each game keeps its own version and its own handshake, so nothing
  breaks — but the deploys are no longer independent.
