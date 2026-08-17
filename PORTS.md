# The cross-game port registry

**This copy is canonical.** It lives next to the Caddyfile because that file
is the registry's enforcing consumer — a collision fails here first. Each
game hardcodes its own two numbers as defaults (a game must boot correctly
with this repo nowhere in sight) and points its docs at this table; when a
number changes, this table changes first and the game follows.

One machine hosts every game on the wifi; ports are how they share its one
address. Two contiguous blocks, both outside the crowded 3000s and below the
ephemeral range (49152+, which the OS hands out randomly):

- **4001 and up — game servers** (sockets + API; will also serve the built
  client once each game learns to).
- **7931 and up — dev clients** (each game's Vite dev server, pinned with
  `strictPort` so a taken port fails loudly instead of sliding into a
  neighbour's slot).

| Game | Server | Dev client | Proxy path |
| --- | --- | --- | --- |
| Rail Baron | 4001 | 7931 | `/railbaron` |
| Acquire | 4002 | 7932 | `/acquire` |
| Marco Polo | 4003 | 7933 | `/marcopolo` |
| (next title) | 4004 | 7934 | — |

A game's two numbers share an offset on purpose: server 400N pairs with
client 793N (7930 + N).

Known consumers, kept in agreement by hand:

- `Caddyfile`, this repo — every number
- Rail Baron: `src/config.ts` `DEFAULT_SERVER_PORT`, `server/index.ts` boot
  default (both 4001), `vite.config.ts` `server.port` (7931)
- Acquire: not yet moved onto its slots (still defaults to 3001)
