# Composition Implementation Plan — three games, one process

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** complete, 2026-08-19. Every box below is ticked; see "As built" for what the implementation found that the design did not know.

**Goal:** One Node process serves all three games at once — one Express app, one HTTP server, three socket.io servers — behind a generated menu, with every existing per-game suite still passing untouched and no deployment changed.

**Architecture:** Each game grows a `mount(ctx)` that adds its routes and its socket server to an app it does not own. Its existing exported boot function stays, byte-for-byte compatible from the outside, and becomes a thin standalone wrapper over `mount` — which is what keeps 145 test files from needing to know any of this happened. A new `apps/host` creates the app, calls three mounts, generates the menu from what came back, and listens on one port. A new `packages/host` holds the contract they all speak and the error boundary that keeps one game's throw from ending the other two.

**Tech Stack:** npm workspaces (npm 11.19, Node 26.7), TypeScript 6, Express 5, socket.io 4.8, vitest 4, tsx.

**Spec:** [`specs/2026-08-19-monorepo-single-host.md`](../../specs/2026-08-19-monorepo-single-host.md) — this plan implements migration-sequence steps 6–8 only.

**Predecessor:** [`docs/plans/2026-08-19-monorepo-one-repo.md`](2026-08-19-monorepo-one-repo.md) — complete and merged to `main` at `3e06590`.

**Successor:** the cutover plan (spec steps 9–11) — Render, the `/acquire` rename, the LAN collapse, archiving the source repos. None of it is here.

## Global Constraints

- **Nothing here changes a deployment.** Acquire's Render service still deploys from its own source repo, and both GitHub Pages deploys still run from theirs. `apps/host` is new code that nothing deploys yet. Do not touch `.env.production`, `gh-pages`, `public/404.html`, or Acquire's `deploy` script.
- **Do not rename `BASE_PATH`.** Acquire's stays `/acquire-startups-m1`. It is simultaneously the live Pages path, and the rename is atomic with Pages retirement in the cutover plan (spec §7). `apps/host` mounts Acquire at whatever `BASE_PATH` says, so the rename lands later as a one-line change and this plan never encodes the literal.
- **Do not move or edit `Caddyfile`, `launchd/`, `menu/`, `saves/`, or the `start-*.sh` scripts.** The live game machine reaches them through `/opt/homebrew/etc/game-host` symlinks and still runs three services off three ports. Every one of those keeps working through this plan, because every game's standalone boot keeps working. `menu/index.html` stays the Caddy-served menu; the generated menu is a *different* menu, served by `apps/host` at `/`, and the two coexist until the cutover.
- **Every existing test passes unchanged.** Not "passes after a small edit" — unchanged. The 1548 tests are the proof the factory seam is real, and a test you edited to accommodate a refactor has stopped being evidence about that refactor.
- **Baseline: 1548 tests / 145 files** (Marco Polo 89/14, Rail Baron 593/49, Acquire 835/77, lobby 31/5). Every task ends at that number or above. A task that ends *below* it has broken something, no matter what its own new tests say.
- **A `tsx watch` reloads code but never its environment.** Any step that changes an environment variable or a script says "restart your dev servers" out loud. Phase 0 lost four days to exactly this.

## The two decisions that shape everything below

**1. `mount()` is the new function; the old boot function becomes its caller.**

The spec says the standalone boot blocks "become thin wrappers over `mount`". Read strictly, its other sentence — "games register only their prefixed twin; the host owns bare `/health`" — would delete a route that ten existing assertions across three games depend on, along with Marco Polo's root static mount that its own suite checks. So the split is drawn one level lower than the spec's prose implies, and the reason is the spec's own verification item 3:

- **`mount(ctx)`** registers *only* what is safe to compose: the prefixed routes, the prefixed health twin, the prefixed static mount and SPA fallback, the socket server.
- **The standalone wrapper** — `createAppServer()` / `startServer()` / `createServer()`, keeping its exact current name, signature and return type — creates its own app and HTTP server, calls `mount`, and then adds the things that only make sense when the game is alone in a process: bare `/health`, and for Marco Polo the root static mount.

A standalone wrapper *is* a host with one game in it. Nothing in the spec's intent is lost, and the diff stops at the file that has to change. Every socket suite, every `staticClient.test.ts`, every `versioning.test.ts` keeps booting the same function and asserting the same things.

**2. The error boundary is a monkey-patched `socket.on`, applied once per connection.**

Handlers register through exactly one call shape across all three games and the lobby: `socket.on(event, handler)`, on the socket handed to `attach()`. Replacing that one method on the socket instance, at `io.on('connection')` time, wraps every handler any package registers afterwards — including the lobby's seven, which no game can reach to wrap individually.

The rejected alternative was a `Proxy` around the socket. It splits identity: `lobby.socketsFor()` and Marco Polo's `io.sockets.sockets` iteration both return the *real* socket from socket.io's registry, so half the code would hold the guarded object and half the raw one. It also has a `this`-binding hazard — `Reflect.get(target, prop, receiver)` hands back methods bound to the proxy, which breaks any class method reaching for private state. Patching the instance has neither problem: one object, guarded everywhere, and `on` is rebound to the real socket explicitly.

## File Structure

```
game-host/
  package.json                    # MODIFIED — "apps/*" joins the workspace globs
  PORTS.md                        # MODIFIED — one row: the composed host claims 4000
  packages/host/                  # NEW — the contract, the boundary. No game logic.
    package.json                  #   @game-host/host
    contract.ts                   #   HostContext, MountedGame, Mount
    guard.ts                      #   guardSocket, guardTick
    guard.test.ts
  apps/host/                      # NEW — the composed process; skeleton in Task 1,
    package.json                  #   contents in Task 5. The only package allowed
    twoGames.test.ts              #   to depend on all three games.
    main.ts                       #   boot: env, listen, signals
    host.ts                       #   createHost(): app, mounts, menu, /health
    menu.ts                       #   generated from MountedGame[]
    compose.test.ts               #   the load-bearing suite
    routes.test.ts
    boundary.test.ts
    saves.test.ts
  games/marcopolo/server/app.ts   # MODIFIED — mount() + wrapper
  games/marcopolo/server/mount.test.ts   # NEW — one game, a borrowed app
  games/railbaron/server/index.ts # MODIFIED — mount() + wrapper
  games/acquire/server/index.ts   # MODIFIED — mount() + wrapper
```

---

## Task 1: `packages/host` — the contract and the boundary

Nothing composes yet. This task produces the two pieces every later task imports, and proves the boundary works against a real socket.io server before any game depends on it.

**Files:**
- Create: `packages/host/package.json`, `packages/host/contract.ts`, `packages/host/guard.ts`, `packages/host/guard.test.ts`, `packages/host/tsconfig.json`, `packages/host/vitest.config.ts`
- Modify: `package.json` (workspace globs), `tsconfig.base.json` (paths for `@game-host/host`)

**Interfaces:**
- Consumes: `express`, `socket.io`, `@game-host/lobby/protocol/protocol.js` (for the `rejected` event name).
- Produces: `HostContext`, `MountedGame`, `guardSocket`, `guardTick`.

- [x] **Step 1: The package, resolved the same way the lobby is**

  Copy `packages/lobby/package.json`'s shape exactly — raw TypeScript, no build step, `exports` mapping both `"./*.js"` and `"./*"` to `"./*.ts"`. That dual mapping is what lets NodeNext callers (Marco Polo, Acquire) write `@game-host/host/contract.js` and bundler-resolution callers (Rail Baron) write `@game-host/host/contract`, from one package with no compile step. It is proven — 65 imports across 50 files already ride it — so do not invent a second scheme here.

  Add the matching `paths` pair to `tsconfig.base.json` alongside the lobby's, and `"apps/*"` to the root `workspaces` array.

  Create the `apps/host` package **skeleton** here too — `package.json`, `tsconfig.json`, `vitest.config.ts`, and nothing else. Task 5 writes its real contents. It exists this early because Task 3 needs somewhere to put a test that imports two games at once, and neither game's own package can own that test without depending on the other. `apps/host` is the one package allowed to depend on all three; that is its whole job.

- [x] **Step 2: `contract.ts`, verbatim from the spec**

```ts
export interface HostContext {
  app: express.Express;
  httpServer: http.Server;
  /** Host-allocated and already created. Absent for games that persist nothing. */
  dataDir?: string;
}

export interface MountedGame {
  basePath: string;
  title: string;
  version(): { protocolVersion: number; saveVersion?: number };
  io: SocketServer;
  close(): Promise<void>;
}

export type Mount = (ctx: HostContext) => Promise<MountedGame>;
```

  `title` is new information — no game holds a display name today, because until now nothing needed one. Marco Polo is `Marco Polo`, Rail Baron `Rail Baron`, Acquire `Acquire`. Take them from `menu/index.html` so the generated menu and the static one agree.

  `close()` returns a promise because Rail Baron's does real work: `rooms.settled()` drains in-flight saves before the sockets go, or a room comes back a move behind. Marco Polo's clears its tick intervals. Neither is optional.

  **`close()` must never call `io.close()`, and this is the second `destroyUpgrade`.** Verified in `node_modules/socket.io/dist/index.js`: `initEngine` stores the server it attached to (`this.httpServer = srv`, line 303) on *every* attachment path, and `Server.close()` ends with `this.httpServer.close(...)` (line 499). Composed, that server is the host's. So the first game to close would close the listener out from under the other two — an entire process going dark because one game shut down.

  Rail Baron's existing `close()` comment already states the mechanism — "io.close() disconnects every socket and closes the http server it was attached to" — as a *convenience*, which is exactly what it is with one game in the process and exactly what makes it dangerous with three.

  The scoped equivalent is `io.disconnectSockets(true)` followed by `io.engine.close()`. `engine.close()` closes only that engine's own clients and its own `ws` server (`cleanup()` in `engine.io/build/server.js`), and each attached engine has its own — so it is per-game by construction. **Exactly one thing closes the shared `httpServer`: whoever created it.** That is the host in composition, and the standalone wrapper on its own, in both cases after every `MountedGame.close()` has resolved.

- [x] **Step 3: `guardSocket` — the boundary**

```ts
/**
 * Contains a throw from any handler registered on this socket after this call.
 *
 * Patched onto the instance rather than wrapped in a Proxy: `lobby.socketsFor()`
 * and Marco Polo's `io.sockets.sockets` iteration both hand back the socket
 * socket.io holds, so a wrapper object would leave half the process holding the
 * guarded socket and half the raw one. There is one object here, and it is
 * guarded everywhere it appears.
 *
 * Called at `io.on('connection')`, before any attach: socket.io's own internal
 * listeners are registered before that point and are deliberately not covered —
 * they are transport plumbing, not game code, and their throws are not the
 * hazard this exists for.
 */
export function guardSocket(socket: Socket, game: string): Socket
```

  On a throw: log `[<game>] handler for '<event>' threw`, with the error, and emit `rejected` to the originating socket with `code: 'serverError'`. `RejectedMessage.code` is typed `code: string`, not a union — the lobby's comment says it is generic precisely so consumers can add codes — so no protocol change is needed and no client needs a new branch. All three clients surface `.message` rather than switching exhaustively on `.code`; confirm that when you write the test, and if any client *does* switch exhaustively, report it rather than adding a code it will fall through.

  Guard `once` as well as `on`. Rebind through a captured `socket.on.bind(socket)`, never `this`.

- [x] **Step 4: `guardTick` — the boundary's other half**

  A socket guard covers everything that arrives on a socket. Marco Polo's simulation does not arrive on a socket: `gameHandlers.ts` runs a `setInterval` per active room at `TUNING.tickHz = 20`, and a throw inside a timer callback reaches nothing but the top of the stack. It is the highest-frequency code in the composed process and the only scheduled entry point in any game, so leaving it outside the boundary would leave the boundary's most likely trigger outside it.

```ts
export function guardTick<A extends unknown[]>(
  game: string, fn: (...args: A) => void,
): (...args: A) => void
```

  Log and swallow. A tick that throws twenty times a second will say so twenty times a second, which is the correct amount of noise for a game that is now broken.

- [x] **Step 5: `guard.test.ts` — against a real server, not a fake socket**

  A hand-rolled `{ on() {} }` stub cannot tell you whether the patch survives socket.io's actual `Socket`. Boot a real `SocketServer` on an ephemeral port, connect a real client, and assert:

  - a handler that throws leaves the server process alive and the client connected
  - the throwing client receives `rejected` with `code: 'serverError'`
  - a *second* client's handlers still run afterwards
  - `socket.id`, `socket.rooms`, `socket.join()`, `socket.emit()` and `socket.disconnect()` all still work on a guarded socket — the identity-preservation claim, tested rather than asserted
  - a handler registered *before* `guardSocket` is not retroactively guarded (documents the ordering requirement)
  - `guardTick` swallows and logs

**Verification:**
```bash
npm test --workspace @game-host/host
npm run typecheck
```

**Stop condition:** if the patched `on` breaks any socket.io behaviour the fourth bullet tests — stop and report before touching a game. Everything below assumes this primitive is sound.

---

## Task 2: Marco Polo mounts

First because it is the smallest, has no saves, no `cors`, and already has a factory — `createAppServer()` is two thirds of the way there. It is the shape check for the other two.

**Files:**
- Modify: `games/marcopolo/server/app.ts`, `games/marcopolo/server/gameHandlers.ts` (tick guard only), `games/marcopolo/package.json` (add `@game-host/host`)

**Interfaces:**
- Consumes: `HostContext`, `guardSocket`, `guardTick`.
- Produces: `mount(ctx): Promise<MountedGame>`; `createAppServer()` unchanged from the outside.

- [x] **Step 1: Split `createAppServer` at the seam**

  `mount(ctx)` takes `ctx.app` and `ctx.httpServer` instead of creating them, and registers:

  - the prefixed health twin only
  - `app.use(BASE_PATH, express.static(dist))` — the prefixed static mount only
  - `new SocketServer(ctx.httpServer, { path: SOCKET_PATH, destroyUpgrade: false, serveClient: false })`
  - the lobby and game wiring, exactly as today

  Everything else moves to the wrapper. Return `{ basePath: BASE_PATH, title: 'Marco Polo', version: () => ({ protocolVersion: PROTOCOL_VERSION }), io, close }`.

- [x] **Step 2: `destroyUpgrade: false`, with the comment that explains it**

  This is the single most important line in the plan and the one most likely to be deleted by someone tidying up, because nothing visibly breaks when it goes. Copy the reasoning from spec §1 into the code: engine.io's `attach` caches and chains `request` listeners, but installs `upgrade` listeners additively with no chaining, so **every** attached engine sees **every** websocket upgrade, and the ones whose path does not match schedule a 1-second timer that ends the socket unless it has written bytes. The handshake normally wins that race by a mile, which is exactly why its absence would surface as sockets failing rarely, under load, on the slowest phone at the table.

  Set it in the standalone path too. One code path, not two — a flag that is only set when composed is a flag that is only tested when composed.

- [x] **Step 3: `serveClient: false`**

  No client loads socket.io from the server; all three bundle it. Three servers each serving their own copy of `socket.io.js` is dead weight in a process that now has three of everything — and it is not only weight: `initEngine` calls `attachServe(srv)` when the option is on, which splices into the **shared** server's `request` listeners. Three games each patching the host's listener chain to serve a file none of their clients ask for is a cost with no benefit on the other side.

- [x] **Step 4: The wrapper keeps what only a lone process can have**

```ts
export function createAppServer(): { httpServer; io; stop() } {
  const app = express();
  const httpServer = createServer(app);
  app.get('/health', health);          // bare: unreachable through Caddy, but
                                       // this is how `curl localhost:4003` works
  const game = mount({ app, httpServer });
  app.use(express.static(dist));       // root: a bare port lands on the game
  ...
}
```

  Note the ordering, and comment it: the root static mount goes on *after* `mount`, so the prefixed routes win. It is also the one line that could never be composed — served at the root it would answer `/` with Marco Polo's `index.html`, which is the menu's job.

  `createAppServer` is currently synchronous and `mount` is async. Making the wrapper async would change its signature and break `main.ts` and `wire.test.ts`, which violates the unchanged-tests constraint. Marco Polo's mount has nothing to await — no restore, no store — so give it a synchronous core and have `mount` return `Promise.resolve(...)` of it. If that turns out awkward, the fallback is for the wrapper to keep constructing synchronously and expose the mount separately; do not change `createAppServer`'s signature.

- [x] **Step 5: Guard the tick and the connection**

  `io.on('connection', socket => { guardSocket(socket, 'marcopolo'); game.attach(socket); wiring.attach(socket); })`.

  Guard before both attaches — that is what covers the lobby's handlers. Preserve the existing ordering comment: game first, because its disconnect handler reads the seat binding the lobby's disconnect handler deletes.

  In `gameHandlers.ts`, wrap the `setInterval` callback in `guardTick('marcopolo', …)`.

- [x] **Step 6: Compose it alone, before two other games copy this shape**

  `mount()` is otherwise dead code until Task 5 — three tasks of a contract nobody calls, whose first real exercise would come after Rail Baron and Acquire had already copied whatever is wrong with it. So end this task with the smallest possible proof: a new test that creates a bare `express()` and `http.Server`, mounts Marco Polo into them, listens on port 0, and asserts a client connects at `/marcopolo/socket.io`, the prefixed health twin answers, and `close()` leaves the HTTP server still listening.

  That last assertion is the `io.close()` hazard, caught at the cheapest possible moment: one game, one file, no other game to confuse the diagnosis.

  This test lives in `games/marcopolo/server/mount.test.ts` — a new file, which the unchanged-tests constraint permits. It duplicates a little of what Task 6 will do properly with three games; that is the point.

- [x] **Step 7: Run the suite**

  89 existing tests / 14 files, unchanged, with no edits to any test file, plus step 6's new file. If `wire.test.ts` needs an edit, the seam is in the wrong place — go back to step 1.

**Verification:**
```bash
npm test --workspace @game-host/marcopolo   # 89 existing + new mount.test.ts, none modified
git diff --stat games/marcopolo             # app.ts, gameHandlers.ts, package.json
npm run build --workspace @game-host/marcopolo
npm run typecheck
```

**Stop condition:** any change to a `*.test.ts` under `games/marcopolo`. Report what forced it instead of making it.

---

## Task 3: Rail Baron mounts

**Files:**
- Modify: `games/railbaron/server/index.ts`, `games/railbaron/server/handlers.ts` (step 6 only), `games/railbaron/package.json`

**Interfaces:**
- Consumes: `HostContext`, `guardSocket`.
- Produces: `mount(ctx)`; `startServer(opts)` unchanged from the outside.

- [x] **Step 1: `mount(ctx)` takes its save directory from `ctx.dataDir`**

  `startServer`'s `opts.gamesDir` is required and absolute by discipline. `mount` reads `ctx.dataDir`, which the host has already created (Task 5). `mount` throws if it is absent — Rail Baron cannot run without somewhere to save, and a silent fallback to a relative path is the exact failure the `GAMES_DIR` note in `CLAUDE.md` exists to prevent.

- [x] **Step 2: Move the restore inside `mount`**

  `startServer` currently awaits `rooms.restore()` before `listen`, with the comment that no socket can race the restore because none can connect yet. Composed, the host awaits all three mounts before it listens, so the property is preserved for free — but it is preserved *because* the restore is inside `mount`, not in the boot block. Keep the comment and extend it to say so.

- [x] **Step 3: Scope `cors()` to the base path**

  `app.use(cors())` at the root is harmless in a process with one game and wrong in a process with three: composed, it would apply Rail Baron's `origin: '*'` policy to Marco Polo's routes and to the menu, neither of which ever had it. `app.use(BASE_PATH, cors())` inside `mount` keeps each game's policy the size of each game. socket.io's own `cors` option is separate and unaffected.

  Tightening `origin: '*'` itself is deliberately deferred (spec's deferred list); this step only stops it leaking sideways.

- [x] **Step 4: `destroyUpgrade: false`, `serveClient: false`, `guardSocket`**

  As Task 2, steps 2, 3 and 5. Rail Baron has no tick.

  Preserve the `opts.socketPath` seam: `mount` uses `SOCKET_PATH` unconditionally, and the wrapper keeps the option. The comment on that option — that the env read lives in the boot block so no ambient env can move a test server's mount — is still true and still load-bearing.

- [x] **Step 5: The wrapper**

  `startServer(opts)` keeps its exact signature and its `RunningServer` return: creates app and server, registers the bare `/health`, calls `mount`, listens with the `once('error', reject)` dance intact, prints the same banner, returns `{ port, close }` where `close` delegates to the mounted game's.

- [x] **Step 6: The unhandled-rejection question, answered here rather than in the host**

  `handlers.ts` does `void rooms.persist(room)` — a floating promise. Alone in a process, a rejection there takes down Rail Baron, which restores from disk on restart; the cost is a page refresh. Composed, it takes down a live Marco Polo round, which persists nothing and cannot be restored at all. Same line of code, much larger blast radius — which is spec §3's argument applied to the one path the socket guard does not cover.

  Attach a `.catch` that logs at each `void rooms.persist(...)` site, in Rail Baron and in Acquire. Do this rather than installing a process-level `unhandledRejection` handler in `apps/host`: a global handler changes the failure semantics of every dependency in the process, which is a much bigger decision than this plan should make on its own, and it silences rejections that ought to be loud.

- [x] **Step 7: Two games, one server — the first composition that is actually one**

  `apps/host/twoGames.test.ts`. Mount Marco Polo *and* Rail Baron into one bare app and one bare HTTP server, listen on port 0, and assert:

  - both socket paths accept a client **at the same time**, over `transports: ['websocket']`
  - each prefixed `/health` answers with its own versions, not the other's
  - closing Rail Baron leaves Marco Polo's client connected and its route serving — the `io.close()` hazard, now with a second game present to actually be harmed by it
  - closing both, then the HTTP server, exits cleanly with no open handles

  This is the earliest point in the plan where two engine.io instances share one server, which means it is the earliest point where `destroyUpgrade: false` is doing real work and where the shared-`httpServer` close would bite. Finding either here rather than in Task 6 saves discovering it with three games and a menu in the way.

**Verification:**
```bash
npm test --workspace @game-host/railbaron   # 593 / 49, no test file modified
npm test --workspace @game-host/apps-host   # step 7's two-game test
npm run typecheck
```

**Stop condition:** as Task 2 — any test edit.

---

## Task 4: Acquire mounts

Largest suite, most seams already present. `createServer(options)` already returns `{ app, httpServer, io, rooms, devSeed }` and already takes a `store` and a `socketPath`, which is most of a contract already.

**Files:**
- Modify: `games/acquire/server/index.ts`, `games/acquire/package.json`

- [x] **Step 1: `mount(ctx)` builds the store from `ctx.dataDir`**

  `createFileStore(ctx.dataDir)` when present, `createNullStore()` when not — matching `createServer`'s existing default, which is what lets a bare test server boot with no disk. Leave `gamesDir()` and its four tests exactly as they are: it is the *boot block's* env fallback, it is exported precisely so the fallback is testable, and the cutover plan replaces its caller, not it.

- [x] **Step 2: Move the restore inside `mount`, and keep the settle-either-way shape**

  The boot block currently does `rooms.restore().then(…).catch(…).finally(listen)`, with a comment explaining that a restore failure must never keep the server from booting. Inside `mount` the same rule holds with more force — a failed Acquire restore must not stop Marco Polo and Rail Baron from mounting. `await` it inside a try/catch that logs and continues; the host's `listen` then plays the part `.finally` played.

- [x] **Step 3: `devSeed` stays exactly where it is**

  `registerDevSeed` mounts at `${BASE_PATH}/dev/rooms` — already prefixed, no collision, nothing to move. The `NODE_ENV === 'development'` read stays inside the factory, for the reason its comment gives: ambient env is the real input to that decision, and `devSeed.test.ts` exercises it by setting `NODE_ENV` around the constructor. Hoisting it to the boot seam would move the decision somewhere no test can reach.

  Do not add `devSeed` to `MountedGame` — it is not in the contract and Acquire is the only game with one. Keep the boot banner reporting it in the wrapper, and have `apps/host` print it too (Task 5, step 6). That banner is the four-day lesson from 2026-08-19 and the composed process needs it just as much.

- [x] **Step 4: Scope `cors()`, set `destroyUpgrade: false` and `serveClient: false`, guard the connection**

  As Task 3. Acquire's `socket.on('ping-settle')` is registered inside `io.on('connection')` and must be registered *after* `guardSocket` like everything else — the settle primitive that hundreds of tests depend on for ordering belongs inside the boundary, not outside it.

- [x] **Step 5: The wrapper is `createServer`, unchanged from outside**

  Same name, same `ServerOptions`, same `ServerHandle` including `devSeed`. `socketHarness.ts` calls it and must not change; nor must `versioning.test.ts`, which asserts both the bare and the prefixed health routes and is the closest thing the repo has to a test *of* the twin arrangement.

  `createServer` is synchronous today and `mount` is async — the same tension as Marco Polo, and sharper here because the restore genuinely awaits. Resolve it the same way: the wrapper stays synchronous by constructing the mount's synchronous core and starting the restore without awaiting it — which is what the boot block does today, so this is not new behaviour for the standalone path — while `mount` awaits it properly. Write the comment that says why the two paths differ, because the difference is real: composed, the restore finishes before anyone can connect; standalone, it races `listen` exactly as it does now.

- [x] **Step 6: `.catch` on every `void rooms.persist(...)`**

  As Task 3, step 6.

**Verification:**
```bash
npm test --workspace @game-host/acquire     # 835 / 77, no test file modified
npm run build --workspace @game-host/acquire
grep -c 'acquire-startups-m1' games/acquire/dist/index.html   # still the Pages path
npm run typecheck
```

**Stop condition:** as Task 2 — any test edit. `socketHarness.ts` is not a test file but is load-bearing for hundreds of them; a change there needs the same report.

---

## Task 5: `apps/host` — the composed process

**Files:**
- Create: `apps/host/package.json`, `apps/host/host.ts`, `apps/host/menu.ts`, `apps/host/main.ts`, `apps/host/tsconfig.json`, `apps/host/vitest.config.ts`
- Modify: `PORTS.md`, root `package.json` (scripts)

**Interfaces:**
- Consumes: all three `mount`s, `MountedGame`.
- Produces: `createHost(opts): Promise<{ app, httpServer, games, close() }>` — the seam the Task 6 suite boots on port 0.

- [x] **Step 1: `createHost`, and the route order that is now a cross-package invariant**

  In this order, and the order is the point:

  1. `app.get('/health', …)` — **before** the mounts, so no game can shadow it. Express matches in registration order; today all three games register a bare `/health` and whichever booted first would silently own it. Registering the host's first makes that impossible rather than merely unlikely.
  2. the three mounts, each adding its prefixed routes
  3. the menu at `/` — **last**, so it can never shadow a game

  Each game's SPA fallback is `app.use(BASE_PATH, …)` and so is already prefix-scoped. That was an accident of each game being alone in its process; Task 6 makes it something a test asserts.

- [x] **Step 2: Aggregate `/health`**

  Built from each `MountedGame.version()`:

```json
{ "ok": true, "games": {
    "/railbaron":           { "protocolVersion": 3, "saveVersion": 2 },
    "/acquire-startups-m1": { "protocolVersion": 5, "saveVersion": 4 },
    "/marcopolo":           { "protocolVersion": 1 } } }
```

  (Illustrative numbers — read the real ones from each protocol module.) One curl now answers "what is deployed" for all three, which is strictly more than any game could say alone — and that question cost a trip to the Render dashboard on 2026-08-07, which is why the per-game endpoints exist at all. Each game's prefixed twin keeps answering for itself; this is an addition, not a replacement.

- [x] **Step 3: `DATA_DIR`, allocated and created by the host**

  One env var replaces three. `${DATA_DIR}/railbaron` and `${DATA_DIR}/acquire` are created before the mounts that need them; Marco Polo is passed no `dataDir` at all, because it persists nothing and an unused directory is a question someone will ask later.

  The directory name is `acquire`, not `acquire-startups-m1` — directory names are not URL paths. The one-shot `mv /var/data/games /var/data/acquire` on the Render instance belongs to the cutover plan; note it in `apps/host`'s comment so it is not discovered by its absence.

  No default. An unset `DATA_DIR` is a hard failure with a message naming the variable, not a relative path that quietly resolves to wherever the process happened to start — the `GAMES_DIR` lesson, which cost the discovery that every saved room appeared to vanish.

- [x] **Step 4: The generated menu**

  From `MountedGame[]`: `basePath` and `title`, nothing else. Adding a game becomes "write the package, add one import".

  Keep it a single self-contained HTML string in `menu.ts` with no assets — the host serves one page and does not need a build step for it. Take the visual shape from `menu/index.html` — `<title>Game Night</title>`, an `<h1>GAME NIGHT</h1>`, and a `<ul>` of links whose text is exactly the three `title`s — so the LAN menu does not change appearance on cutover day. But do **not** import or read that file: it lives behind the `/opt/homebrew/etc/game-host` symlink on the host machine and is deliberately outside this plan's blast radius.

- [x] **Step 5: `PORTS.md` claims 4000**

  One row added, above the game-server block: the composed host, port 4000, path `/`. It is outside the 4001+ block on purpose — it is not a game — and it collides with nothing the registry knows. Do not delete the three server rows: 4001/4002/4003 are still real, still in the Caddyfile, and still what the three launchd agents run. The registry's existing paragraph already says they collapse "when the composition plan lands"; amend it to say the composed host now exists and the collapse happens at cutover.

- [x] **Step 6: `main.ts` — the boot block**

  `PORT ?? 4000`, `DATA_DIR` required, SIGTERM/SIGINT with the two-signal escape hatch all three games already implement.

  Shutdown order is `await Promise.all(games.map(g => g.close()))`, **then** `httpServer.close()` — the host created the server, so the host is the only thing that closes it (Task 1, step 2). `Promise.all`, not sequential: three independent drains have no ordering between them, and Rail Baron's `rooms.settled()` should not be waiting behind Marco Polo's interval teardown while launchd counts down to `SIGKILL`. Use `allSettled` if any game's close proves able to reject — one game failing to drain must not strand the other two.

  One banner line naming the port, and one line per mounted game naming its base path and its socket path — a client hanging at the wrong socket path is diagnosable from that line alone, which is why all three games print it today, and the composed process needs it three times over. Include Acquire's `devSeed` state on its line, for the reason its own comment gives.

  Add root scripts: `dev:host` (`tsx watch apps/host/main.ts`) and `start:host` (`tsx apps/host/main.ts`). Neither replaces anything; the three per-game `dev:server` scripts stay, because the three launchd agents still run them. **Restart any running dev server after this step** — a `tsx watch` never reloads its environment, and `DATA_DIR` is a new one.

  One thing `dev:host` does *not* do: serve a Vite dev client. All three `vite.config.ts` files proxy `<base>/socket.io` to their own game's `400N`, so `npm run dev` still develops a client against that game's standalone server, and that keeps working untouched. Developing a client against the *composed* host means pointing that proxy at 4000, which is a change to three files that are also read by the Caddyfile-era setup — so it belongs to the cutover plan, with the port collapse it is part of. Say so in `apps/host`'s comment rather than leaving the next person to discover that `dev:host` plus `npm run dev` talk past each other.

**Verification:**
```bash
DATA_DIR=$(mktemp -d) npm run start:host      # boots, three banners, no port conflict
curl -s localhost:4000/health                 # three games
curl -s localhost:4000/ | head                # the menu
npm run typecheck
```

**Stop condition:** if two games' mounts conflict in a way the route order does not resolve — stop and report the collision rather than special-casing around it.

---

## Task 6: The composition suite

The tests that could not have existed before, covering the properties no per-game suite can see. This is spec step 8 and the reason the whole exercise is safe.

**Files:**
- Create: `apps/host/compose.test.ts`, `apps/host/routes.test.ts`, `apps/host/boundary.test.ts`, `apps/host/saves.test.ts`
- Modify: `scripts/test-all.mjs`

- [x] **Step 1: `compose.test.ts` — simultaneous play, the load-bearing test**

  Boot `createHost` on port 0 with a temp `DATA_DIR`. Connect real clients to all three socket paths **at once**, with `transports: ['websocket']` so the upgrade path is actually exercised — a polling-only client would never touch the `destroyUpgrade` hazard this test exists to catch. Then run a Marco Polo round *while* an Acquire turn commits and a Rail Baron event appends, and assert all three land.

  This is the regression guard for two failures at once — the upgrade race from spec §1 and cross-game event-loop interference from §4 — and neither is visible to any per-game suite, because a per-game suite only ever has one engine attached.

- [x] **Step 2: Try to make it fail — remove `destroyUpgrade: false` and watch**

  Before trusting step 1, confirm it can fail. Temporarily delete `destroyUpgrade: false` from one game and run the suite under load (repeat the connect fifty times). Record what you observe in an "As built" section — including, honestly, "it still passed", because the handshake wins that race in the overwhelming majority of runs and a test that cannot demonstrate the failure is weaker evidence than it looks. If it cannot be made to fail, say so and leave the option in with its comment: the reasoning from engine.io's source stands on its own, and this step corroborates it rather than justifying it.

- [x] **Step 3: `routes.test.ts` — isolation**

  With fake dist directories for all three games:

  - the menu is served at `/`, and names all three games
  - each game's prefixed `/health` answers with its own versions
  - bare `/health` aggregates all three
  - **each game's SPA fallback does not answer under another's prefix** — fetch `/railbaron/room/ABCD` and get Rail Baron's marker, fetch `/marcopolo/room/ABCD` and get Marco Polo's or a 404, never the other game's
  - a path matching no game and no file falls through to the menu, not into a game
  - non-GETs under a prefix still fall through rather than answering with a page

  Give each fake dist a distinguishable marker string. A test that asserts "200" cannot tell you *which* game answered, and answering-with-the-wrong-game is the entire failure mode here. The `__PWA_BASE__` incident is the precedent: an SPA fallback answered a broken asset path with 200 text/html, so a status-code-only check passed while the page was broken.

- [x] **Step 4: `boundary.test.ts` — one game's throw does not end the others**

  This needs an injectable throw. Do not add a "throw on demand" event to a game's protocol for testing — it would ship. Instead mount a fourth, test-only game defined inside the test file (the contract is a plain interface; a fake implementing it is a dozen lines) whose handler throws on a known event. Assert: the process survives, the throwing socket receives `rejected`, and Marco Polo and Acquire clients connected *before* the throw still exchange messages after it.

  Then the same for `guardTick`: a fake mount whose interval throws, with a Marco Polo round still ticking correctly beside it.

- [x] **Step 5: `saves.test.ts` — across a restart, from host-allocated paths**

  With a temp `DATA_DIR`: create a Rail Baron room and an Acquire room, play a move in each, close the host, boot a second host on the same `DATA_DIR`, and assert both rooms come back. Then assert the directories are where the host said: `${DATA_DIR}/railbaron` and `${DATA_DIR}/acquire` exist, and `${DATA_DIR}/marcopolo` does not.

- [x] **Step 6: Teach `scripts/test-all.mjs` about the two new packages, and run everything**

  It spawns `vitest run --root <package>` per package and bounds concurrency to three worker pools deliberately: four full-machine-sized pools in contention pushed a Rail Baron test past its timeout with no code change behind it. `packages/host` is light and belongs with lobby and marcopolo; `apps/host` boots three games per test file and is **not** light — group it with the heavy pair rather than assuming its file count reflects its cost.

```bash
npm test        # >= 1548 tests plus this plan's additions, across six packages
npm run typecheck
```

**Stop condition:** if step 1 cannot be made to pass, the composition does not work and nothing below it matters. Report rather than working around it.

---

## As built

Recorded here rather than by rewriting the tasks above, per the repo's docs
convention: what the implementation found that the design did not know.

**`destroyUpgrade: false` could not be shown to matter, and the option stays
anyway.** Task 6 step 2 asked for an attempt to make the composition suite
fail with the option removed. It was removed from all three games and the
suite run five times (`compose.test.ts` + `twoGames.test.ts`, 11 tests each
run), then a purpose-built stress file connected 60 clients at once across the
three paths, three rounds, three times — 540 concurrent websocket upgrades in
all. **Every run passed.**

The reason is visible in `engine.io/build/server.js`, and it sharpens the
original argument rather than undermining it: the timer a non-matching engine
arms does not destroy unconditionally, it destroys only if
`socket.bytesWritten <= 0` when it fires a second later. On loopback the
matching engine writes its 101 response in microseconds, so the check always
finds bytes and does nothing. The option earns its place only when the
handshake response is delayed past a *full second* — a blocked event loop, a
very slow link — which is precisely the "rarely, under load, on the slowest
phone at the table" shape, and precisely what a localhost test cannot
manufacture.

So the line stays, justified by the source rather than by a test, and the
stress file was deleted rather than kept: a test that cannot detect the thing
it is aimed at is theatre, and `compose.test.ts` already exercises concurrent
upgrades for the ordinary case.

**What the suite *can* demonstrate, verified by breaking the code:**

- Removing `closeSockets`'s scoping (using `io.close()` instead) fails exactly
  one test — `twoGames.test.ts`'s "closing one game leaves the other serving
  and connected" — and no others.
- Unscoping Rail Baron's SPA fallback (`app.use(handler)` rather than
  `app.use(BASE_PATH, handler)`) fails **six** tests in `routes.test.ts`,
  including the menu ones: Rail Baron's `index.html` swallows `/` and every
  unclaimed path.

**Two test-design errors worth recording, both caught by running it:**

- The first draft hardcoded socket event names and used `'event'` where Marco
  Polo's protocol says `'gameEvent'`. It failed loudly only because the round
  never started. Every event name and protocol version is now imported from
  the game's own module.
- The first draft asserted a Marco Polo snapshot count taken the instant Rail
  Baron's and Acquire's turns finished, and got 0 — correctly. Both turns
  completed in under 60 ms, barely one tick at 20 Hz, so that count measured
  how fast they were rather than whether the loop survived them. It now waits
  for three further snapshots *after* the other games act.

**Acquire cannot drain in-flight saves on shutdown; Rail Baron can.**
`createRooms` in Rail Baron exposes `settled()` and its `close()` awaits it;
Acquire's `createRoomRegistry` has no equivalent, so `MountedGame.close()`
returns while a write may still be in flight. Found by a test cleanup racing a
late write into `ENOTEMPTY`. The consequence is bounded — the store writes to
a temp file and renames, so an interrupted write leaves the previous record
intact and the cost is the last move, not corruption — and it is pre-existing
rather than something composition created. But composition sharpens it: every
deploy now restarts all three games, so shutdown happens more often. Left
undone deliberately, and it belongs with the deferred shared `packages/room-store`,
which would give Acquire `settled()` and Rail Baron `quarantine()` in one move.

**Every game gained an `exports` map.** `apps/host` imports games by name, and
a deep import of a `.ts` file through a package with no `exports` field does
not resolve. All three now carry the lobby's `"./*.js" → "./*.ts"` pair.

**`closeSockets` lives in `packages/host`** rather than being written out
three times — the plan implied three copies of a subtle rule, which is how the
third copy gets it wrong.

**`apps/host` needed `testTimeout: 20000`.** A test that boots three games and
seats seven players across three lobbies is slow by construction, and vitest's
5 s default is a unit-test budget.

## Deliberately not in this plan

- **Anything the cutover touches** — Render, `DATA_DIR` on the instance, the `mv /var/data/games /var/data/acquire`, the `/acquire` rename and its redirect, retiring Pages, the Caddyfile collapse, the single launchd agent, archiving the four source repos. Spec steps 9–11.
- **Compiling `apps/host`.** Three servers plus two shared packages transpiled by `tsx` at every cold start, now in one process, on every Render restart. The spec says measure first, and measuring is easier once there is one process to measure. Rail Baron's NodeNext split — still deferred from Phase 0 — is what makes compiling possible at all.
- **A shared `packages/room-store`.** Rail Baron's and Acquire's stores are one design implemented twice, and unifying them would hand Rail Baron `quarantine()` for free. Not on the critical path for one process, and a store rewrite underneath a composition change is two risks in one diff.
- **A shared remembered name.** `createIdentityStore` keys `${appId}.name`, so a player types theirs once per game; one origin makes a single `lobby.name` possible. That becomes true after *cutover*, not after composition — the three games are not yet on one origin for real players.
- **Tightening CORS.** Task 3 stops `origin: '*'` leaking across games; narrowing it needs the one public origin the cutover creates.
- **A linter/formatter.** Still none in any package, still the reason quote style differs between them, still a whole-repo reformat that would make this diff unreviewable. It has now been deferred twice; land it as its own commit between this plan and the cutover.
- **Runtime dependency alignment** — express `^5.2.1` vs `^5.1.0`, socket.io `^4.8.3` vs `^4.8.1`, cors `^2.8.6` vs `^2.8.5`, tsx `^4.23.12` vs `^4.20.6`, `@testing-library/jest-dom` 7 vs 6. npm hoists one copy of each anyway, so the composed process already runs a single version; the ranges are cosmetic until something depends on the difference. Worth one commit, not worth entangling with this one.
- **The `RoomPlayer` alias** in Acquire (`export type RoomPlayer = SeatHolder`). Delete when touching that file for another reason. This plan does not touch that file.

## Done when

- [x] `npm run start:host` with `DATA_DIR` set serves all three games and a generated menu from one process on one port.
- [x] Every game has a `mount(ctx)`, and every game's original boot function still exists with its original signature.
- [x] **No existing test file was modified.** 1548 tests still pass; the additions are new files.
- [x] The composition suite proves: three simultaneous socket connections over websockets, a Marco Polo round ticking beside an Acquire commit, route isolation with distinguishable markers, a contained throw, and saves across a restart from host-allocated directories.
- [x] `destroyUpgrade: false` and `serveClient: false` on all three socket servers, each with the comment explaining what deleting it would cost.
- [x] **No game calls `io.close()`.** `grep -rn 'io\.close()' games/ apps/` finds it only where a wrapper owns the server it is closing. Exactly one thing closes the shared `httpServer`, and it is whoever created it.
- [x] Composition was exercised at every step, not only at the end: one game into a borrowed app (Task 2), two games sharing one server (Task 3), three games and a menu (Task 6).
- [x] Bare `/health` aggregates three games; each prefixed twin still answers for itself.
- [x] `DATA_DIR` is required, allocated per game, and absent for Marco Polo.
- [x] `PORTS.md` claims 4000 for the host and still lists 4001–4003 as real.
- [x] `Caddyfile`, `menu/`, `launchd/`, `saves/` and the `start-*.sh` scripts are untouched; all three launchd services would still start.
- [x] Acquire's build still emits `/acquire-startups-m1/`; `gh-pages`, `.env.production` and the deploy script are still present.
- [x] Nothing is deployed differently. `apps/host` runs only when someone runs it.
