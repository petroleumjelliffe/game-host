# LAN hosting: one machine, several games, a stable share link

**Status:** Tier 2 implemented for Rail Baron 2026-08-17, with two deviations from the
design below, both deliberate:

- **The registry moved to 4001+/7931+** (the user's scheme, one slot pair per game:
  server 400N, dev client 7930+N) and is canonical in the sibling **`game-host` repo's
  `PORTS.md`**, beside the Caddyfile and menu page that consume it — extracted from
  this repo's short-lived `hosting/` directory 2026-08-17 so that no one game owns the
  machine's config; each game hardcodes its own slots and points its docs there. The
  4101 numbers below are the superseded draft.
- **Sockets bypass the proxy.** The lobby's `io(serverUrl)` would read a path-suffixed
  URL as a socket.io *namespace*, so routing sockets through Caddy needs the `path`
  option plumbed through the shared lobby. Instead the client keeps deriving
  `<page hostname>:4001` and speaks to the server port directly — fine on a LAN, and
  zero submodule changes. Revisit only if the ports ever stop being reachable.

**The shared prerequisite (serve-own-client) landed 2026-08-17**: `startServer` serves
`dist/` under the base path with an SPA fallback (tested in
`server/staticClient.test.ts`), `npm run serve` is the one-command hosted mode, the
game-host repo's start script uses it, and its Caddyfile points `/railbaron/*` at 4001.
The share-link fix (`/net-info` or host-browses-the-network-URL) remains open, as does
the origin-relative socket change — specced separately in the game-host repo's
`specs/2026-08-17-origin-relative-clients.md`.

Also discovered at implementation: the Tier 2 base-path risk was already paid —
`basePath.ts` has built the client under `/railbaron` for GitHub Pages all along, in
dev too, so Caddy proxies without stripping the prefix and no game code changed for it.
Vite needed `allowedHosts: ['.local']` (its DNS-rebind guard refuses unknown Host
headers) plus `host: true` and a `strictPort` pin.

**Scope:** hosting Rail Baron, Acquire, and future titles (e.g. Marco Polo) as online-mode
servers on one always-the-same host machine, joined by friends' devices over the same
wifi. Three tiers, each a superset of the one before. Nothing here touches game rules,
the wire protocol, or pass-and-play.

The bootstrap problem this solves: a client needs one working address before anything
else can happen. The tiers differ in how stable and how pretty that address is, and in
where the required change lands — in each game (code), in the host machine (infra), or
in a shared always-on process (global).

## Shared prerequisite: one process, one port per game

All three tiers assume each game is **a single server process that serves both its
built client and its sockets on one port**. Today each game is two ports in dev (Vite
5173 + game server 3001), and the share link is the Vite one. Collapse it:

- **Change (code, per game):** the game server gains static-file serving of its own
  `dist/` — a few lines in `server/index.ts` (Rail Baron) and the equivalent in each
  sibling. Express/`sirv`/hand-rolled all fine; must fall back to `index.html` for
  client-side routes (`/room/<code>`).
- **Change (process, per game):** hosting a game means `npm run build && <start server>`,
  not `dev:all`. The hosted artifact is the production bundle. Hot-reload dev flow is
  unaffected and remains two ports on localhost.
- **Rail Baron specifics:** the client's server-URL derivation
  ([`src/config.ts`](../../../src/config.ts)) already derives hostname from
  `window.location`; once client and server share an origin, derivation should prefer
  `window.location.origin` outright when no `VITE_SERVER_URL` is set — same-origin
  sockets, no port arithmetic. Keep `VITE_SERVER_PORT` for the two-port dev flow.
- **Share link (code, Rail Baron):** `OnlineApp.tsx`'s share action copies
  `window.location.href`, which is correct *only* when the host browses the shareable
  address themselves. Either adopt that as the house rule (host opens the network URL,
  not localhost) or add `GET /net-info` returning the server's view of its best
  address(es) (`os.networkInterfaces()` + the machine's `.local` name) and have the
  share action prefer it when `location.hostname` is `localhost`.

### The port registry

Claim a contiguous private block outside the crowded 3000s and outside the ephemeral
range (49152–65535, which the OS assigns randomly). Registry — a convention shared
across repos, recorded here and in each sibling's README:

| Port | Game |
| --- | --- |
| 4101 | Rail Baron |
| 4102 | Acquire |
| 4103 | Marco Polo |
| 4104+ | future titles |

Backend ports are configuration in every game already (`PORT` / `VITE_SERVER_PORT`
here; Acquire equivalent). No code change — an `.env` line per game.

---

## Tier 1: port only

Share links look like `http://petes-macbook.local:4101` (Rail Baron).

| What | Nature | Where |
| --- | --- | --- |
| Serve client from game server (prereq above) | code | each game |
| Bind assigned registry port | config | each game |
| Nothing else | — | — |

- **Machine-global changes: none.** mDNS (`petes-macbook.local`) is already maintained
  by macOS and tracks IP changes automatically. No always-on process beyond the game
  servers themselves.
- **First-run only:** macOS firewall prompt to allow Node incoming connections.
- **Known limitation:** older Android browsers may not resolve `.local`; fallback is
  the raw IP (which `/net-info` can also report). Guest networks with client isolation
  block everything in every tier — nothing to do about that but use a different wifi.
- **Verdict:** works tonight; ugly ports in the URL; each game's link independent of
  the others.

## Tier 2: reverse proxy, path routing

Share links look like `http://petes-macbook.local/railbaron`.

| What | Nature | Where |
| --- | --- | --- |
| Everything in Tier 1 | — | each game |
| Client built with base path (`base: '/railbaron/'` in Vite config) | code (one line, but see risk) | each game |
| Socket path under the prefix (client connects to `/railbaron/socket.io/...` or equivalent) | code | each game |
| Caddy installed, one Caddyfile, running as a service | infra | machine (global) |
| Caddy allowed to bind port 80 | infra, one-time | machine |

Caddyfile sketch:

```text
http://petes-macbook.local {
    handle_path /railbaron/* { reverse_proxy localhost:4101 }
    handle_path /acquire/*   { reverse_proxy localhost:4102 }
    handle_path /marcopolo/* { reverse_proxy localhost:4103 }
}
```

- **Global process: yes** — Caddy, installed once (`brew install caddy`,
  `brew services start caddy`), fronting every game. WebSocket proxying is automatic.
- **Risk to name honestly:** the base-path line is one line *if* the client has no
  hardcoded absolute paths. Any game that assumes it lives at `/` (absolute asset
  URLs, absolute route pushes, absolute socket path) surfaces that assumption here.
  Budget a pass per game, not a line per game. Rail Baron's client-side router and
  the lobby client both need checking against a non-root base.
- **Verdict:** portless URLs on bare mDNS — no DNS infrastructure needed. The cost is
  the base-path change in **every** game, which is the most invasive per-game change
  in this document.

## Tier 3: reverse proxy, subdomain routing

Share links look like `http://railbaron.games.example.com` (a real domain resolving to
the LAN IP) — or router-DNS names if you never leave home.

| What | Nature | Where |
| --- | --- | --- |
| Everything in Tier 1 (Tier 2's base-path change is **not** needed) | — | each game |
| Nothing else at all | — | each game |
| Caddy with subdomain blocks | infra | machine (global) |
| DNS that resolves the subdomains to the machine's current LAN IP | infra | machine + DNS provider (global) |

Caddyfile sketch:

```text
http://railbaron.games.example.com { reverse_proxy localhost:4101 }
http://acquire.games.example.com   { reverse_proxy localhost:4102 }
```

The DNS piece — the reason this tier exists and its whole cost:

- mDNS **cannot** do subdomains; `.local` gives the machine exactly one name.
- **Option A, portable (recommended):** a real domain with a wildcard record
  `*.games.example.com → <LAN IP>`, kept current by a small updater on the host — a
  launchd job that checks the LAN IP and calls the DNS provider's API on change
  (dynamic DNS pointed inward). Public record, private address; the games are never
  reachable from the internet. Works at anyone's house. Two caveats: DNS-rebind
  protection on some routers blocks public names resolving to private IPs (a router
  setting, on every network you visit), and record-change propagation is minutes, not
  seconds — acceptable because the IP changes between sessions, not during them.
- **Option B, home-only:** router DNS / dnsmasq / Pi-hole entries. No updater needed if
  keyed to the machine (DHCP reservation), but per-network and gone at a friend's house.
- **Global processes: two** — Caddy, plus the DNS updater (Option A only).
- **Verdict:** zero per-game change beyond Tier 1, cleanest URLs, and each game keeps
  believing it owns its origin — the assumption they were all built under. The
  complexity moves entirely into machine/DNS infrastructure.

## Comparison at a glance

| | Tier 1: ports | Tier 2: paths | Tier 3: subdomains |
| --- | --- | --- | --- |
| Share link | `host.local:4101` | `host.local/railbaron` | `railbaron.games.example.com` |
| Per-game code change | serve own client | + base path everywhere | serve own client only |
| Global process | none | Caddy | Caddy + DNS updater |
| DNS required | mDNS (free, built-in) | mDNS | real domain or router DNS |
| Survives IP change | yes (mDNS) | yes (mDNS) | yes (updater) |
| Works at a friend's house | yes | yes | Option A yes; B no |

## Recommended path

1. **Now:** Tier 1. Prereq work (serve-own-client, share-link fix) in Rail Baron first;
   Acquire when next touched. This is also the first real playtest of online mode,
   which the 2026-08-14 by-hand notes still owe.
2. **When ports annoy:** skip Tier 2 and go to Tier 3 — the base-path change is the
   worst per-game cost in this spec and Tier 3 makes it unnecessary. Tier 2 is only
   the right stop if buying a domain / running an updater is off the table.
3. **Later:** the serve-own-client work and `/net-info` are both direct prerequisites
   of the iOS host-app idea (embedded server serving web clients over wifi), so none
   of the Tier 1 work is throwaway even if hosting moves off the laptop.

## Out of scope, noted so they aren't forgotten

- TLS. Plain http on a home LAN is accepted here; a real domain (Tier 3) is the only
  tier that could carry a real certificate later if a browser API ever demands a
  secure context.
- Any "my rooms" discovery UI (separate gap, noted in conversation 2026-08-16): stored
  room URLs should store the room code separately from the host address so a changed
  address doesn't orphan the room.
- Internet play. Every tier here is wifi-only by construction; Render deployment
  remains the internet answer and is unchanged.
