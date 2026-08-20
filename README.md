# game-host

An npm workspace monorepo: three games (`games/marcopolo`, `games/railbaron`,
`games/acquire`) and their shared lobby package (`packages/lobby`), plus the
front-door configuration for the machine that hosts game night — a Caddy
reverse proxy that forwards one port, a menu generated from whatever games
mounted, and the canonical [port registry](PORTS.md).

Friends on the wifi see one address:

```text
http://<machine-name>.local/            → the menu
http://<machine-name>.local/railbaron/  → Rail Baron
```

## Build and test

```bash
npm install       # links packages/lobby, games/marcopolo, games/railbaron, games/acquire
npm test          # every package's suite in one command: 1600 tests / 152 files
npm run typecheck
```

This is a plain library-and-server checkout for developing the games — it
works on any machine. The rest of this README (Caddy, launchd, the port
registry, `saves/`) is about the *hosting* side, which is the host machine's
job.

One process (`apps/host`, port 4000) serves all three games, their sockets
and a menu generated from whatever mounted, so Caddy proxies one port and
knows no game names. **The same process is what Render runs**, from the same
`main`, so there is one artifact and two deployments — see
[Deploying](#deploying). Each game also still boots alone on its own `400N`
for development; see PORTS.md.

## Setup (once per machine)

```bash
brew install caddy
ln -sf ~/Developer/game-host/Caddyfile /opt/homebrew/etc/Caddyfile
ln -sfn ~/Developer/game-host /opt/homebrew/etc/game-host   # how the plist
                               # reaches start-host.sh without baking in a
                               # username. (It was the Caddyfile's menu root
                               # too, until the host started serving its own
                               # menu — the {env.HOME} lesson that produced
                               # this symlink is in the Caddyfile's header.)
ln -sfn ~/.local/share/fnm/aliases/default/bin ~/Developer/game-host/node-bin
                               # (gitignored) the node the services run —
                               # fnm's default alias here; point it at any
                               # arm64 node's bin dir. The plists put it
                               # first on PATH because launchd's bare PATH
                               # otherwise finds whatever node is lying
                               # around — an x86_64 leftover in
                               # /usr/local/bin broke every native binding.
brew services start caddy      # or `caddy run --config Caddyfile` to try it
```

`start-host.sh` and the plist both assume this repo is cloned at
`~/Developer/game-host`. Cloned elsewhere, fix the path in the script and
re-run the symlinks above.

Everything rides port 80, and Caddy forwards all of it to 4000 without
touching the path: each game mounts its pages, assets and sockets under its
own base path
([specs/2026-08-17-origin-relative-clients.md](specs/2026-08-17-origin-relative-clients.md)).
Design history — the tiers, the DNS story, and the direct-port-sockets
deviation that spec retired — is written up in the Rail Baron repo,
`docs/superpowers/specs/2026-08-16-lan-hosting-design.md`.

## Game servers as services

The start scripts run fine by hand, but by-hand processes die with their
terminals — a working menu over 502ing games means exactly that. To make
every game as permanent as Caddy:

```bash
./install-services.sh           # installs the launchd/ plists and starts them
./install-services.sh remove    # stops and uninstalls
```

One agent, `com.game-host`, for all three games: starts at login, restarts on
crash (but stays stopped after a clean `launchctl bootout`), logs to
`/opt/homebrew/var/log/game-host.log`. It reaches `start-host.sh` through the
`/opt/homebrew/etc/game-host` symlink, so it carries no username. Stop
everything: `launchctl bootout gui/$(id -u)/com.game-host`; start it again by
rerunning the installer. Note a service and a by-hand start script fight over
the same port — stop the service first if you want a foreground run.

`install-services.sh` installs whatever plists are in `launchd/`, and can only
*remove* agents whose plists are still there. Both halves of that bite, in
opposite directions, and the 2026-08-20 cutover hit each in turn:

- **Remove before pulling** the change that deletes the old plists. Otherwise
  the old agents stay bootstrapped and nothing in this repo knows how to stop
  them.
- **Delete the old plists before installing.** A `remove` followed by an
  `install` while the retired plists are still in `launchd/` cheerfully brings
  them back — three agents on 4001–4003 alongside the composed host, two of
  them writing the same `saves/` directories it is using.

The safe order when replacing agents is therefore: `remove`, then land the
commit that both adds the new plist and deletes the old ones, then `install`.

Smoke check — the aggregate says what is deployed in one request, and each
game still answers for itself:

```bash
curl http://localhost/health          # all three games' versions
curl http://localhost/               # the generated menu
curl http://localhost/railbaron/health
curl http://localhost/acquire/health
curl http://localhost/marcopolo/health
```

## Deploying

One artifact, two deployments, both built from `main`: this machine for
in-house play over the wifi, and Render for online play. Neither is staging —
they differ in audience, not in tier. The client is origin-relative, so the
same build serves both: it talks to whoever served it, and **no build in this
repo names an origin**. Do not reintroduce one.

### To the LAN (this machine)

```bash
cd ~/Developer/game-host
git pull                                          # on main
launchctl kickstart -k gui/$(id -u)/com.game-host
```

That is the whole deploy. `start-host.sh` rebuilds all three clients and
restarts the process, because a service restarted after a `git pull` should
serve the code that was pulled. Verify:

```bash
curl -s localhost/health          # three games and their versions
curl -s localhost/ | head         # the generated menu
```

**A restart is a ~2.3s outage**, not a blip: the build runs *after* the old
process is gone. Clients reconnect on their own — socket.io buffers and
retries — but a game in progress will pause. Do not deploy mid-evening.

**Do not run `npm run start:host` by hand here.** It fights the agent for port
4000, and `DATA_DIR` is deliberately unset outside the start script. Do not
run `npm run build` here either while people are playing: the agent serves
`games/*/dist` from disk per request, and a rebuild swaps content-hashed
assets out from under loaded pages. Develop in a worktree instead
(`git worktree add ~/Developer/game-host-dev -b <branch>`), which also makes
it impossible for a stray branch to be what an unattended restart deploys.

### To Render (online)

Service `srv-d3klnhnfte5s73diht90`, plan `starter`, **auto-deploys on every
commit to `main`** — so pushing is deploying. Its hostname still reads
`acquire-multiplayer.onrender.com` because Render fixes the `.onrender.com`
subdomain at service creation and a rename does not move it; the origin now
serves all three games regardless.

| Setting | Value |
| --- | --- |
| Repo / branch | `github.com/petroleumjelliffe/game-host`, `main` |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm run start:host` |
| Health check path | `/health` |
| Environment | `DATA_DIR=/var/data`, `NODE_ENV=production` |
| Disk | `dsk-d9rafvlbedkc73coe2k0` at `/var/data`; the host creates `acquire/` and `railbaron/` beneath it |

Four things there are load-bearing in ways that are not obvious:

- **`--include=dev` is not decoration.** `NODE_ENV=production` makes npm set
  `omit=dev` (verify with `NODE_ENV=production npm config get omit`), and
  `vite`, `typescript`, `@vitejs/plugin-react` and Acquire's
  `tailwindcss`/`postcss` all live in `devDependencies`. Without it the build
  dies on the first Vite invocation.
- **`NODE_ENV=production` stays.** It is what keeps Acquire's `/dev/rooms`
  seeding route out of production, and that route installs arbitrary game
  state.
- **A pre-deploy command cannot see the persistent disk.** It runs on separate
  compute and the disk mounts only when the deploy goes live
  ([Render docs](https://render.com/docs/disks)). Anything touching
  `/var/data` must run in the start command or over `render ssh` against a
  live instance — a pre-deploy that tests for a path there silently finds
  nothing and exits 0. That is how the Acquire room migration reported success
  and moved nothing, 2026-08-20.
- **Every deploy drops every socket.** Clients reconnect, but see the backlog:
  Marco Polo still gives no feedback while disconnected.

Verify a deploy:

```bash
B=https://acquire-multiplayer.onrender.com
curl -s $B/health                                  # three games
curl -sI $B/acquire-startups-m1/room/ABCD          # 301 → /acquire/room/ABCD
```

Shell into the running instance — the only way to see the disk:

```bash
render ssh srv-d3klnhnfte5s73diht90
ls /var/data/acquire        # rooms are <ROOMID>.json
```

Rooms are restored at boot, so files placed there under a running host are not
seen until it restarts.

## Save data

Online games persist on the host machine, one directory per title under
[saves/](saves/) (gitignored — real games, not config). The start script
exports one absolute `DATA_DIR`, and the host creates a subdirectory per
game beneath it:

```bash
./start-host.sh         # builds all three clients, then runs one process
                        # serving every game's pages, assets and sockets on
                        # 4000, saves under saves/<game>
```

Those subdirectory names — `saves/railbaron`, `saves/acquire` — are the ones
the three retired `start-*.sh` scripts already created, so the cutover moved
no data on this machine. Marco Polo gets no directory, because it persists
nothing.

Render allocates the same names under its own `DATA_DIR=/var/data`. Its old
Acquire rooms lived at `/var/data/games` and were **not** migrated — see
[Deploying](#deploying) for why that attempt could not have worked.

Each game keeps a repo-local relative default so it boots standalone; the
absolute path matters here because a service's working directory is wherever
its plist says, and a relative default would silently resolve to a different,
empty directory — every saved room seemingly vanished. `DATA_DIR` has no
default at all for the same reason: the host refuses to boot without it
rather than guessing.

Saves stay on local disk deliberately: the stores write via atomic
temp-file-and-rename on every event, which synced folders (iCloud/Dropbox)
can race and corrupt. Durability beyond this disk is a backup's job — the
directory is small JSON files, and Time Machine already covers it.

## Adding a game

1. Add the package under `games/<name>/`, and claim its dev slot pair in
   [PORTS.md](PORTS.md) (standalone server 400N, dev client 7930+N).
2. Point the game at its numbers: standalone server default and dev-client
   port in the game's own config, hardcoded — plus a docs pointer back at
   PORTS.md. These are dev-only; the hosted process uses neither.
3. Build/serve the game's client under its path prefix (Vite `base`). The
   prefix must equal the built base path, because assets are requested at
   `<base>/assets/…` and nothing rewrites them.
4. Export `mount(ctx)` returning a `MountedGame` (see
   [packages/host/contract.ts](packages/host/contract.ts)), and make the
   game's existing boot function a thin wrapper over it so it still runs
   alone.
5. Add one row to `GAMES` in [apps/host/host.ts](apps/host/host.ts) — path,
   title and save-directory name all come off the mount, so the menu and the
   aggregate `/health` pick it up with nothing else to edit.

That is the whole list. **No Caddyfile edit, no menu edit, no start script,
no plist** — the front door forwards one port and knows no game names, the
menu is generated from what mounted, and one agent runs the lot. Those four
steps used to be steps 4 through 6 of this checklist and a plist copy;
deleting them was the point of the composition work.
