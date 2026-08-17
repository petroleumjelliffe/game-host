# Origin-relative clients: no ports in game code

**Status:** design, not yet implemented.
**Home:** this repo, because the goal is a hosting property — every game
behind the front door with zero addressing knowledge — even though the
enforcing code change lands in the shared lobby. Written 2026-08-17, after
the Rail Baron LAN-hosting work (`railbaron/docs/superpowers/specs/
2026-08-16-lan-hosting-design.md`) chose direct-port sockets as a deliberate
deviation. This spec is the plan for retiring that deviation.

## The property being bought

A game client that never names a host or port: it addresses everything —
pages, assets, sockets — as **paths relative to the origin it was served
from**. Such a client works identically behind Caddy on 80, served directly
from its game server's port, under TLS, or from an embedded server in a
future host app, with no configuration and no environment variables. Ports
remain real, but they become purely the machine's business (this repo's
PORTS.md, start scripts, Caddyfile) and stop being any client's business.

What this makes easier locally, concretely:

- One share link shape forever (`/<game>/…`), no port leaking into URLs or
  QR codes, no "which port is this game again" at game night.
- The client bundle is deployment-agnostic: the same build works on GitHub
  Pages (where a `VITE_SERVER_URL` override still applies), behind Caddy,
  and standalone.
- TLS later is a Caddyfile change, not a game change — `wss://` follows the
  page origin for free.

## Current state (what the deviation looks like)

- The shared lobby's `createLobbyConnection` calls `io(serverUrl)` with no
  socket.io `path` option. A path-suffixed URL (`http://host/railbaron`)
  would be parsed as a socket.io **namespace**, not a path — so path-routed
  sockets are impossible without a lobby change.
- Rail Baron's `src/config.ts` therefore derives
  `http://<page hostname>:4001` and the socket bypasses Caddy entirely.
  Fine on a LAN (the port is reachable); wrong the moment port 80 should be
  the only exposure, TLS appears, or a proxy is the only path in.
- Acquire: same lobby, same pattern, its own port.

## The design

Three layers, smallest first. The lobby change is the keystone; everything
else is consumption.

### 1. Shared lobby (`multiplayer-game-lobby`) — the enforcing change

`LobbyConnectionOptions` gains an optional socket path:

```ts
export interface LobbyConnectionOptions {
  serverUrl: string;          // now typically just the origin
  protocolVersion: number;
  /** socket.io mount path, e.g. '/railbaron/socket.io'. Defaults to
   *  socket.io's own '/socket.io' — absent means today's behaviour. */
  socketPath?: string;
}
```

passed through as `io(opts.serverUrl, { path: opts.socketPath ?? '/socket.io', … })`.

Backwards-compatible: consumers that don't pass it are unchanged. One
option, one line of plumbing, plus the consumer-checklist note (the lobby
repo's PR #3 pattern): *a consumer behind a path proxy sets `socketPath`
and serves its socket under its prefix*.

The lobby **server** needs the mirror knob: socket.io's server must mount at
the same path. `createLobbyHandlers` doesn't own server construction — the
game's boot does (`new SocketServer(http, …)`) — so this is per-game server
config, not a lobby change: `new SocketServer(http, { path: '/<game>/socket.io' })`.

### 2. Each game — client and server, symmetric

Per game (Rail Baron shown; Acquire identical with its own names):

- **Client** (`src/config.ts` or equivalent): when no `VITE_SERVER_URL`
  override is set, the server URL becomes `window.location.origin` and
  `socketPath` becomes `` `${BASE_PATH}/socket.io` ``. The port constant and
  hostname-derivation logic are deleted from client code. The production
  override (`VITE_SERVER_URL`, GitHub Pages → Render) keeps working: an
  absolute URL wins, and `socketPath` stays default for a server that owns
  its whole origin.
- **Server boot**: socket.io mounted at `` `${BASE_PATH}/socket.io` ``; the
  `/health` route gains a prefixed twin (`/<game>/health`) so the proxy can
  reach it without a special case. (Render keeps the bare paths — mount
  both.)
- **Dev flow**: Vite's `server.proxy` forwards `` `${BASE_PATH}/socket.io``
  → `localhost:<server port>` with `ws: true`. This is the piece that makes
  dev and hosted **identical from the client's point of view** — the dev
  client is already origin-relative because Vite plays the part Caddy plays
  in hosting. The port number's last client-adjacent appearance is this
  Vite config line, which is build tooling, not shipped code.

### 3. This repo — Caddyfile

Each game's block grows one `handle` for its socket mount, ordered before
the page handle (longest match wins anyway, but explicit beats implicit):

```text
handle /railbaron/socket.io/* { reverse_proxy localhost:4001 }
handle /railbaron/*           { reverse_proxy localhost:7931 }  # or 4001, hosted
```

Once a game also serves its own built client (the companion change, below),
both lines point at the same port and can collapse to one.

## Relationship to serve-own-client

Independent changes, complementary end state. Serve-own-client (each game
server serving its `dist/` under its base path — Rail Baron's is specced in
its LAN-hosting doc) collapses each game to one process and one port.
*This* spec makes the client indifferent to how it's fronted. Together:
one process per game, addressed only by path, behind one front door.

Sequencing recommendation, unchanged from the conversation that produced
this spec: **serve-own-client first** (no lobby dependency, immediate
payoff), this spec's change **bundled with the next lobby touch** — it
wants a lobby PR, a submodule bump in every consumer, and the consumer
checklist updated, which is cheapest done alongside other lobby work. Note
the lobby submodule push is itself still owed from the online-mode work.

## Change inventory

| Where | Change | Nature |
| --- | --- | --- |
| lobby repo | `socketPath` option through `createLobbyConnection` | code, PR + version bump |
| lobby repo | consumer checklist entry | docs |
| each game, client | origin + `socketPath` instead of hostname:port derivation | code (delete-heavy) |
| each game, server | socket.io mounted at `BASE_PATH/socket.io`; prefixed `/health` twin | code, small |
| each game, dev | Vite `server.proxy` for the socket path, `ws: true` | build config |
| each game | submodule bump to the lobby version with `socketPath` | chore |
| this repo | socket `handle` per game in the Caddyfile | infra, one line each |
| this repo | PORTS.md note: ports are machine-only knowledge once a game adopts this | docs |

## Verification

Per game, after adoption:

1. `npm run dev` alone: client at its Vite port, sockets proxied by Vite —
   create/join/begin works with the game server up (`dev:all`).
2. Behind Caddy: page and sockets both through port 80; **verify with the
   game server's port firewalled or stopped-and-restarted** — the point of
   the change is that direct port reachability no longer matters, so the
   test must prove the port isn't being reached.
3. Production shape: built client with `VITE_SERVER_URL` set still connects
   to a bare-origin server (Render) — the override path must not regress.
4. The lobby's own wire tests (`clientOverWire`-style) run once with
   `socketPath` set, so the option is proven against a real server, not
   assumed from socket.io's docs.
