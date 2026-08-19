# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Host-machine configuration, not application code. It is the front door for the
machine that hosts game night: a Caddy reverse proxy on port 80, a static menu
page, launchd agents, start scripts, and the canonical cross-game port
registry. The games themselves live in separate sibling repos
(`~/Developer/railbaron`, `~/Developer/acquire-startups-m1`,
`~/Developer/marco-polo`) which this repo only references by path.

No build, no tests, no package manager. Changes are shell, plists, a Caddyfile,
one HTML file, and docs.

## This clone is not the host machine

Every script, plist, and the README assume the repo is cloned at
`~/Developer/game-host` with the game repos as its siblings. This checkout is
at `~/Developer/personal/game-host`, and neither Caddy, the
`/opt/homebrew/etc/game-host` symlink, nor any game repo exists here. Treat
edits as configuration authoring; do not expect to run or smoke-test them
locally, and do not "fix" the hardcoded `~/Developer/game-host` paths unless
asked — they describe the host, not this working copy.

## Architecture

One process per game serves its own built client, its API, and its socket.io
mount — all under a single port (`400N`) and a single path prefix (`/<game>`).
Caddy maps prefix → port with `handle` + `reverse_proxy` and **never strips the
prefix**: each game's client is *built* under its base path, so the path Caddy
forwards is the path the game expects. Anything unmatched falls through to the
static menu.

Clients are origin-relative: they address pages, assets, and sockets as paths
off `window.location.origin`, so no client names a host or port
([specs/2026-08-17-origin-relative-clients.md](specs/2026-08-17-origin-relative-clients.md),
implemented 2026-08-18). Ports are machine-only knowledge. The single exception
is a deployed build's `VITE_SERVER_URL`, which names a whole origin — when it
is set, the client uses socket.io's default socket path, and the corresponding
server sets `SOCKET_PATH=/socket.io` (Acquire on Render).

### Load-bearing details, each learned the hard way

- **`/opt/homebrew/etc/game-host` symlink.** The Caddyfile's menu `root` and
  every plist's `ProgramArguments` go through it, so no username or clone
  location is baked into published files. `{env.HOME}` does *not* work in the
  Caddyfile: Homebrew's caddy service overrides `HOME` to its storage dir, so
  it works under `caddy run` and silently 404s as a service.
- **`node-bin` symlink** (gitignored, points at fnm's default alias). launchd
  agents get a bare `PATH`; the plists put `node-bin` first because
  `/usr/local/bin` once held an x86_64 node that broke every native binding
  under Rosetta.
- **`redir * /<game>/`** — the bare `*` matcher is required; `redir /<game>/`
  alone parses the first argument as a path matcher with no destination.
- **Absolute `GAMES_DIR`** in start scripts. Games keep a repo-relative save
  default so they boot standalone; a service has no useful working directory,
  so a relative path would silently resolve elsewhere and every saved room
  would appear to vanish. Saves stay on local disk deliberately — the stores
  use atomic temp-file-and-rename, which synced folders can corrupt.
- **`KeepAlive`/`SuccessfulExit: false`** — crashes restart, a clean
  `launchctl bootout` stays stopped.
- A launchd service and a by-hand start script fight over the same port. Stop
  the service before a foreground run.

## Commands (run on the host machine)

```bash
caddy validate --config Caddyfile    # after any Caddyfile edit
brew services restart caddy          # reload the front door
caddy run --config Caddyfile         # foreground, for trying it

./install-services.sh                # (re)install + start the launchd agents
./install-services.sh remove         # stop and uninstall

curl http://localhost/railbaron/health            # smoke check through Caddy
curl http://localhost/acquire-startups-m1/health
curl http://localhost/marcopolo/health
```

Logs: `/opt/homebrew/var/log/game-host.<game>.log`. Stop one game:
`launchctl bootout gui/$(id -u)/com.game-host.<game>`; start it again by
rerunning the installer. Menu edits are live — Caddy serves the file per
request, no reload needed.

## The port registry is canonical here

[PORTS.md](PORTS.md) is the source of truth (server `400N`, dev client
`7930+N`, path `/<name>`), and it lives next to the Caddyfile because that file
is the enforcing consumer — a collision fails here first. Each game *also*
hardcodes its own two numbers as defaults so it boots with this repo absent.
When a number changes, PORTS.md changes first and the games follow; its "known
consumers" list names the exact files in each game repo to update.

A game's proxy path must equal its client's built base path, because assets are
requested at `<base>/assets/…` and nothing rewrites them. That is why Acquire's
path is its long GitHub Pages repo name.

## Adding a game

Follow the six-step checklist at the end of [README.md](README.md): claim the
slot pair in PORTS.md, point the game's own config at its numbers, build its
client under the path prefix, add the Caddyfile `handle` blocks (+ validate and
reload), add it to [menu/index.html](menu/index.html), and copy a start script
with `saves/<name>`. Plists are copy-and-rename — the three differ only in
label, script name, and log path.

## Docs conventions

Specs and plans (`specs/`, `docs/plans/`) are dated and carry an explicit
status; implemented specs get an "As built" section recording deltas from the
design rather than being rewritten. Prose here is deliberately narrative and
explains *why* — comments in the Caddyfile, plists, and scripts carry the
reasoning and sometimes the date a problem was found. Match that voice; when
you change a load-bearing line, update the comment that explains it.
