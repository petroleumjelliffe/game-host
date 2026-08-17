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
| Rail Baron | 4001 | 7931 | `/railbaron` |
| Acquire | 4002 | 7932 | `/acquire-startups-m1` |
| Marco Polo | 4003 | 7933 | `/marcopolo` |
| (next title) | 4004 | 7934 | — |

A game's two numbers share an offset on purpose: server 400N pairs with
client 793N (7930 + N).

The proxy path must equal the client's built base path, because assets are
requested at `<base>/assets/…` and nothing rewrites them. Acquire's is its
GitHub Pages path (`basePath.ts`: the repo name), hence the long one — the
menu link hides it. Marco Polo also claims the root `/socket.io` on the
proxy: its client is origin-relative (no port anywhere), and since the other
games' sockets go straight to their ports, the default socket.io path is
unclaimed at the front door. Retired when
`specs/2026-08-17-origin-relative-clients.md` gives every game its own
socket path.

Known consumers, kept in agreement by hand:

- `Caddyfile`, this repo — every number
- Rail Baron: `src/config.ts` `DEFAULT_SERVER_PORT`, `server/index.ts` boot
  default (both 4001), `vite.config.ts` `server.port` (7931)
- Acquire: `server/index.ts` boot default and `src/net/connection.ts`
  `DEV_SERVER_PORT` (both 4002), `vite.config.ts` `server.port` (7932).
  Render is untouched: it injects `PORT`, and the Pages client sets
  `VITE_SERVER_URL`, which wins over derivation.
- Marco Polo: `server/main.ts` default and `vite.config.ts` `serverPort`
  fallback (both 4003), `vite.config.ts` `server.port` (7933). No saves —
  nothing is persisted server-side.
