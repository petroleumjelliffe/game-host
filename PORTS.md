# The cross-game port registry

**This copy is canonical.** It lives next to the Caddyfile because that file
was the registry's enforcing consumer — a collision failed here first. That is
less true than it was: the Caddyfile now knows one number and no game names.
The registry's job is unchanged, though, and is really collision avoidance —
every number below is one some command will actually bind, so every number
below needs a claim.

One machine hosts every game on the wifi; ports are how they share its one
address. Two contiguous blocks, both outside the crowded 3000s and below the
ephemeral range (49152+, which the OS hands out randomly):

- **4000 — the composed host.** One process, every game, and the only port
  Caddy proxies. This is the hosted mode.
- **4001 and up — each game's standalone dev server** (`npm run dev:server`).
  Not hosted any more; still real, still bindable, still needs a slot.
- **7931 and up — dev clients** (each game's Vite dev server, pinned with
  `strictPort` so a taken port fails loudly instead of sliding into a
  neighbour's slot).

| What | Port | Dev client | Path |
| --- | --- | --- | --- |
| **the composed host** | **4000** | — | `/` — the menu, and every game below it |
| Rail Baron, alone | 4001 | 7931 | `/railbaron` |
| Acquire, alone | 4002 | 7932 | `/acquire` |
| Marco Polo, alone | 4003 | 7933 | `/marcopolo` |
| Word Game, alone | 4004 | 7934 | `/wordgame` |
| (next title), alone | 4005 | 7935 | — |

4000 sits outside the 4001+ block on purpose: that block is game servers, and
`apps/host` is not a game — it is the process that contains them. It has no
dev-client slot because it serves no client of its own, only each game's built
one.

A game's two numbers share an offset on purpose: server 400N pairs with
client 793N (7930 + N).

**4001–4003 were not retired, and the reason is worth stating** — an earlier
draft of the cutover plan said to delete them. They are no longer *hosted*:
Caddy does not know them, no launchd agent starts them, and nothing on the
LAN reaches them. But every game kept its standalone boot function through
the composition work (`createAppServer`, `startServer`, `createServer`), and
`npm run dev:server` still binds these numbers every day. A number a command
binds is a number that can collide, so it keeps its claim. Deleting the rows
would have freed 4002 for the next thing to take — and then Acquire's
`dev:server` would fail on a machine where something else got there first,
with nothing in this file to explain why.

For the same reason each game's Vite dev proxy still points at its **own**
`400N`, not at 4000. Developing one game means running that game's server, not
all three; the standalone path exists precisely so a game can be worked on
alone, and pointing dev at the composed host would trade that away for a
resemblance to production that dev does not need. `npm run dev:host` and a
game's `npm run dev` are deliberately two different servers.

The path must equal the client's built base path, because assets are requested
at `<base>/assets/…` and nothing rewrites them — true through the composed
host exactly as it was through Caddy, since neither strips a prefix. Acquire's
is its GitHub Pages path (`basePath.ts`: the repo name), hence the long one.
Every game's sockets ride `/<game>/socket.io`
(`specs/2026-08-17-origin-relative-clients.md`, implemented 2026-08-18), so
ports are machine-only knowledge — no client names one.

Known consumers, kept in agreement by hand:

- `apps/host/main.ts` — the composed host's boot default (4000), and the only
  number the hosted machine uses. `DATA_DIR` is required there and replaced
  the three per-game `GAMES_DIR` values.
- `Caddyfile`, this repo — 4000, and nothing else. It no longer names a game,
  so adding one is not an edit here.
- `start-host.sh`, `launchd/com.game-host.plist` — one script, one agent.
- Rail Baron: `server/index.ts` boot default (4001), `vite.config.ts`
  `server.port` (7931) and socket-proxy target (4001). Dev-only now.
- Acquire: `server/index.ts` boot default (4002), `vite.config.ts`
  `server.port` (7932) and socket-proxy targets (4002). Dev-only now. Render
  is untouched by these numbers: it injects `PORT`.
- Marco Polo: `server/main.ts` default (4003), `vite.config.ts` `serverPort`
  fallback and socket-proxy target (4003), `vite.config.ts` `server.port`
  (7933). No saves — nothing is persisted server-side.
- Word Game: `server/index.ts` boot default (4004), `vite.config.ts`
  `server.port` (7934) and socket-proxy target (4004), `package.json`
  `predev:server` port guard (4004). Dev-only, like the others.
