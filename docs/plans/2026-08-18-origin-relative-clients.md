# Origin-Relative Clients Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Retire the last addressing knowledge from every game client — sockets ride the page's origin under each game's base path, so port 80 (Caddy) can be the only exposure, per `specs/2026-08-17-origin-relative-clients.md`.

**Architecture:** One keystone change in the shared lobby (`socketPath` option through `createLobbyConnection`), then symmetric adoption in each game (client passes `${BASE_URL}socket.io`, server mounts socket.io at `${BASE_PATH}/socket.io`, Vite proxies the socket path in dev), then this repo retires the Caddyfile's root `/socket.io` stopgap and updates docs. Render is handled by an env override: the deployed server sets `SOCKET_PATH=/socket.io` so the Pages client (which sets `VITE_SERVER_URL` and therefore keeps socket.io's default path) is never broken — zero deploy skew.

**Tech Stack:** socket.io / socket.io-client, Express, Vite, vitest, git submodules, Caddy.

---

## Facts established by audit (2026-08-18)

- Lobby `origin/main` tip is `f1708d4`; pins: Rail Baron `f1708d4` (current), Acquire `fe49247`, Marco Polo `c9f5536` — all ancestors of `origin/main`, nothing unpushed. All three games consume the lobby as the `vendor/lobby` submodule; **the lobby's tests execute inside each consumer's vitest run** (no standalone toolchain in the lobby repo).
- There is **no local clone** of `multiplayer-game-lobby` — Task 1 creates one.
- `createLobbyConnection` always sets `transports: ['websocket']` (`vendor/lobby/client/connection.ts:57-58`), so proxies only ever see the WS upgrade at the socket path — no long-poll fallback to route.
- Marco Polo is already origin-relative (`client/src/net/singletons.ts:16`) but on the **default** socket path; the Caddyfile's root `/socket.io` block exists only for it.
- Rail Baron has **no** `.env*` and nothing sets `VITE_SERVER_URL` — its Render mention (`server/index.ts:38-40`) is historic. Acquire's Render service is live (`.env.production`: `https://acquire-multiplayer.onrender.com`) with the Pages client passing `VITE_SERVER_URL`.
- Vite guarantees `import.meta.env.BASE_URL` ends with `/` (`'/railbaron/'`, `'/marcopolo/'`, and `'/'` in Acquire dev), so `${BASE_URL}socket.io` is always well-formed.
- Rail Baron's `staticClient.test.ts:73` currently pins "keeps /health at the root regardless" — it gains a prefixed twin, not a move.

## Design decisions (resolving the spec's open edges)

1. **Render via `SOCKET_PATH` env override, not dual mounts.** socket.io mounts at one path per `Server` instance, so the spec's "Render keeps the bare paths — mount both" is satisfied by: server default = `${BASE_PATH}/socket.io` (standalone `npm run serve` must work with game-host absent), and Render sets `SOCKET_PATH=/socket.io`. Client rule: `VITE_SERVER_URL` set ⇒ `socketPath` undefined (socket.io default). Old cached Pages clients and new ones therefore both work against Render at all times — no lockstep deploy.
2. **Health mounts both paths everywhere** (bare + `${BASE_PATH}/health`) — two `app.get`s sharing one handler; Render's health check (if configured, it's `/health`) is untouched.
3. **Rail Baron's `VITE_SERVER_PORT` client knob is deleted** along with `DEFAULT_SERVER_PORT` — the Vite proxy replaces the "move the dev port" use case. The server keeps reading `process.env.VITE_SERVER_PORT` for its own port (that's server env, not client code).
4. **Marco Polo hardcodes its path** (`/marcopolo` hoisted to one const in `server/app.ts`) — it has no Render, so no `SOCKET_PATH` knob (YAGNI).

## Sequencing

Phase 1 (lobby) is backwards-compatible and lands alone. Phases 2–4 are one game each; every intermediate state is shippable because each game's client+server rebuild together (the start scripts build on service restart) and Caddy's existing `handle /<game>/*` blocks already cover the new socket paths. Phase 5 (this repo: Caddyfile stopgap removal + docs) lands with Marco Polo's service restart. Phase 6 is docs in the game repos.

---

## Phase 1 — the lobby keystone

### Task 1: Clone the lobby repo and branch

**Step 1:**
```bash
git clone https://github.com/petroleumjelliffe/multiplayer-game-lobby.git ~/Developer/multiplayer-game-lobby
cd ~/Developer/multiplayer-game-lobby
git checkout -b feat/socket-path
```

### Task 2: Failing wire test (in Acquire, where the wire rig lives)

**Files:**
- Modify: `~/Developer/acquire-startups-m1/server/clientOverWire.test.ts` (append a describe block)
- Reference rig: `~/Developer/acquire-startups-m1/server/socketHarness.ts` (`startTestServer`, `settleSocket`)

**Step 1: Point Acquire's submodule at the local lobby branch** (so the test compiles against the new option once written):
```bash
cd ~/Developer/acquire-startups-m1/vendor/lobby
git fetch ~/Developer/multiplayer-game-lobby feat/socket-path && git checkout FETCH_HEAD
```
(First run: branch == main, so the option doesn't exist yet — expected.)

**Step 2: Write the failing test.** Read `clientOverWire.test.ts` first and copy its server/client setup idiom exactly. The new case must:
- start an http server with socket.io mounted at `path: '/acquire-startups-m1/socket.io'` on port 0,
- connect via `createLobbyConnection({ serverUrl, protocolVersion, socketPath: '/acquire-startups-m1/socket.io' })`,
- prove a `createRoom` → `onJoined` roundtrip completes,
- and a second case: a connection **without** `socketPath` against the same server never opens (assert status stays `connecting`/`closed` after a short settle — proves the mount actually moved, not that both paths work).

**Step 3: Run it, expect compile failure** (`socketPath` not in `LobbyConnectionOptions`):
```bash
cd ~/Developer/acquire-startups-m1 && npx vitest run server/clientOverWire.test.ts
```

### Task 3: Implement `socketPath` in the lobby

**Files:**
- Modify: `~/Developer/multiplayer-game-lobby/client/connection.ts:15-18` and `:57`

**Step 1:** Extend the options interface:
```ts
export interface LobbyConnectionOptions {
  serverUrl: string;
  protocolVersion: number;
  /** socket.io mount path, e.g. '/railbaron/socket.io', for a client served
   *  behind a path proxy. Absent means socket.io's own '/socket.io' —
   *  today's behaviour, and right for a server that owns its whole origin. */
  socketPath?: string;
}
```

**Step 2:** Thread it through the `io()` call (undefined ⇒ socket.io's default, so no `??` needed):
```ts
const socket: Socket = io(opts.serverUrl, {
  path: opts.socketPath,
  transports: ['websocket'],
  ...
```

**Step 3:** Add the consumer-checklist entry (PR #3 added the checklist — `grep -rin checklist` the lobby clone to find it; if it's only in the PR description, add the entry to the root `README.md`): *"Behind a path proxy? Pass `socketPath: '<base>/socket.io'` and mount the server's `SocketServer` at the same path."*

**Step 4: Re-fetch into Acquire's submodule and run the wire test — expect PASS:**
```bash
cd ~/Developer/multiplayer-game-lobby && git add -A && git commit -m "feat: socketPath option through createLobbyConnection"
cd ~/Developer/acquire-startups-m1/vendor/lobby && git fetch ~/Developer/multiplayer-game-lobby feat/socket-path && git checkout FETCH_HEAD
cd ~/Developer/acquire-startups-m1 && npx vitest run server/clientOverWire.test.ts
```

**Step 5: Push, PR, merge** (repeat the lobby repo's PR habit):
```bash
cd ~/Developer/multiplayer-game-lobby
git push -u origin feat/socket-path
gh pr create --title "socketPath option through createLobbyConnection" --body "..." && gh pr merge --merge
```
Record the merge commit SHA — call it `<LOBBY_PIN>`; every game pins to it below.

---

## Phase 2 — Acquire (first adopter: it has Render, the hardest edge)

### Task 4: Render pre-work (manual, BEFORE any Acquire deploy)

On the Render dashboard for `acquire-multiplayer`:
1. Add env var `SOCKET_PATH=/socket.io`.
2. Confirm the health check path (if set) is `/health` — leave it.

This is a no-op against the current code and makes the coming server change invisible to Render.

### Task 5: Acquire server — prefixed socket mount + health twin

**Files:**
- Modify: `~/Developer/acquire-startups-m1/server/index.ts:62-64` (health), `:86` (socket)
- Test: extend whichever server test already asserts `/health` (grep `'/health'` under `server/*.test.ts`); harness `server/socketHarness.ts` gains the path.

**Step 1: Failing tests.** (a) `GET ${BASE_PATH}/health` returns the same body as `/health`. (b) Update `socketHarness.ts`'s server construction and client `io(...)` calls to use `path: `${BASE_PATH}/socket.io`` — run the socket suite, expect failures until the server change lands.

**Step 2: Implement.** Health — hoist the handler:
```ts
const health = (_req: Request, res: Response): void => {
  res.json({ ok: true, protocolVersion: PROTOCOL_VERSION, saveVersion: SAVE_VERSION });
};
app.get('/health', health);
app.get(`${BASE_PATH}/health`, health);
```
Socket (`server/index.ts:86`):
```ts
// Mounted under the base path so sockets ride the same front-door route as
// pages and assets. Render overrides with SOCKET_PATH=/socket.io: its Pages
// client keeps socket.io's default path (see src/net/connection.ts).
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
  path: process.env.SOCKET_PATH ?? `${BASE_PATH}/socket.io`,
});
```

**Step 3:** `npx vitest run --project node` (or the repo's server-test invocation — check package.json) — expect PASS.

**Step 4: Commit** `feat(server): mount sockets under the base path, health twin`.

### Task 6: Acquire client — origin + socketPath

**Files:**
- Modify: `~/Developer/acquire-startups-m1/src/net/connection.ts:25-34, :49`

**Step 1: Implement** (replaces `DEV_SERVER_PORT` and the hostname derivation — delete both, and the big comment block about phones resolving localhost, which the origin approach obsoletes; the `window`-at-module-scope caveat comment at `:26-32` stays true and stays):
```ts
// A deployed build sets VITE_SERVER_URL (Pages → Render) and that wins, with
// socket.io's default path — that server owns its whole origin. Otherwise the
// page's own origin: in dev Vite proxies the socket path to the game server,
// hosted the game server IS the origin's answerer. No host or port appears
// here — see game-host specs/2026-08-17-origin-relative-clients.md.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const SOCKET_PATH = import.meta.env.VITE_SERVER_URL
  ? undefined
  : `${import.meta.env.BASE_URL}socket.io`;
```
and at the call site:
```ts
const lobby = createLobbyConnection({ serverUrl: SERVER_URL, protocolVersion: PROTOCOL_VERSION, socketPath: SOCKET_PATH });
```

**Step 2: Dev proxy** — `vite.config.ts:124` (dev base is `'/'`, so the dev socket path is `/socket.io`):
```ts
server: {
  port: 7932, strictPort: true, allowedHosts: ['.local'],
  // Dev plays the part Caddy plays in hosting: the client is origin-relative
  // and this proxy carries its socket path to the game server. 4002 per
  // game-host PORTS.md — build tooling, not shipped code.
  proxy: { '/socket.io': { target: 'http://localhost:4002', ws: true } },
},
```

**Step 3: Verify by hand** — `npm run dev:all` (or `tsx watch server/index.ts` + `npm run dev`), create/join a room at `http://localhost:7932`; then `npm run serve` and the same at `http://localhost:4002/acquire-startups-m1/`. Run the full suite: `npx vitest run`.

**Step 4: Pin the submodule to `<LOBBY_PIN>`** (`cd vendor/lobby && git fetch origin && git checkout <LOBBY_PIN>`), commit all of it: `feat(net): origin-relative sockets under the base path`.

**Step 5: Deploy check (Render/Pages).** Push to main; after Render deploys and Pages rebuilds, open the Pages URL and confirm a room forms. Old client + new server were already proven compatible by Task 4's env var.

---

## Phase 3 — Rail Baron (same shape, plus knob deletion)

### Task 7: Rail Baron server — prefixed socket mount + health twin

**Files:**
- Modify: `~/Developer/railbaron/server/index.ts:41-47` (health), `:70` (socket)
- Test: `server/staticClient.test.ts:73` (health twin), socket suites `gameSocket/goldenSocket/recovery` — update their client `io(...)` calls (grep `io(` under `server/`) to pass `path: `${BASE_PATH}/socket.io``.

Same steps as Task 5: failing tests first (the health-twin assertion and the re-pathed socket clients), then:
```ts
const io = new SocketServer(http, {
  cors: { origin: '*' },
  path: process.env.SOCKET_PATH ?? `${BASE_PATH}/socket.io`,
});
```
and the shared health handler mounted at `/health` and `` `${BASE_PATH}/health` `` (update the `staticClient.test.ts:73` case name — root health *stays*, prefixed twin is added). Run `npx vitest run`, commit `feat(server): sockets under /railbaron, health twin`.

### Task 8: Rail Baron client — origin + socketPath, delete the port knobs

**Files:**
- Modify: `~/Developer/railbaron/src/config.ts` (whole file), `src/net/connection.ts:32-35`, `vite.config.ts:47-63`
- Check: `src/OnlineApp.tsx:68,79` (comment + `SERVER_URL` in copy — copy keeps working; fix the stale-port comment while there)

**Step 1:** `src/config.ts` becomes:
```ts
/**
 * The server this client speaks to.
 *
 * `VITE_SERVER_URL` (a deployed build) wins outright, and sockets keep
 * socket.io's default path — that server owns its whole origin. Otherwise
 * everything is relative to the page's origin: Vite's proxy (dev) or the
 * game server itself (hosted, `npm run serve`) answers under BASE_PATH. No
 * host or port lives in client code — the port registry (game-host
 * PORTS.md) is the machine's business now.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? window.location.origin;

/** socket.io mount path; undefined lets a VITE_SERVER_URL server default. */
export const SOCKET_PATH: string | undefined =
  import.meta.env.VITE_SERVER_URL ? undefined : `${import.meta.env.BASE_URL}socket.io`;
```
`DEFAULT_SERVER_PORT` and the `VITE_SERVER_PORT` branch are deleted. Server keeps its own `VITE_SERVER_PORT` env reading (`server/index.ts:161` — server env, untouched).

**Step 2:** `src/net/connection.ts:32-35` passes `socketPath: SOCKET_PATH`.

**Step 3:** Vite proxy (base is `BASE_PATH` even in dev):
```ts
proxy: { '/railbaron/socket.io': { target: 'http://localhost:4001', ws: true } },
```

**Step 4:** By-hand: `npm run dev:all` room at `:7931/railbaron/`; `npm run serve` room at `:4001/railbaron/`. Full suite. Pin submodule to `<LOBBY_PIN>`. Commit `feat(net): origin-relative sockets, retire the client port knobs`.

---

## Phase 4 — Marco Polo (path move + first health route)

### Task 9: Marco Polo server — prefixed mount + health

**Files:**
- Modify: `~/Developer/marco-polo/server/app.ts:20-28`
- Test: `server/wire.test.ts` (clients gain the path), new health assertions

**Step 1:** Failing tests: wire test clients pass `path: '/marcopolo/socket.io'`; new case asserts `GET /health` and `GET /marcopolo/health` return `{ ok: true, protocolVersion: PROTOCOL_VERSION }`.

**Step 2:** In `app.ts`, hoist the one path constant and use it everywhere it already appears:
```ts
const BASE_PATH = '/marcopolo';
...
const health = (_req: express.Request, res: express.Response): void => {
  res.json({ ok: true, protocolVersion: PROTOCOL_VERSION });
};
app.get('/health', health);
app.get(`${BASE_PATH}/health`, health);
app.use(BASE_PATH, express.static(dist));
app.use(express.static(dist));
const httpServer = createServer(app);
// Same base-path mount as pages and assets, so one front-door route carries
// the whole game; retires the root /socket.io claim in game-host's Caddyfile.
const io = new SocketServer(httpServer, { path: `${BASE_PATH}/socket.io` });
```

**Step 3:** `npx vitest run` — PASS. Commit `feat(server): sockets under /marcopolo, health route`.

### Task 10: Marco Polo client + dev proxy

**Files:**
- Modify: `~/Developer/marco-polo/client/src/net/singletons.ts:15-18`, `vite.config.ts:31`

**Step 1:**
```ts
conn ??= createLobbyConnection({
  serverUrl: window.location.origin,
  protocolVersion: PROTOCOL_VERSION,
  socketPath: `${import.meta.env.BASE_URL}socket.io`,  // '/marcopolo/socket.io'
});
```

**Step 2:** Proxy key moves with it:
```ts
proxy: { '/marcopolo/socket.io': { target: `http://localhost:${serverPort}`, ws: true } },
```

**Step 3:** By-hand: `npm run dev:all` at `:7933/marcopolo/`; `npm run build && npm start` at `:4003/marcopolo/`. Pin submodule to `<LOBBY_PIN>`. Commit `feat(net): socket path under /marcopolo`.

---

## Phase 5 — this repo (game-host)

### Task 11: Caddyfile — retire the stopgap, fix the story

**Files:** `Caddyfile`

- Delete the `handle /socket.io/*` block (`Caddyfile:62-64`) and the Marco Polo comment above it.
- Rewrite the header paragraph "Sockets deliberately do NOT go through this proxy…" to its successor: *sockets now ride each game's own `handle /<game>/*` route — every game mounts socket.io under its base path (specs/2026-08-17-origin-relative-clients.md, implemented), so port 80 is the only required exposure.*
- Apply in lockstep with Marco Polo's restart (old MP client bundles use the root path until rebuilt):
```bash
launchctl kickstart -k gui/$(id -u)/com.game-host.marcopolo
brew services restart caddy   # or: caddy reload --config /opt/homebrew/etc/Caddyfile
```
Then restart the other two services so their rebuilt clients pick up the change:
```bash
launchctl kickstart -k gui/$(id -u)/com.game-host.railbaron
launchctl kickstart -k gui/$(id -u)/com.game-host.acquire
```

### Task 12: PORTS.md — ports become machine-only knowledge

- Replace the Marco Polo `/socket.io` note (it already names its own retirement condition) with: each game's sockets ride `/<game>/socket.io` through the front door; ports are machine-only knowledge now — no client names one.
- Update the known-consumers list: Rail Baron's `DEFAULT_SERVER_PORT` and Acquire's `DEV_SERVER_PORT` are gone; the client-adjacent appearance of each port is now its game's `vite.config.ts` proxy target (build tooling). Server boot defaults unchanged.

### Task 13: Spec status + game-host README

- `specs/2026-08-17-origin-relative-clients.md`: Status → `implemented 2026-08-18`. Append a short "as-built" note: Render resolved via `SOCKET_PATH` env override rather than dual mounts (one socket.io mount per server; client keeps the default path whenever `VITE_SERVER_URL` is set), and prefixed health twins landed everywhere including Marco Polo's first health route.
- `README.md`: wherever it describes socket routing/ports (grep `socket`, `4001`, `port`), align with the above; add the health URLs (`/<game>/health` through the front door) as the smoke check.
- Commit: `origin-relative clients: Caddyfile stopgap retired, registry + spec updated`.

### Task 14: Verification (the spec's own four checks)

1. Per game, `npm run dev` + game server: create/join/begin through the Vite origin.
2. Behind Caddy with direct ports proven irrelevant — stop a game's service, confirm the page 502s through Caddy (proxy is the only path), restart, then the sharper test: from another device (or `curl --interface`… simplest is a phone on the wifi), load `http://<host>/railbaron/`, play a turn, and confirm with `lsof -iTCP:4001 -sTCP:ESTABLISHED` that the only established peer is Caddy (localhost), not the phone.
3. Acquire production shape: Pages client → Render still connects (done in Task 6 Step 5).
4. Lobby wire proof with `socketPath` set: Task 2's test, running in Acquire's suite from now on.
5. Health: `curl http://localhost/{railbaron,acquire-startups-m1,marcopolo}/health` through Caddy — three JSON bodies.

---

## Phase 6 — docs in the game repos

### Task 15: Per-game CLAUDE.md / README updates

- **Rail Baron** (`CLAUDE.md`, `README.md`): grep for `4001`, `VITE_SERVER_PORT`, `hostname` — replace the hostname-derivation story with the origin-relative one; note the dev proxy and that `VITE_SERVER_PORT` is now server-only. Also fix the stale `3001` comments (`src/OnlineApp.tsx:68`, `server/index.ts:142` area) while touching those files' repos.
- **Acquire** (`CLAUDE.md:173,285-286` area, `README.md`): same rewrite; document `SOCKET_PATH` on Render.
- **Marco Polo** (`README.md:15,18`): fix the stale ports — dev is `:7933/marcopolo/`, hosted is `npm run build && npm start` on `4003`; document the new `/marcopolo/health`.
- One commit per repo: `docs: origin-relative sockets`.
