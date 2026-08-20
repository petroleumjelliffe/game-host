# Compile the host

**Status:** proposed, 2026-08-20. Measured, not started.
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

**The fix, proposed:** `distDir` joins `dataDir` on `HostContext` — absolute,
allocated by the host, injected per game, for exactly the reason `dataDir`
already is. The standalone wrappers keep their current `import.meta.url`
default, because standalone still runs unbundled under `tsx` and the
inference is still correct there. That keeps the promise the CLAUDE.md makes —
"the standalone path still works and must keep working" — without a second
code path in the games: one parameter, defaulted where it can be inferred,
required where it cannot.

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

1. **`distDir` on `HostContext`.** Contract, host allocation, three games,
   standalone wrappers keep their inferred default. Tests first — the
   composition suite can assert each game serves its own `index.html` from a
   directory the host chose. No emit yet, nothing about the build changes, and
   `tsx` still runs everything. This task is independently correct: it removes
   a path inference that was always going to break something.
2. **Emit.** esbuild bundle per the measurement above, sourcemaps on, output
   under `apps/host/dist/`. `tsc --noEmit` becomes the gate that runs *with*
   the emit rather than beside it, so a type error fails the build.
3. **Move the build out of the service start path.** `start-host.sh` execs the
   artifact; a deploy step builds it. Closes backlog item 2, and is what makes
   the type gate affordable — 9.1s of `tsc` in the restart path would make the
   outage five times worse, and in a deploy step it costs nothing anyone sees.
4. **`tsx` leaves `dependencies`.** It stays in `devDependencies` for
   `dev:server` and `dev:host`. Render's start command stops needing it at
   runtime.

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
