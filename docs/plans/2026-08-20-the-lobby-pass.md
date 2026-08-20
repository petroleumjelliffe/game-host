# The lobby pass

**Status:** proposed, 2026-08-20.
**Follows:** [2026-08-19-cutover.md](2026-08-19-cutover.md)'s "Deliberately not
in this plan" (a shared remembered name, `packages/room-store`) and
[backlog.md](../backlog.md) item 1's "The shared extraction — deferred on
purpose" (the answer timeout). Those three were deferred separately and
deliberately, each with the same reasoning: a shared API touched by all three
games makes the diff unreviewable during a migration. The migration is over.
The backlog also says they should be designed together rather than three
reactive times, and this is that.

It picks up a fourth thing the backlog does not name, because it only became
visible while verifying item 1: **the three games' test infrastructure has
diverged in a way that is now hiding bugs.**

## Prerequisite: the LAN is serving a stale bundle

PRs #1, #2 and #3 are all merged. The reconnection fix (`packages/host/close.ts`,
`io.engine.close()` alone) is on `main`.

**It is not on the machine.** `apps/host/dist/main.mjs` was built at 18:51 and
the merge landed at 19:28, so the deployed bundle still contains
`disconnectSockets(true)` — verified by grepping the artifact, not inferred
from timestamps alone. Every open page is still being told never to come back
on every restart.

This is the `kickstart`-is-not-a-deploy trap that
[the compile plan](2026-08-20-compile-the-host.md) predicted, arriving within a
day of being written down, and it is worth recording as a sighting: there is no
error and no warning, and `/health` answers 200 the whole time.

**`./deploy.sh` before anything in this plan starts.**

## What is already shared, and is not the problem

Worth stating first, because "three games, three lobbies" is the wrong mental
model and would send this work somewhere useless.

| | |
| --- | --- |
| `packages/lobby/server/rooms.ts` | 172 lines, 9 seating tests |
| `packages/lobby/server/handlers.ts` | 324 lines |
| `packages/lobby/client/useLobbyRoom.ts` | the whole connect → join → lobby machine, used by all three games |
| `packages/lobby/client/view.ts` | 20 tests |
| `packages/lobby/client/identity.ts` | `createIdentityStore(appId)`, used by all three |

`server/genericConsumer.test.ts` goes further than most shared code manages: it
instantiates the registry over a room that is deliberately *not* `GameRoom`,
with a seat space deliberately unlike Acquire's, so the lobby growing a
requirement only one consumer satisfies goes red before the lift does.

So the lobby core is shared and it is tested. **What has drifted is
everything around its edges** — the test harness underneath it, the timeout in
front of it, and the store behind it. That is what this plan is about, and it
is a smaller, more specific claim than "unify the lobbies".

## The finding: one problem, four incompatible answers

Every one of these exists to make `localStorage` work under jsdom, given that
Node ships an experimental `globalThis.localStorage` that reads `undefined`
without `--localstorage-file` and shadows jsdom's real one.

| Where | Strategy | Size |
| --- | --- | --- |
| `packages/lobby/vitest.config.ts` | `execArgv: ['--no-experimental-webstorage']` — **turns the cause off** | 1 line |
| `games/railbaron/src/test/setup.ts` | bridges `globalThis.jsdom.window.localStorage` onto `globalThis` | 16 lines |
| `games/acquire/src/test/setup.ts` | replaces the descriptor with an `Object.create(null)`-backed in-memory shim | 82 lines, ~45 of them comment |
| `games/marcopolo/vitest.jsdom.setup.ts` | assigns `window.localStorage` if it is falsy | 17 lines |

They do not merely differ in style. **They disagree about what is broken.**
Rail Baron's comment says jsdom's real storage exists and is simply not
bridged. Acquire's says the descriptor is Node's own, that it is present in the
`node` project too, and — at length, and correctly — that a probe cannot tell
the difference without firing the experimental warning. Marco Polo's says
`window.localStorage` may be absent. And the lobby's says none of it matters if
you pass one flag.

They also differ in *behaviour*, which is the part that can produce a wrong
test result rather than an ugly one:

- Acquire's store is a module-level `Object.create(null)` and **nothing clears
  it between test files** in the same worker. Rail Baron's is jsdom's real
  `Storage`, which the environment resets. Two games' storage tests have
  different isolation guarantees and neither file says so.
- Marco Polo's guard is `!window.localStorage`. Under jsdom, `window.localStorage`
  is a real `Storage` — so the branch may never execute. **This is very
  possibly dead code**, and the plan below settles it by measurement rather
  than by reading.

The lobby's answer is the right one and it is already in the repo. It is the
one strategy that removes the cause instead of papering over it, and the games
have not adopted it only because nobody noticed it existed.

## The second finding: Marco Polo cannot render a component

It is the only game without `@testing-library/react`:

| | react | jest-dom | user-event |
| --- | --- | --- | --- |
| Rail Baron | ^16.3.2 | ^7.0.1 | ^14.6.3 |
| Acquire | ^16.3.0 | ^6.9.1 | — |
| **Marco Polo** | **—** | **—** | — |

This is not "Marco Polo has no tests". It has 15 files and a node/jsdom project
split, and its 8 client tests are real — `router`, `camera`, `interpolate`,
`sessionState`, four render modules. Every one of them is pure logic, because
pure logic is all it can test.

The cost is already on the record. Yesterday's create-room fix
([backlog](../backlog.md) item 1) shipped for Acquire with a test — the sibling
of the rejection test that was already there — and shipped for Marco Polo with
the note "still no component test … verified in a browser against the real
build instead."

That browser session is what found `disconnectSockets`. So the gap has now cost
once and paid once, which is a good argument for closing it and a poor argument
for pretending the browser was wasted.

## Tasks

Ordered so each one makes the next cheaper, and so the cheapest provable thing
goes first.

### 1. One localStorage answer, not four

Adopt the lobby's `--no-experimental-webstorage` in each game's jsdom project
and delete all three shims.

**Unverified premise, and it decides the task:** `execArgv` is documented at
the top level and requires `pool: 'forks'`. Whether it applies **per project**
under Vitest 4 is not established, and this plan does not assume it. Establish
it first, with the same method the last plan used — plant something that must
fail. Set the flag on one game's jsdom project, delete that game's shim, and
run the storage tests. If they pass, the flag reached the worker; if they fail
on the experimental global, it did not.

If it does not apply per project, the fallback is not a fourth strategy: hoist
`execArgv` to the game's root `test` block (it is process-level, so it is safe
to share between the `node` and jsdom projects — unlike `setupFiles`, which is
exactly why Rail Baron and Acquire both refuse a root-level one), and only if
*that* fails does a shared setup file become the answer.

Marco Polo's shim gets a `throw` planted in its branch first, to settle whether
it has ever run. Record the answer in the commit message either way — a
17-line polyfill that has never executed is worth knowing about, and worth not
copying into the next game.

**Done when:** three files are gone, one line replaces them, and every storage
test still passes — including `games/railbaron/src/state/storage.test.ts` and
`games/acquire/src/net/identity.test.ts`, which are the ones with something to
lose.

### 2. `@testing-library/react` into Marco Polo

At Rail Baron's versions (`^16.3.2` / `^7.0.1`), not Acquire's — Acquire lags on
jest-dom by a major, and the dependency-alignment pass that follows this one
will be moving it up anyway. Do not add a third version line to a list this
plan is meant to shorten.

The first test is the one that should already exist: **`HomeScreen` disables
HOST A GAME and says `CONNECTING…` while the connection is not open**, which
shipped yesterday verified only by eye. Its sibling is Acquire's
`OnlineLobbyPage.test.tsx:99`, "recovers from a rejection instead of hanging on
'Creating…' forever" — the same shape against a different screen.

**Done when:** Marco Polo has a component test that fails if the status gate is
removed. Verified by removing it.

### 3. The shared answer timeout

The last piece of [backlog](../backlog.md) item 1 still open: connected but
silent. All three games hand-rolled this; two of the three were wrong when it
was written down.

| Game | today | tested |
| --- | --- | --- |
| Rail Baron | 8s timeout, `src/OnlineApp.tsx:77` — the reference | — |
| Acquire | `NO_ANSWER_MS = 8000`, `src/pages/OnlineLobbyPage.tsx:28` | yes, `OnlineLobbyPage.test.tsx:124` |
| Marco Polo | status gate only — covers disconnected, not silent | after task 2 |

**The design constraint is already recorded and must be honoured:** it does not
go inside `createLobbyConnection`. That interface documents itself as untested
on purpose — "a test that stubs `io()` and asserts `emit` was called would
restate this file rather than check it" — and burying a timeout in it inherits
that untestability, which is precisely how two of the three hand-rolled
versions came to be written without tests.

So: a pure module beside it in `packages/lobby/client`, taking the ask and the
two answer channels as arguments, testable with no socket at all.

Rail Baron adopts it too. It is the one game with no bug here, and dragging it
into a shared API was the stated reason for deferring this during the cutover —
that reason expires with the migration, and leaving it on its own copy would
mean shipping a shared timeout that only two of three consumers use, which is
the worst of both.

### 4. One remembered name

`createIdentityStore(appId)` keys the name as `${appId}.name`, so a player who
types their name in Rail Baron is anonymous in Acquire. Three games, one
machine, one evening, one person — the split is an artifact of three separate
repos that no longer exist.

The store is shared already, so this is one key, not a refactor. What it needs
that a one-line change does not: a **migration**, because everyone who has
played has a name under the old per-game key. Read the new key, fall back to
whichever old key has one, and write the new one forward.

`identity.ts` already carries the precedent for exactly this shape — the emoji
migration in `rememberedName()`, which is documented as "a migration rather
than a rule". Match that voice and say when and why.

### 5. A wire-level conformance suite — scoped by its first result

The pitch was "one lobby suite run against all three mounts". The evidence
does not fully support the strong version, and it is worth saying so rather
than building the pitch: `genericConsumer.test.ts` already proves the registry
generically, and `client/view.test.ts` covers the view. The registry is not the
gap.

**The wire is.** Each game mounts the lobby handlers itself, and only Acquire
tests what comes back over a real socket:

| Game | lobby-over-the-wire coverage |
| --- | --- |
| Acquire | `lobbySeat.test.ts`, `oneSeatPerSocket.test.ts`, `clientOverWire.test.ts` — seat naming, rename, re-seating, `noSuchRoom`, refused tokens |
| Rail Baron | one assertion, `gameSocket.test.ts:128`, "hands a creator who joins on the same socket their own seat back" |
| Marco Polo | none — `wire.test.ts` is one happy path: "creates, joins, begins, filters, moves, calls" |

Rail Baron's single assertion and Acquire's "re-seats the socket it already
knows rather than adding a player" are the same claim written twice in
different words. Marco Polo makes neither.

**Do not build all three at once.** Export one conformance suite from
`packages/lobby` that takes a mount and exercises the contract every consumer
inherits — seat naming, rename, leave, rejoin with a token, `noSuchRoom`,
version mismatch — and point it at **Marco Polo first**, which has the least
coverage and the most to gain.

If it goes red, it has justified itself and the other two adopt it. If it goes
green, the honest conclusion is that per-game wire tests were sufficient and
this is a smaller win than it looked — record that and stop. `useRoom.ts` is
the standing warning here: 81 and 119 lines that look like duplication and are
not.

## Deliberately not in this plan

**A shared vitest config factory.** The node/jsdom split is spelled three ways
(Marco Polo standalone without `extends`; Rail Baron and Acquire inside
`vite.config.ts` with `extends: true`; projects named `jsdom` in one and `app`
in two), and unifying it is tempting for exactly the wrong reason.

Two arguments against. First, most of what looks like divergence is real: Rail
Baron's `PURE_STATE_TESTS` extglob and its 20s timeout, Acquire's service-worker
plugin and its child `setupFiles: []`. After task 1 deletes the setup files, what
remains that is genuinely common is a two-line include split. Second, and
harder: a shared *aggregator* is forbidden outright. CLAUDE.md records that
nesting a game's own two-project split inside an outer `test.projects` silently
stops its `setupFiles` running — `toBeInTheDocument` fails everywhere and reads
as real bugs. A factory returning config would be safe; the distinction is
subtle enough to be worth not relying on for a two-line win.

One thing does get fixed for free: rename Marco Polo's `jsdom` project to `app`
so `vitest --project app` means the same thing in all three.

**`packages/room-store`.** Still the right idea, still not now.

| | railbaron | acquire |
| --- | --- | --- |
| lines | 111 | 262 |
| `save` / `loadAll` / `remove` | yes | yes |
| `quarantine` | **no** | yes |
| `settled()` | in `rooms.ts:111`, not the store | **no** |
| `SAVE_VERSION`, `createNullStore` | no | yes |

The asymmetry is the whole argument for sharing — each game is missing
something the other has, and both gaps are real. It is also the argument for
doing it on its own: it touches persistence for both games, it is the only item
here that can lose somebody's saved room, and Marco Polo persists nothing and
gains nothing from it. Four tasks that cannot corrupt a save should not be
bundled with the one that can. It gets its own plan, after the dependency
alignment.

**Anything about spectator mode** ([backlog](../backlog.md), "Per game
improvements → Lobby"). It is a feature and this is a consolidation.

## What comes after

Dependency version alignment, per the agreed order — and task 2 above hands it
one more range to reconcile rather than one fewer, which is the correct trade:
Marco Polo taking Rail Baron's versions now means the alignment pass moves
Acquire up to meet them instead of arbitrating three.
