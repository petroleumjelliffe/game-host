# game-host

The front-door configuration for the machine that hosts game night: a Caddy
reverse proxy that gives every game a portless path on the LAN, a flat menu
page at the root, and the canonical [port registry](PORTS.md). No game code
lives here, and no game repo owns this — that is the point.

Friends on the wifi see one address:

```text
http://<machine-name>.local/            → the menu
http://<machine-name>.local/railbaron/  → Rail Baron
```

## Setup (once per machine)

```bash
brew install caddy
ln -sf ~/Developer/game-host/Caddyfile /opt/homebrew/etc/Caddyfile
ln -sfn ~/Developer/game-host /opt/homebrew/etc/game-host   # menu root; the
                               # Caddyfile can't use {env.HOME} — the brew
                               # service overrides HOME to its storage dir
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

The Caddyfile's menu `root` is an absolute path — Caddy as a service has no
working directory to resolve a relative one from — so it assumes this repo
is cloned at `~/Developer/game-host`. Cloned elsewhere, fix that one line.

Everything rides port 80: each game mounts socket.io under its base path,
so pages, assets and sockets share the one `handle /<game>/*` route
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

Each game becomes a launchd user agent: starts at login, restarts on crash
(but stays stopped after a clean `launchctl bootout`), logs to
`/opt/homebrew/var/log/game-host.<game>.log`. The plists reach the start
scripts through the `/opt/homebrew/etc/game-host` symlink, so they carry no
username. Stop one game: `launchctl bootout gui/$(id -u)/com.game-host.railbaron`;
start it again: rerun the installer. Note a service and a by-hand start
script fight over the same port — stop the service first if you want a
foreground run.

Smoke check — each game answers health under its prefix, through the front
door:

```bash
curl http://localhost/railbaron/health
curl http://localhost/acquire-startups-m1/health
curl http://localhost/marcopolo/health
```

## Save data

Online games persist on the host machine, one directory per title under
[saves/](saves/) (gitignored — real games, not config), handed to each
game's server as an absolute path by its start script:

```bash
./start-railbaron.sh    # builds Rail Baron's client, then starts its server —
                        # one process serving pages, assets and sockets on
                        # 4001, saves in saves/railbaron
```

Each game keeps a repo-local relative default so it boots standalone; the
absolute path matters here because a service's working directory is not the
game repo, and a relative default would silently resolve to a different,
empty directory — every saved room seemingly vanished.

Saves stay on local disk deliberately: the stores write via atomic
temp-file-and-rename on every event, which synced folders (iCloud/Dropbox)
can race and corrupt. Durability beyond this disk is a backup's job — the
directory is small JSON files, and Time Machine already covers it.

## Adding a game

1. Claim the next slot pair in [PORTS.md](PORTS.md) (server 400N, dev client
   7930+N, path `/<name>`).
2. Point the game at its numbers: server default and dev-client port in the
   game's own config, hardcoded — plus a docs pointer back at PORTS.md.
3. Build/serve the game's client under its path prefix (Vite `base`).
4. Uncomment or add its `handle` blocks in the [Caddyfile](Caddyfile), then
   `caddy validate --config Caddyfile` and reload
   (`brew services restart caddy`).
5. Add it to the menu ([menu/index.html](menu/index.html)) — edits are live,
   Caddy serves the file per request.
6. Give it a start script (copy [start-railbaron.sh](start-railbaron.sh))
   pointing its save directory at `saves/<name>`.
