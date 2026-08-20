# Compile the host

**Status:** implemented, 2026-08-20. All four tasks run; merge and the
Render dashboard edit are outstanding.
**Follows:** [2026-08-19-cutover.md](2026-08-19-cutover.md), which deferred this
as "Compiling `apps/host` — measure first; the spec says so and it is still
right." This is that measurement, and it moved two of the spec's assumptions.

## What was measured

On the game machine, in a worktree, `n=5` per row, median of time from
`spawn()` to the first `/health` that answers 200 — not to the log line, which
is printed before the listener is warm.

| Boot path | Median | All runs |
| --- | --- | --- |
| `tsx apps/host/main.ts` — what both deployments run today | **478ms** | 462, 469, 478, 491, 731 |
| `node` on a precompiled bundle of the same graph | **134ms** | 134, 134, 134, 139, 175 |

`tsx` transpiles **57 source files / 258kb** of our own server code at every
cold start — three game servers plus the two shared packages — and that is
what the 344ms difference buys back. The bundle was produced with esbuild,
`node_modules` left external, so both rows load the same express and the same
socket.io; the delta is transpilation and nothing else.

Two supporting numbers, because they decide *where* the work goes rather than
whether:

| | |
| --- | --- |
| `npm run build` (three Vite clients) | 1.65s |
| `npm run typecheck` (six workspaces) | 9.1s |

These corroborate the backlog's 2.3s restart measurement: 1.65s build + 0.6s
boot. Nothing here contradicts what was already recorded.

## The finding that matters more than the milliseconds

**A type error in server code ships today, and nothing catches it.** Verified
rather than assumed — a `const _probe: number = "definitely not a number"`
planted in `apps/host/menu.ts`:

- `npm run build` **passed**. The root build is `vite build` per workspace, and
  Vite does not typecheck.
- `npm run start:host` **booted and served all three games**. `tsx` strips
  types; it does not check them.

`npm run typecheck` is a separate command that `start-host.sh` never runs and
no CI runs either. So the only thing standing between a type error and the LAN
is somebody remembering to type nine seconds of command. `tsc` emit fails on
that error by construction, which is the real argument for this work — the
344ms is the smaller half.

## Two spec assumptions that did not survive contact

**1. Rail Baron's NodeNext split is not the prerequisite the spec called it.**
Phase 0 item 3 says its server "runs only because tsx patches Node's resolver
to accept extensionless ESM imports; plain `node` would reject them, which
blocks compiling `apps/host` later." Still true as written —
[games/railbaron/tsconfig.json:5](../../games/railbaron/tsconfig.json#L5) is
`moduleResolution: "bundler"` and its server imports are extensionless — but it
only blocks the `tsc`-emit route. esbuild resolves extensionless imports the
same way tsx does, so a bundled emit never asks the question. That turns a
required refactor of the one game with no known bugs into an optional one.

**2. Compiling does not retire `--include=dev`.** The spec says a compiled
server "needs no toolchain at runtime at all", and that half is right: `tsx`
leaves `dependencies`. But `--include=dev` is a *build-time* flag, and Render
still builds three Vite clients — `vite`, `typescript`, `@vitejs/plugin-react`
and Acquire's `tailwindcss`/`postcss`/`autoprefixer` all stay in
`devDependencies` and all are still needed. The dependency question gets
smaller, not answered.

## The blocker nobody wrote down

**All three games locate their built client from their own module's location**,
and compilation is precisely the operation that invalidates that:

| | |
| --- | --- |
| [games/marcopolo/server/app.ts:42](../../games/marcopolo/server/app.ts#L42) | `join(dirname(fileURLToPath(import.meta.url)), '../client/dist')` |
| [games/railbaron/server/index.ts:43](../../games/railbaron/server/index.ts#L43) | `resolvePath(dirname(fileURLToPath(import.meta.url)), '..', 'dist')` |
| [games/acquire/server/index.ts:76](../../games/acquire/server/index.ts#L76) | `join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')` |

Each comment defends the choice, and each is right about the thing it was
defending — "resolved from this module's location, never the working
directory: a service's cwd is wherever its plist says." That reasoning holds.
What it did not anticipate is a third case where the module's own location is
not where the source was:

- **`tsc` with an `outDir`** moves the emitted module to a different depth, so
  `../dist` climbs out of the wrong tree.
- **A bundle** collapses all three modules into one file, so all three compute
  the *same* wrong path.

There is no emit shape where module-location inference survives. This is the
actual work of the plan; the emit itself is a build script.

**The fix, as proposed:** `distDir` joins `dataDir` on `HostContext` —
absolute, allocated by the host, injected per game, for exactly the reason
`dataDir` already is.

**The fix, as built** (2026-08-20): not that. Writing the test first is what
killed it. Injection from the host requires the host to know each game's
client layout, and the layouts differ — Marco Polo builds to `client/dist`,
the other two to their package root. `dataDir` can be a host decision because
the host genuinely chooses it; a dist path is a fact about the game, and
moving it into `apps/host` would have put a per-game detail in the one file
whose entire promise is that adding a game is one row.

Each game resolves its own package root by name instead:

```ts
const DEFAULT_DIST = fileURLToPath(
  new URL('dist', import.meta.resolve('@game-host/railbaron/package.json')),
);
```

That asks the same question the host's own `@game-host/railbaron/server/index.js`
import already asks, so the answer is true from anywhere — inside the package
under `tsx`, and from a bundle three directories away. It needed one line per
game: an explicit `"./package.json": "./package.json"` entry in `exports`,
because the existing `"./*": "./*.ts"` pattern otherwise rewrites the request
to `package.json.ts` and resolves a file that does not exist. `import.meta.resolve`
survives esbuild untouched, which the suite proves rather than assumes.

No contract change, no new required field for a fourth game, and the
standalone and composed paths stay identical rather than diverging by one
parameter.

## The change this unlocks, which is bigger than either half

Compiling and backlog item 2 are the same change.

`start-host.sh` runs `npm run build` *after* the old process is gone, so every
deploy and every crash-restart is a 2.3s outage. It is written that way on
purpose — "a service restarted after a `git pull` should serve the code that
was pulled" — and that purpose is served just as well by building *before*
stopping anything. With a compiled artifact:

| | today | after |
| --- | --- | --- |
| service start path | `npm run build` (1.65s) + `tsx` boot (0.48s) | `node` boot (0.13s) |
| restart outage | **2.3s** | **~0.15s** |
| type errors | ship silently | fail the deploy |
| what serves if the build breaks | nothing — the old process is already gone | the previous artifact, still running |

That last row is the one to notice. Today a broken build is discovered by the
front door returning 502; with the build moved ahead of the stop, a broken
build is discovered while the old version is still serving.

It does not close the socket.io backoff window — a client that fails at t=0
still waits out its retry — so backlog item 1 is still what makes the
remaining gap survivable. But ~0.15s is short enough that most clients will
not notice one at all.

## Tasks

1. ~~**`distDir` on `HostContext`.**~~ **Done 2026-08-20**, by the different
   route above. `apps/host/compiled.test.ts` is the gate: it bundles the real
   composition into a directory at a different depth, boots it under plain
   `node`, and reads back which dist directory each game resolved. It failed
   the way the analysis predicted and slightly worse — Rail Baron and Acquire
   both reported `apps/host/dist`, the same wrong path, because a bundle gives
   them the same module location.

   Marco Polo needed one thing more: it was the only game that never logged
   which client it was serving, so it was also the only one the test could not
   check. It says now, in the same words as the other two. "Which build is
   this?" being unanswerable for exactly one game is the sort of asymmetry
   that stays invisible until it is the one you need.

   Nothing about the build changed and `tsx` still runs everything — this task
   only removes a path inference that was always going to break something.
   1604 tests pass; all three games still serve their client under `tsx`.
2. ~~**Emit.**~~ **Done 2026-08-20.** `apps/host/build.ts` bundles with
   esbuild to `apps/host/dist/main.mjs`, sourcemaps on, `node_modules`
   external and every `@game-host/*` source inlined. 33ms. `npm run
   start:host:compiled` runs it with `--enable-source-maps`; the default
   `start:host` still runs `tsx`, and **neither deployment's start command
   changed** — that is Task 3.

   Re-measured on the shipped artifact rather than the throwaway bundle:

   | | median, spawn to a served /health |
   | --- | --- |
   | `tsx apps/host/main.ts` | 478ms |
   | compiled, `--enable-source-maps` | **179ms** |
   | compiled, no source maps | 153ms |

   Readable stack traces cost 26ms of boot, which is not a trade worth
   thinking about twice.

   `hostBuildOptions` is exported and `compiled.test.ts` builds through it, so
   the suite exercises the shipped configuration rather than a copy. That is
   load-bearing: every bug this suite catches is a consequence of how modules
   get resolved and merged, so a test bundling by its own rules could pass
   green while the real build resolved something else.

   The suite gained the check the analysis had not asked for and should have.
   Every game's `mount` is emphatic that three socket.io servers on one HTTP
   server is a delicate arrangement — `destroyUpgrade: false`,
   `serveClient: false`, never `io.close()` — and every one of those hazards
   is module-level wiring that a bundler may reorder and deduplicate. Nothing
   about bundling *should* disturb it, and "should" was doing enough work
   there to deserve a real client: the compiled host now takes a websocket
   connection on each game's own socket path, one at a time so a failure
   cannot land on whichever game lost a race. 1606 tests pass.

   **The `tsc --noEmit` gate moved to Task 3**, deliberately. It belongs with
   the emit, but `npm run build` is still inside the service start path today,
   and 9.1s of typechecking there would take the restart outage from 2.3s to
   over eleven. The gate is affordable exactly when the build stops being
   something a restart waits for, and not one commit before.
3. ~~**Move the build out of the service start path.**~~ **Done 2026-08-20.**
   `start-host.sh` execs `node` on the artifact; the new `deploy.sh` pulls,
   installs, builds and only then restarts, so everything that can fail
   happens while the old version is still serving. Restart outage 2.3s →
   ~0.2s. The root `build` script now runs `npm run typecheck` first, and that
   gate was verified the way the hole was: a planted
   `const _probe: number = "definitely not a number"` used to build clean and
   serve, and now fails the build naming `menu.ts(71,7)`.

   `exec node`, not `exec npm run start:host:compiled`, and that turned out to
   matter. Chasing backlog item 3 under scratch launchd agents showed its
   diagnosis was wrong: **npm is not the culprit, `tsx` is.** npm running
   `node` directly reports a signalled child as `-15` and launchd restarts it.
   The agent's real chain was `sh -> npm -> tsx -> node`, `pkill -f "tsx
   apps/host/main.ts"` matches the *tsx wrapper*, and `tsx` treats SIGTERM as
   a graceful shutdown and exits 0 — which npm faithfully reports, and which
   `SuccessfulExit: false` reads as a clean stop. A scratch agent running that
   exact chain reproduced `-  0  <label>` first try.

   With no wrapper the tracked PID is the server itself, and SIGKILL now
   restarts it (verified on the real artifact). A SIGTERM still does not, and
   should not: `bootout` stops a service by sending SIGTERM and `main.ts`
   drains and exits 0, so nothing can tell a deliberate stop from a stray
   `kill` without breaking the deliberate one. Backlog item 3's remaining
   half is an operational rule, not a code fix — never `pkill -f` on the host.

   **Render needs a dashboard edit** to finish this task: start command
   `npm run start:host` → `npm run start:host:compiled`. Merging before that
   edit is safe — the old start command still works, since Task 4 has not run.
4. ~~**`tsx` leaves `dependencies`.**~~ **Done 2026-08-20.** Moved to
   `devDependencies` in all four packages that declared it — `apps/host` and
   the three games, which use it for `dev:server` and the standalone boot.

   Checked rather than asserted: the shipped bundle's entire external surface
   is `cors`, `express`, `socket.io` and node builtins, and all three are
   production dependencies of the packages that need them. Nothing the server
   loads at runtime is a dev dependency any more.

   `--include=dev` still does not go away — Render builds three Vite clients,
   and that is a build-time need. What changed is that the *runtime* no longer
   has one.

## Deliberately not in this plan

- **Rail Baron's NodeNext split.** Optional under a bundled emit, per above. It
  is still worth doing — it is the one game whose server typechecks under
  `bundler`, and that asymmetry will confuse somebody — but it is a separate
  commit with a separate justification, not a prerequisite for this one.
- **Aligning the nine divergent dependency ranges.** Acquire lags on every one
  of them (`express ^5.1.0`, `socket.io ^4.8.1`, `tsx ^4.20.6`,
  `react-router-dom ^7.9.4`). Every range is caret-compatible and npm hoists
  exactly one physical copy of each, so nothing differs at runtime today —
  verified. It is a manifest-honesty problem, not a behaviour problem, and it
  wants its own commit and its own full-suite gate.
- **A linter.** Deferred a fifth time, for the fifth time's reason.
