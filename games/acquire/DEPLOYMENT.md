# Deployment

Two halves, deployed independently. The client is origin-relative (see
`src/net/connection.ts`), so the same build also works behind the game-host
front door or served by the game server itself — deployment sets only
`VITE_SERVER_URL`, never a port.

## The live deployment

**Client — served by the game host**, at `/acquire`, from whichever host is
serving: the house machine over the wifi, and Render for online play. The
client is origin-relative, so the same build serves both — it talks to
whoever served it, and no build in this repo names an origin.

**The GitHub Pages deploy is retired** (2026-08-20). Gone with it: the
`gh-pages` dependency, the `deploy` script, `public/404.html` (the SPA
fallback Pages needed — `apps/host` does that job properly), and
`.env.production`, which was the last thing in the codebase naming a whole
origin. The *live* Pages site outlives them: it is built from the old
`acquire-startups-m1` repo and keeps working until that repo is archived.

**`/acquire-startups-m1` redirects to `/acquire`**, permanently, suffix and
query intact, in `apps/host/host.ts` — a room code is what people paste to
each other, so a redirect that drops the suffix loses the room. Pinned by
`apps/host/routes.test.ts`.

**Server — Render**, service `srv-d3klnhnfte5s73diht90`
(`https://acquire-multiplayer.onrender.com`), plan **`starter`** (paid — it
does not sleep, whatever older notes say). **Still building from the old
`acquire-startups-m1` repo** until the cutover's Task 2 repoints it here.
Environment on the service, as it stands today:

- `PORT` — injected by Render; wins over the 4002 default.
- `GAMES_DIR=/var/data/games` — a 1 GB disk (`dsk-d9rafvlbedkc73coe2k0`) is
  mounted at `/var/data`, so rooms survive deploys and restarts (proven
  2026-08-08: a mid-draw room came back across a deploy with both seats). The
  cutover renames this directory to `/var/data/acquire` in one guarded
  pre-deploy `mv`; the rooms are kept.
- `SOCKET_PATH=/socket.io` — set 2026-08-18 when the server's default mount
  moved under the base path. It exists for the Pages client, which sets
  `VITE_SERVER_URL` and therefore keeps socket.io's default path.

  **This is what couples Task 2 to the Pages site.** The composed host does
  not read `SOCKET_PATH` — it is consumed by Acquire's standalone boot block,
  and `HostContext` has no `socketPath` — so a composed Acquire always mounts
  at `/acquire/socket.io`. The moment Render builds from this repo, the Pages
  client's sockets stop connecting. That is not a regression to fix but the
  retirement arriving; see the cutover plan's Task 2.

Health: `curl https://acquire-multiplayer.onrender.com/health` returns
`{ok, protocolVersion, saveVersion}` — one curl answers "what is deployed"
(the `/acquire/health` twin answers too; it exists for the front-door proxy).

## Testing the production shape locally

```bash
npm run serve     # build the client, then one process on 4002 serves
                  # pages, assets and sockets at /acquire/
```

`npm run preview` also works for socket flows (the vite proxy carries the
prefixed socket path to a separately started `npm run start:server`), but
`serve` is the shape the LAN host actually runs.

## Known loosenesses

- CORS is `origin: '*'` on the socket server. Restricting it to the Pages
  origin would be tidier; it has never been the live problem.
- Deploying the client and server from different commits is safe for sockets
  (the Pages client always uses the default path against a server that always
  mounts it under this setup), but a `protocolVersion` bump still needs both
  halves shipped — the version handshake refuses mismatched pairs.
