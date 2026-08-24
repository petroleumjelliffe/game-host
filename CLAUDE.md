# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An npm workspace monorepo, and the front door for the machine that hosts game
night. Both are true at once, and neither replaces the other.

It is the host-machine configuration: a Caddy reverse proxy on port 80, one
launchd agent, one start script, and the canonical cross-game port registry.

It is also, as of this migration, where the game code itself lives:

| Path | What it is |
| --- | --- |
| `packages/lobby` | `@game-host/lobby` — the shared lobby package (seating, join/rejoin, presence) that Rail Baron and Acquire both depend on as a workspace package, not a git submodule. |
| `games/marcopolo` | Marco Polo — server (`server/`), client (`client/`), protocol (`protocol/`). |
| `games/railbaron` | Rail Baron — engine, session, server and a React client. |
| `games/acquire` | Acquire — engine, session, server and a React client. Served at `/acquire`; its GitHub Pages deploy is retired. |

`npm install` at the root links all seven workspaces; `npm test` and
`npm run typecheck` at the root cover them all in one command (see Testing,
below).

**Composition and the cutover have both happened** (2026-08-19/20). Every
game exports `mount(ctx)` — it adds its prefixed routes and its own socket.io
server to an app and an HTTP server it does not own — and `apps/host` composes
all three into one process on port 4000, with a menu generated from what
mounted, an aggregate `/health`, one `DATA_DIR`, and a per-game error
boundary. Run it with `DATA_DIR=$(mktemp -d) npm run start:host`.

**That process is what both deployments run**, from the same `main`: this
machine on the LAN behind Caddy, and Render for online play. See
[Deploying](README.md#deploying) — read it before changing anything under
`launchd/`, `start-host.sh`, or the build, because those are live
configuration now rather than authoring.

**The standalone path still works and must keep working.** Each game's
original boot function is still there with its original signature —
`createAppServer()`, `startServer()`, `createServer()` — now a thin wrapper
over its own `mount`, adding back the bare `/health` (and, for Marco Polo, the
root static mount) that only make sense alone in a process. `dev:server` still
boots each game on its own `400N`, which is why 4001–4003 keep their rows in
PORTS.md even though nothing hosts them. All 1600 tests pass against both
arrangements.

| Path | What it is |
| --- | --- |
| `packages/host` | `@game-host/host` — the contract (`HostContext`, `MountedGame`), the error boundary (`guardSocket`, `guardTick`), and `closeSockets`. No game logic. |
| `packages/room-store` | `@game-host/room-store` — where a room lives between processes: atomic staging, per-room write chains, `settled()`, quarantine. Generic over the payload; Rail Baron and Acquire configure it with their record guards ([plan](docs/plans/2026-08-20-room-store.md)). |
| `apps/host` | `@game-host/apps-host` — the composed process, and the only package allowed to depend on all three games. |

## Check whether this clone *is* the host machine

It may well be, and the answer changes what is safe to do. `~/Developer/game-host`
on the game machine is **production**: the `com.game-host` launchd agent builds
and serves from that exact tree, and Caddy fronts it on port 80 for everyone on
the wifi.

```bash
ls -l /opt/homebrew/etc/game-host    # exists and points here? this is the host
launchctl list | grep com.game-host  # an agent? it is serving from this tree
```

**If it is the host machine**, do not write scratch files or check out
branches here, and do not run `npm run build` or `npm run start:host` by hand:
the agent serves `games/*/dist` from disk per request, so a build republishes
production instantly and swaps content-hashed assets out from under loaded
pages, and a by-hand start fights the agent for port 4000. Use a worktree
(`git worktree add ~/Developer/game-host-dev -b <branch>`) — git refuses to
check out `main` twice, which also makes it impossible for a stray branch to
be what an unattended restart deploys. Restarting the agent is fine and needs
no permission: `launchctl kickstart -k gui/$(id -u)/com.game-host`.

**Never `pkill -f` here.** It has taken production down twice (2026-08-20),
both times aimed at a worktree's test server and matching the agent instead.
Kill background servers by the PID the shell gave you. Deploying is `git
pull` on this tree — the installed `post-merge` hook runs `deploy.sh`, which
no longer pulls — and `./deploy.sh` by hand deploys the tree as checked out.
A bare `kickstart` restarts the agent on the artifact that was last built
and does not rebuild anything.

**If it is not**, treat edits to `Caddyfile`, `launchd/`, `saves/` and
`start-host.sh` as configuration authoring: do not expect to smoke-test them,
and do not "fix" the hardcoded `~/Developer/game-host` paths — they describe
the host, not this working copy. The games themselves build and test fine
anywhere.

## Testing

```bash
npm install     # links packages/{lobby,host,room-store}, games/{marcopolo,railbaron,acquire}, apps/host
npm test        # every package's suite, one command: 1768 tests / 179 files

DATA_DIR=$(mktemp -d) npm run start:host   # all three games, one process, port 4000
npm run typecheck
npm run lint    # all seven workspaces, type-aware, one invocation, ~5s
```

`npm test` runs `scripts/test-all.mjs`, which spawns one independent
`vitest run --root <package>` invocation per package rather than a single
`vitest run` with a `projects` array covering them all — deliberately. Vitest 4 removed the old
standalone `vitest.workspace.ts` (`test.workspace` now throws, telling you to
migrate to `test.projects`), and a `test.projects` array that lists
`games/acquire` and `games/railbaron` as directory entries *resolves* — file
counts and environments come out right — but **each project's own
`setupFiles` silently never runs** when that project is itself nested inside
an outer aggregator's `test.projects`. Both games rely on their `setupFiles`
for jest-dom matchers, so this isn't cosmetic: `toBeInTheDocument` and
friends fail across every jsdom test, real failures, easy to mistake for new
bugs in the code itself. `vitest.workspace.ts`/`test.projects` support a
single level of project splitting; the games' own two-project node/jsdom
split is doubly nested when included that way, and doubly nested is the case
that breaks. Confirmed with a `throw` planted at the top of
`games/acquire/src/test/setup.ts`: it fires under `vitest run --root
games/acquire` (setup runs) and never fires when `games/acquire` is a
`projects` entry of an outer config (setup doesn't run). Running each package
as its own top-level `vitest run --root <dir>` sidesteps the whole problem —
each invocation resolves its own nested projects the normal, single-level
way.

`scripts/test-all.mjs` does not spawn every package at once: each vitest
process sizes its own worker pool to the whole machine, so several
full-machine-sized pools contending together oversubscribe badly — enough,
at four, to push railbaron's slowest test past its timeout on contention
alone, no code change behind it. The packages are split by weight rather
than by count: lobby, host, room-store and marcopolo (light) run together, and
railbaron, acquire and apps-host (heavy) run one after another. `apps/host`
is in the heavy group despite having five files — it boots three whole
games per test, so file count is the wrong measure of what a suite costs.
Each package's output is buffered and printed as a single block once that
package finishes, so concurrent suites don't interleave their output but a
fast package's block still shows up before a slower one still running.
Critically, every package runs **regardless of another's outcome** — a
plain `&&` chain would stop at the first failure, hiding whatever the
remaining packages would have said and turning every fix into its own
separate discovery cycle. The script's own exit code is non-zero if *any*
package failed, so CI still gates correctly; the printed summary (one line
per package: pass/fail, exit code, test/file counts, and — distinctly — how
many of those tests failed when the run wasn't clean) says which one(s).

`npm run lint` is the opposite arrangement and deliberately so: **one**
`eslint .` at the root covers all seven workspaces, because
typescript-eslint's `projectService` resolves each file to its own package's
`tsconfig.json`. Do not give this a `--workspaces` fan-out; it would be
slower and buy nothing. Five rules, all errors, all type-aware — the two
promise rules, `await-thenable`, and the two React hooks rules. 386 files in
about five seconds, which is why it can afford to be type-aware at all.

**The rule list is short on purpose, and the reasoning is worth keeping.**
`strictTypeChecked` reports ~1,500 findings on this repo (911 of them
`no-non-null-assertion`); oxlint's defaults report 146, of which 95 are one
false positive firing on the `then:` key of every golden fixture. A gate
that cries wolf is a gate that gets skipped, so rules get added when
something bites rather than inherited by the preset. Two options are load-
bearing: `NavigateFunction` is named in `allowForKnownSafeCalls` (react-router
7 types `navigate()` as `void | Promise<void>`, so 29 ordinary calls would
otherwise read as defects) and `checksVoidReturn.attributes` is off (an async
`onClick` is ordinary React).

**It gates pull requests, never a deploy.** CI runs it as its own job beside
`check`, so neither can hide the other's answer; `npm run build` and
`deploy.sh` are untouched. A type error still fails a deploy — that is
`build`'s typecheck, and it is a different guarantee.

**There is no formatter, and that was measured rather than overlooked.** The
tree is already uniform (1,540 single-quoted imports to 38, semicolons, two
spaces, no tabs); Prettier at the settings closest to that style would still
rewrite 256 of 386 files, +7,077/−3,357, and would fold Rail Baron's
triangular payout table into two different shapes down its own length.
`.editorconfig` covers the drift that actually happens. The full ledger —
including the fact that this gate found **no defects** when it landed, which
is the part most likely to be misremembered — is in
[docs/plans/2026-08-20-the-linter.md](docs/plans/2026-08-20-the-linter.md).

## Git history after the subtree merge

Every game's original commit history was grafted onto this repo with `git
subtree add`, and `git blame` works fully on the result: a merged file's
lines attribute to the commits that actually wrote them (88 of
`games/marcopolo/server/game.ts`'s 90 lines blame to its original authoring
commit, not to the merge). `git log --follow -- <new path>` does **not** work,
though — historical commits record each file at its *old* path
(`server/game.ts`, not `games/marcopolo/server/game.ts`), and `--follow`
can't see across that rename because the subtree merge is not, from git's
point of view, a rename it can detect. For file archaeology, search the old
path across all history instead — but plain `git log --all -- <old path>`
**also** comes back empty, and for a related reason: at the subtree-add merge
commit, the old path (`server/game.ts`) is absent from *both* the mainline
parent and the merge result (the result has it at the new, prefixed path
instead), so git's default merge-history simplification calls that a
TREESAME non-event and prunes the graft parent's whole line out of the
path-limited walk before it ever reaches the pre-migration commits. The
command that actually reaches them is `git log --all --full-history -- <old
path>` — `--full-history` disables that pruning. Confirmed for both Marco
Polo (`git log --all --full-history -- server/game.ts` finds the original
authoring commit `7a7fae9` and the subtree-add commit) and Acquire (`git log
--all --full-history -- engine/gameTypes.ts` finds 11 commits; the plain form
finds 0 for both). Don't conclude the history was lost just because
`--follow` on the new path, or a bare `--all` on the old one, comes back
empty.

## Architecture

**Standalone (development, and the shape each game keeps):** one process per
game serves its own built client, its API, and its socket.io mount — all under
a single port (`400N`) and a single path prefix (`/<game>`). Nothing hosts
this arrangement any more; `npm run dev:server` is what still uses it.

**Caddy never strips the prefix**, and that is still the load-bearing rule:
each game's client is *built* under its base path, so the path forwarded is
the path the game expects. The front door is now a single
`reverse_proxy localhost:4000` with no game names in it, so there is nothing
to keep in sync — but a `handle_path` or a rewrite appearing there would break
every asset URL at once.

**As composed, and as deployed to both origins:** `apps/host` creates one Express app
and one HTTP server, calls each game's `mount(ctx)`, and listens on one port.
Each game keeps its **own socket.io `Server`** at its own path, all attached to
that one HTTP server. The alternative — one `Server` with a namespace per game
— was rejected: Marco Polo's `gameHandlers.ts` broadcasts by iterating
`io.sockets.sockets`, which under a shared server would walk all three games'
sockets twenty times a second, still correct but coupled in a way nothing in
the code would warn about.

Three things about sharing an HTTP server are invisible until they bite, and
all three are commented where they live:

- **`destroyUpgrade: false`** on every game's `Server`. engine.io chains
  `request` listeners across attached engines but installs `upgrade` listeners
  additively, so every engine sees every upgrade and non-matching ones arm a
  timer to destroy the socket. It fires only if nothing has been written after
  a full second, which is why no test on localhost can reproduce it — see the
  "As built" section of the composition plan for the experiment.
- **`serveClient: false`**, because the alternative splices a file-serving
  handler into the *shared* server's request listeners.
- **Never `io.close()` in a mounted game.** It closes the HTTP server it
  attached to — the host's. `packages/host/close.ts` does the scoped version;
  whoever created the server is the only thing that closes it.

Clients are origin-relative: they address pages, assets, and sockets as paths
off `window.location.origin`, so no client names a host or port
([specs/2026-08-17-origin-relative-clients.md](specs/2026-08-17-origin-relative-clients.md),
implemented 2026-08-18). Ports are machine-only knowledge, and as of
2026-08-20 **no build in this repo names an origin either**: Acquire's
`.env.production` was the last holdout and is gone.

**So all three games are same-origin only, and carry no CORS at all** (since
2026-08-21 — [the CORS plan](docs/plans/2026-08-21-cors.md)). Rail Baron and
Acquire ran `origin: '*'` left over from being separate repos on separate
origins; Marco Polo never had any, which is what made the answer obvious.
Nothing needs it: there is not one `fetch()` in any client, and the only HTTP
routes a game registers are `/health` and its static assets.

**Do not read that as origin-locked sockets.** Browsers do not apply CORS to
the WebSocket handshake — socket.io's `cors` option only ever governed the
long-polling transport — so a page on another origin can still open a socket,
exactly as it could before. Restricting that needs `allowRequest` on each
`Server`, which was considered and declined: LAN games, no cookie auth,
nothing an ambient-authority request could steal, and a real risk of locking
out a living room that reaches the host by IP or `.local` name.

Two consequences for anyone changing this. A test that connects from a
"disallowed" origin and expects failure **cannot fail** — `socket.io-client`
under Node does not implement the same-origin policy, so every wire test here
passes under any policy; assert response headers instead, as
`apps/host/routes.test.ts` and both games' `staticClient.test.ts` now do. And
adding `cors()` back to one game would put its headers on that game's routes
only if it is scoped to `BASE_PATH` — global middleware in a composed process
leaks onto the other two games and the menu, which is the bug that scoping
originally fixed.

The `VITE_SERVER_URL` code path stays, but **nothing feeds it any more** —
that sentence used to name the Pages client as the one build that did, and
the cutover's Tasks 2 and 3 ended it (verified 2026-08-21: no `.env*` in any
game sets it, and Render builds from this repo). It survives in
`games/*/src/config.ts` and `src/net/connection.ts` as the only seam that
would let a client address a server on another origin again, which costs
nothing to keep and would be a decision to remove. When it is set the client
uses socket.io's default socket path, and a server would need
`SOCKET_PATH=/socket.io` to match.

Why the file had to go: a baked-in origin makes one artifact serve exactly one
deployment, and there are two production deployments now — this machine for
in-house play, Render for online. The LAN build was serving its pages locally
and its sockets from Render. Origin-relative means the answer to "which
server" is decided at request time by whoever served the page, so the same
artifact serves both, and a third costs nothing.

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
git pull                             # deploy to the LAN (post-merge hook runs deploy.sh)
./deploy.sh                          # deploy the tree as checked out, no pull
launchctl kickstart -k gui/$(id -u)/com.game-host               # restart only, no rebuild
launchctl list | grep com.game-host                             # is it up
tail -f /opt/homebrew/var/log/game-host.log                     # what it is doing

curl -s localhost/health             # all three games, one request
curl -s localhost/                   # the generated menu

caddy validate --config Caddyfile    # after any Caddyfile edit
brew services restart caddy          # reload the front door

./install-services.sh                # (re)install + start the launchd agent
./install-services.sh remove         # stop and uninstall
```

**`kickstart` is a restart, not a deploy — this is the one habit to unlearn.**
Until 2026-08-20 the agent built at boot, so `git pull` plus a kickstart was
the whole deploy. The build moved to `deploy.sh` (that is what took the
restart outage from 2.3s to ~0.2s), and the agent now execs a prebuilt
`apps/host/dist/main.mjs`. A kickstart therefore restarts on **whatever was
last built**, which is correct behaviour for a restart. Forgetting
`./deploy.sh` after a pull used to look like a deploy that shipped nothing —
no error, no warning, `/health` reporting the old build's versions,
truthfully — which is why the pull moved out of `deploy.sh` and into the
`post-merge` hook the same day: on this tree, `git pull` *is* the deploy,
and the forgettable second command is gone.

One agent, `com.game-host`, one log at `/opt/homebrew/var/log/game-host.log`.
Stop it with `launchctl bootout gui/$(id -u)/com.game-host`; start it again by
rerunning the installer. There is no per-game agent, log, or menu file any
more — the menu is generated from what mounted, so adding a game edits no
front-door configuration at all.

Deploying to Render is a `git push`: the service auto-deploys on every commit
to `main`, and that did not change when the server started being compiled —
only its start command did (`npm run start:host:compiled`, plain `node` on the
bundle). Both deployments and their gotchas are in
[README.md](README.md#deploying) — in particular that a Render **pre-deploy
command cannot see the persistent disk**, which is how a room migration
reported success and moved nothing.

### What "compiled" covers, and what it does not

**The server, and only the server.** The three clients were always compiled;
Vite has built them to `games/*/dist` from the start. What ran uncompiled was
the server — `tsx` transpiling 57 files of three game servers and two shared
packages at every boot, 478ms of it. `apps/host/build.ts` bundles that with
esbuild to one `apps/host/dist/main.mjs` (179ms to a served `/health`), and
`npm run build` emits it alongside the clients.

Three consequences worth carrying into any change here:

- **`npm run build` typechecks first.** That is new, and it is what makes a
  type error fail a deploy rather than boot and serve — verified both ways, a
  planted `const x: number = "…"` used to build clean under Vite and run
  happily under `tsx`. It costs ~9s, which was unaffordable while the build sat
  in the service start path and is free now that it does not.
- **`tsx` is a `devDependency` everywhere.** The bundle's whole external
  surface is `express`, `socket.io` and node builtins. (`cors` was on that
  list until 2026-08-21 and is not any more — see
  [the CORS plan](docs/plans/2026-08-21-cors.md). It is still *installed*,
  because socket.io depends on it; nothing of ours imports it.) Do not add a
  runtime import that is not a production dependency of the package importing
  it.
- **A bundle erases module locations**, which is why every game resolves its
  client through `import.meta.resolve('@game-host/<name>/package.json')` rather
  than `import.meta.url`. `apps/host/compiled.test.ts` boots the compiled host
  and reads those paths back; it is the gate on this whole arrangement, and it
  builds through the exported `hostBuildOptions` rather than a copy so it
  cannot pass while the shipped build resolves something else.

## The port registry is canonical here

[PORTS.md](PORTS.md) is the source of truth (server `400N`, dev client
`7930+N`, path `/<name>`), and it lives next to the Caddyfile because that file
is the enforcing consumer — a collision fails here first. Each game *also*
hardcodes its own two numbers as defaults so it boots with this repo absent.
When a number changes, PORTS.md changes first and the games follow; its "known
consumers" list names the exact files in each game repo to update.

A game's proxy path must equal its client's built base path, because assets are
requested at `<base>/assets/…` and nothing rewrites them. Acquire's path used to
be its long GitHub Pages repo name for exactly that reason; it is `/acquire`
since 2026-08-20, and `apps/host` redirects the old one permanently with the
suffix intact, because a room code is the thing people paste to each other.

## Adding a game

Follow the five-step checklist at the end of [README.md](README.md): claim the
dev slot pair in PORTS.md, point the game's own config at its numbers, build
its client under its path prefix, export `mount(ctx)` returning a
`MountedGame`, and add one row to `GAMES` in
[apps/host/host.ts](apps/host/host.ts).

**No Caddyfile edit, no menu edit, no start script, no plist.** The front door
forwards one port and knows no game names, the menu and the aggregate
`/health` are generated from what mounted, and one agent runs the lot. Those
deletions were the point of the composition work — if a change asks you to
edit the Caddyfile to add a game, something has gone backwards.

## Docs conventions

Specs and plans (`specs/`, `docs/plans/`) are dated and carry an explicit
status; implemented specs get an "As built" section recording deltas from the
design rather than being rewritten. Prose here is deliberately narrative and
explains *why* — comments in the Caddyfile, plists, and scripts carry the
reasoning and sometimes the date a problem was found. Match that voice; when
you change a load-bearing line, update the comment that explains it.
