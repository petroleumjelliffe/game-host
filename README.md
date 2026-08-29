# game-host

An npm workspace monorepo: four games (`games/marcopolo`, `games/railbaron`,
`games/acquire`, `games/wordgame`) and their shared lobby package
(`packages/lobby`), plus the front-door configuration for the machine that
hosts game night — a Caddy reverse proxy that forwards one port, a menu
generated from whatever games mounted, and the canonical
[port registry](PORTS.md).

Friends on the wifi see one address:

```text
http://<machine-name>.local/            → the menu
http://<machine-name>.local/railbaron/  → Rail Baron
```

## Build and test

```bash
npm install       # links every packages/*, games/*, apps/* workspace
npm test          # every package's suite in one command
npm run typecheck
npm run lint      # one type-aware eslint across all nine workspaces
```

`npm run lint` gates pull requests and nothing else: it is a CI job of its
own, and neither `npm run build` nor `deploy.sh` runs it, so a lint error
cannot fail a deploy the way a type error deliberately can. There is no
formatter, which was a measurement rather than an oversight — see
[docs/plans/2026-08-20-the-linter.md](docs/plans/2026-08-20-the-linter.md).

This is a plain library-and-server checkout for developing the games — it
works on any machine. The rest of this README (Caddy, launchd, the port
registry, `saves/`) is about the *hosting* side, which is the host machine's
job.

One process (`apps/host`, port 4000) serves every game, their sockets
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

**Rail Baron money phase 2 (2026-08-23) changes what existing Rail Baron
logs replay to** — read this before the pull that ships it. Winning now
requires an announced `declared` event, so a game *finished* under the old
rule replays as unfinished, and an in-flight leader who had silently gone
homeward is now merely eligible to declare. The fee derivation also applies
to old logs: every past turn that rode track now bills its $1,000 bank fee,
so in-flight balances drop on replay. Both are accepted by the phase-2
spec's Compatibility section — these are game-night saves, not archives,
and dual win rules keyed on log era would be permanent complexity for a
handful of rooms. No save is corrupted; the events all replay — they just
score under the rulebook's real rules now.

### What a deploy builds, and what a player sees

"Compiled", since 2026-08-20, means **the server** — and only the server. The
three clients were always compiled: Vite has built them to `games/*/dist` from
the beginning and nothing about that changed. What was never compiled was the
server, which ran under `tsx`: 57 files of three game servers plus two shared
packages, transpiled from scratch on every start. `npm run build` now also
emits one `apps/host/dist/main.mjs`, and plain `node` runs it.

So one build does four things — typecheck every workspace, three Vite clients,
one server bundle — and the artifact is gitignored, so every machine builds
its own and none of it is ever committed.

**For a player, nothing changes.** Same URLs, same room codes, same assets,
same sockets. No client code was touched. Two second-order effects are worth
knowing before a game night:

- **A restart is shorter but not invisible.** The server gap is ~0.2s, but
  socket.io retries on its own backoff — 500ms and doubling — so a client that
  fails the instant the server goes away still waits out its own timer. Expect
  about a second, against the 3.6–5.9s measured before this change.
- **One thing is slightly worse, and it is a real trade.** `deploy.sh` rebuilds
  the clients *while the old server is still serving*, so content-hashed assets
  are replaced a few seconds before the restart. A page that has been open a
  while and then lazy-loads a chunk in that window gets a 404 and needs a
  reload. The hazard is not new — Vite deletes the old hashed files either way
  — but it used to land while the server was already down. Buying a shorter
  outage with a slightly earlier asset swap is the right trade for a room full
  of phones, and it is still a reason not to deploy mid-hand.

### To the LAN (this machine)

```bash
cd ~/Developer/game-host
git pull
```

That is the whole deploy (since 2026-08-20): the `post-merge` hook —
versioned in `hooks/`, installed by `install-services.sh` — runs `deploy.sh`
the moment the merge lands, and there is no second command to forget.
`deploy.sh` does what it always did minus the pull it used to open with:
install, typecheck, build all three clients and the server bundle, restart
the agent, then poll `/health` and print it. Running `./deploy.sh` by hand
still works and means what it says — deploy the tree as checked out, e.g. to
rebuild without new commits. Either way it stops on the first failure, and
every step that can fail happens **while the old version is still serving**
— a broken build leaves the previous one up instead of taking everything
down and then discovering the problem.

The hook only fires where it should: only on `main`, and only in the clone
the `/opt/homebrew/etc/game-host` symlink names — a pull in a worktree, or
in a clone on some other machine, deploys nothing. The installer also sets
`git config pull.ff only`, keeping what the old in-script pull enforced: a
divergence stops and asks a human rather than deploying a merge commit
nobody reviewed.

**A restart is a ~0.2s outage.** The agent execs a prebuilt bundle rather than
building at boot: measured 179ms from spawn to a served `/health`, against
2.3s when the build ran with the old process already gone. Clients still
reconnect on socket.io's own backoff, which is longer than the outage — see
the backlog. It is no longer a reason to avoid deploying mid-evening, though
rebuilding the clients does swap content-hashed assets out from under pages
that are already loaded.

A bare `launchctl kickstart -k gui/$(id -u)/com.game-host` is still a
restart, not a deploy: it restarts the agent on whatever artifact was last
built, which is the right behaviour for a restart. The old failure mode —
pulling and then forgetting `./deploy.sh`, which looked like a deploy that
silently shipped nothing — is what the hook exists to close.

**Do not run `npm run start:host` by hand here.** It fights the agent for port
4000, and `DATA_DIR` is deliberately unset outside the start script. Do not
run `npm run build` here either while people are playing, for the asset reason
above. Develop in a worktree instead
(`git worktree add ~/Developer/game-host-dev -b <branch>`), which also makes
it impossible for a stray branch to be what an unattended restart deploys.

**Never `pkill -f` on this machine.** Twice on 2026-08-20 a `pkill` aimed at a
worktree's test server matched the agent instead and left the front door
serving 502. The compiled artifact no longer shares a command line with a
`tsx` dev server, which removes that particular collision, but the general
hazard stands: kill background servers by the PID your shell gave you.

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
| Start command | `npm run start:host:compiled` |
| Health check path | `/health` |
| Environment | `DATA_DIR=/var/data`, `NODE_ENV=production`, plus the notification vars below when notifications are wanted |
| Disk | `dsk-d9rafvlbedkc73coe2k0` at `/var/data`; the host creates `acquire/`, `railbaron/`, `wordgame/` and its own `notifications/` beneath it |

**Turn notifications** (`packages/notify`) are configured entirely by env and
are off — not broken — when the vars are absent, so nothing below blocks a
deploy. All of it lives on the service's environment, none of it in the repo:

| Variable | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys; mint once with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:` contact URI push services may use |
| `SMTP_URL` | `smtp(s)://user:pass@host:port` — any provider, none hard-coded |
| `EMAIL_FROM` | The From header on confirmation and turn emails |
| `NOTIFY_ORIGIN` | Absolute origin for links in emails (e.g. `https://acquire-multiplayer.onrender.com`); email stays off without it |
| `NOTIFY_DEBOUNCE_MS` | How long a player must stay away after their turn starts before anything sends (default 60000) |

Push subscriptions, confirmed addresses and once-per-turn markers live under
`DATA_DIR/notifications/`, so they ride the persistent disk and survive a
deploy — losing them would mean re-opting-in every player.

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
- **Every deploy drops every socket.** Clients reconnect on their own — which
  became true on 2026-08-20 and was not before it. `closeSockets` used to call
  `disconnectSockets(true)`, and a socket.io client treats a server-initiated
  disconnect as final, so every deploy left every open page dead until someone
  reloaded it by hand. See the backlog.
- **The start command must be `start:host:compiled`.** `npm run build` emits
  `apps/host/dist/main.mjs`, and the start command runs plain `node` on it —
  no `tsx`, no transpiling three game servers on every cold start. The
  uncompiled `npm run start:host` still works and is what `dev:host` uses;
  running it here would just be slower and would need `tsx` at runtime.

Verify a deploy:

```bash
B=https://acquire-multiplayer.onrender.com
curl -s $B/health                                  # every game
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
