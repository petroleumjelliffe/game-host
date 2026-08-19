# Deployment

Two halves, deployed independently. The client is origin-relative (see
`src/net/connection.ts`), so the same build also works behind the game-host
front door or served by the game server itself — deployment sets only
`VITE_SERVER_URL`, never a port.

## The live deployment

**Client — GitHub Pages**, at
`https://petroleumjelliffe.github.io/acquire-startups-m1`. Manual deploy:

```bash
npm run build     # bakes .env.production's VITE_SERVER_URL into the bundle
npm run deploy    # gh-pages -d dist
```

`.env.production` sets `VITE_SERVER_URL=https://acquire-multiplayer.onrender.com`;
with it set, the client keeps socket.io's default `/socket.io` path — that
server owns its whole origin.

**Server — Render**, service `srv-d3klnhnfte5s73diht90`
(`https://acquire-multiplayer.onrender.com`), plan **`starter`** (paid — it
does not sleep, whatever older notes say). Start command runs
`tsx server/index.ts`; `npm run build:server` is only the submodule guard, so
clone with `--recurse-submodules`. Environment on the service:

- `PORT` — injected by Render; wins over the 4002 default.
- `GAMES_DIR=/var/data/games` — a 1 GB disk (`dsk-d9rafvlbedkc73coe2k0`) is
  mounted at `/var/data`, so rooms survive deploys and restarts (proven
  2026-08-08: a mid-draw room came back across a deploy with both seats).
- `SOCKET_PATH=/socket.io` — set 2026-08-18, when the server's default mount
  moved to `/acquire-startups-m1/socket.io` for LAN hosting behind the
  game-host front door. Render keeps the bare path because the Pages client
  (with `VITE_SERVER_URL` set) uses socket.io's default. Remove this var and
  every Pages client hangs on "Connecting…" — see game-host's
  `specs/2026-08-17-origin-relative-clients.md`.

Health: `curl https://acquire-multiplayer.onrender.com/health` returns
`{ok, protocolVersion, saveVersion}` — one curl answers "what is deployed"
(the `/acquire-startups-m1/health` twin answers too; it exists for the
front-door proxy).

## Testing the production shape locally

```bash
npm run serve     # build the client, then one process on 4002 serves
                  # pages, assets and sockets at /acquire-startups-m1/
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
