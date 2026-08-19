# The cross-game port registry

**This copy is canonical.** It lives next to the Caddyfile because that file
is the registry's enforcing consumer — a collision fails here first. Each
game hardcodes its own two numbers as defaults (a game must boot correctly
with this repo nowhere in sight) and points its docs at this table; when a
number changes, this table changes first and the game follows.

One machine hosts every game on the wifi; ports are how they share its one
address. Two contiguous blocks, both outside the crowded 3000s and below the
ephemeral range (49152+, which the OS hands out randomly):

- **4001 and up — game servers** (sockets + API, and each serves its own
  built client, so one process per game is the hosted mode).
- **7931 and up — dev clients** (each game's Vite dev server, pinned with
  `strictPort` so a taken port fails loudly instead of sliding into a
  neighbour's slot).

| Game | Server | Dev client | Proxy path |
| --- | --- | --- | --- |
| **the composed host** | **4000** | — | `/` (every game, one process) |
| Rail Baron | 4001 | 7931 | `/railbaron` |
| Acquire | 4002 | 7932 | `/acquire-startups-m1` |
| Marco Polo | 4003 | 7933 | `/marcopolo` |
| (next title) | 4004 | 7934 | — |

4000 sits outside the 4001+ block on purpose: that block is game servers, and
`apps/host` is not a game — it is the process that contains them. It has no
dev-client slot because it serves no client of its own, only each game's built
one.

A game's two numbers share an offset on purpose: server 400N pairs with
client 793N (7930 + N).

All seven numbers are real today, and that is deliberate rather than
transitional sloppiness. `apps/host` exists and runs all three games in one
process on 4000 (`npm run start:host`), but nothing is *deployed* that way
yet: the Caddyfile still routes three prefixes to three ports, three launchd
agents still run three `start-*.sh` scripts, and each game's `dev:server`
still boots on its own 400N. The cutover plan is what retires 4001–4003 and
collapses the Caddyfile to a single `reverse_proxy` — until then both
arrangements have to work, so both are listed.

The dev-client slots are unaffected either way: three Vite dev servers still
coexist during development. Note that a Vite dev client proxies its socket
path to *its own game's* 400N, not to 4000 — so `npm run dev:host` and
`npm run dev` in a game are two different servers and do not talk to each
other. Repointing those proxies belongs with the port collapse.

The proxy path must equal the client's built base path, because assets are
requested at `<base>/assets/…` and nothing rewrites them. Acquire's is its
GitHub Pages path (`basePath.ts`: the repo name), hence the long one — the
menu link hides it. Every game's sockets ride `/<game>/socket.io` through
the front door (`specs/2026-08-17-origin-relative-clients.md`, implemented
2026-08-18), so ports are machine-only knowledge now — no client names one.
The one exception: a deployed build's `VITE_SERVER_URL` override, which
names a whole origin, not a port.

Known consumers, kept in agreement by hand:

- `apps/host/main.ts` — the composed host's boot default (4000). `DATA_DIR`
  is required there and replaces the three per-game `GAMES_DIR` values.
- `Caddyfile`, this repo — every server number (dev-client slots appear
  only where a block's comment points hot reload at one)
- Rail Baron: `server/index.ts` boot default (4001), `vite.config.ts`
  `server.port` (7931) and socket-proxy target (4001 — build tooling, the
  port's only client-adjacent appearance)
- Acquire: `server/index.ts` boot default (4002), `vite.config.ts`
  `server.port` (7932) and socket-proxy targets (4002). Render is untouched:
  it injects `PORT`, the Pages client sets `VITE_SERVER_URL` (which wins),
  and the service sets `SOCKET_PATH=/socket.io`.
- Marco Polo: `server/main.ts` default (4003), `vite.config.ts` `serverPort`
  fallback and socket-proxy target (4003), `vite.config.ts` `server.port`
  (7933). No saves — nothing is persisted server-side.
