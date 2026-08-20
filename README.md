# game-host

An npm workspace monorepo: three games (`games/marcopolo`, `games/railbaron`,
`games/acquire`) and their shared lobby package (`packages/lobby`), plus the
front-door configuration for the machine that hosts game night — a Caddy
reverse proxy that gives every game a portless path on the LAN, a flat menu
page at the root, and the canonical [port registry](PORTS.md).

Friends on the wifi see one address:

```text
http://<machine-name>.local/            → the menu
http://<machine-name>.local/railbaron/  → Rail Baron
```

## Build and test

```bash
npm install       # links packages/lobby, games/marcopolo, games/railbaron, games/acquire
npm test          # every package's suite in one command: 1548 tests / 145 files
npm run typecheck
```

This is a plain library-and-server checkout for developing the games — it
works on any machine. The rest of this README (Caddy, launchd, the port
registry, `saves/`) is about the *hosting* side: turning built games into
one address on the LAN, which is the host machine's job, still done with the
start script and Caddyfile below. **Composition has happened**: one process
(`apps/host`, port 4000) serves all three games, their sockets and a menu
generated from whatever mounted, so Caddy proxies one port and knows no game
names. Each game also still boots alone on its own `400N` for development —
see PORTS.md.

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
no data on this machine. (Render was not so lucky: its disk said `games/`,
and the cutover renamed it once.) Marco Polo gets no directory, because it
persists nothing.

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
