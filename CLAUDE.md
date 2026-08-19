# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An npm workspace monorepo, and the front door for the machine that hosts game
night. Both are true at once, and neither replaces the other.

It is the host-machine configuration: a Caddy reverse proxy on port 80, a
static menu page, launchd agents, start scripts, and the canonical cross-game
port registry — none of that moved.

It is also, as of this migration, where the game code itself lives:

| Path | What it is |
| --- | --- |
| `packages/lobby` | `@game-host/lobby` — the shared lobby package (seating, join/rejoin, presence) that Rail Baron and Acquire both depend on as a workspace package, not a git submodule. |
| `games/marcopolo` | Marco Polo — server (`server/`), client (`client/`), protocol (`protocol/`). |
| `games/railbaron` | Rail Baron — engine, session, server and a React client. |
| `games/acquire` | Acquire — engine, session, server and a React client; still deploys to GitHub Pages under `/acquire-startups-m1`. |

`npm install` at the root links all four workspaces; `npm test` and
`npm run typecheck` at the root cover all four in one command (see Testing,
below).

**Composition has *not* happened yet.** The three games still run as three
separate processes, each on its own port (`400N`), each serving its own built
client under its own path prefix, with Caddy routing `/<game>/*` to the right
port. There is no `apps/host`, no `mount()`, nothing that runs them as one
process — that is a later plan's job. Until it lands, PORTS.md's six numbers
(three server, three dev-client) are all still real; see PORTS.md for the
one-line note on what changes when composition does.

## This clone is not the host machine

Every script, plist, and the README assume the repo is cloned at
`~/Developer/game-host`. This checkout is at `~/Developer/personal/game-host`,
and neither Caddy nor the `/opt/homebrew/etc/game-host` symlink exists here.
Treat edits to `Caddyfile`, `menu/`, `launchd/`, `saves/` and the `start-*.sh`
scripts as configuration authoring; do not expect to run or smoke-test them
locally, and do not "fix" the hardcoded `~/Developer/game-host` paths unless
asked — they describe the host, not this working copy. The games themselves
(under `games/` and `packages/`), by contrast, build and test fine right here
— see Testing, below.

## Testing

```bash
npm install     # links packages/lobby, games/marcopolo, games/railbaron, games/acquire
npm test        # every package's suite, one command: 1548 tests / 145 files
npm run typecheck
```

`npm test` runs `scripts/test-all.mjs`, which spawns four independent
`vitest run --root <package>` invocations rather than one `vitest run` with a
`projects` array covering all four — deliberately. Vitest 4 removed the old
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

`scripts/test-all.mjs` does not spawn all four at once: each vitest process
sizes its own worker pool to the whole machine, so four full-machine-sized
pools contending together oversubscribe by roughly 4x, which was enough to
push railbaron's slowest test past its timeout on contention alone, no code
change behind it. Lobby and marcopolo (the two light suites) run together;
railbaron and acquire (the two heavy ones) run one after the other — at most
three full-machine-sized pools contending at once, never four. Each
package's output is buffered and printed as a single block once that
package finishes, so concurrent suites don't interleave their output but a
fast package's block still shows up before a slower one still running.
Critically, every package runs **regardless of another's outcome** — a
plain `&&` chain would stop at the first failure, hiding whatever the
remaining three packages would have said and turning every fix into its own
separate discovery cycle. The script's own exit code is non-zero if *any*
package failed, so CI still gates correctly; the printed summary (one line
per package: pass/fail, exit code, test/file counts, and — distinctly — how
many of those tests failed when the run wasn't clean) says which one(s).

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
