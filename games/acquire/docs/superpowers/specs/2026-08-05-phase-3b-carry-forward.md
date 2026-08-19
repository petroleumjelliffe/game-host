# Phase 3b → Phase 4 carry-forward

> ## Read this before the rest — the document below is 2026-08-05, and Phase 5 has happened
>
> **Merged.** Phases 3a and 3b are on `main` (fast-forward to `3dd2328`); the branch and both
> worktrees are gone. Every "on the branch" reference below is historical.
>
> **Phase 5 closed twenty-six by-hand findings** ([the plan](../plans/2026-08-06-phase-5-online-ui.md)),
> several of which *reverse UI decisions this document describes as shipped*. Where the two
> disagree, that plan is current and this is the record of how things stood. In particular the
> panel, the step stack, the buy row and the panel's motion have all changed substantially.
>
> **Numbers:** 541 tests in 54 files here; **622 in 60** on `main` today.
>
> **Two things this document hands Phase 4 are already fixed**, corrected inline below: the
> `ExperimentalWarning` (gone — `src/test/setup.ts` now uses the `Object.defineProperty` fix this
> document proposed; `npx vitest run` emits zero warnings) and `Board.tsx` rendering read-only hand
> tiles as buttons (`Tile.interactive` is `onClick != null` since 3b's own addendum).
>
> **What Phase 4 actually inherits, in one line each:**
>
> - A **server restart still loses every room** — `saveGame` writes on each commit and nothing reads
>   it back. Unchanged, and now the largest known gap.
> - **Three end-to-end tests are owed** (owner, 2026-08-06, recorded in the
>   [roadmap](./2026-07-31-react-app-revamp-roadmap-design.md#phase-4--presence-and-recovery)):
>   refresh mid-turn, a socket dropped and revived mid-turn, and a server restart with a game in
>   progress. Today every piece is tested and no *sequence* is.
> - **The per-player turn-order draw now has a plan of its own**
>   ([2026-08-06-turn-order-draw-round.md](../plans/2026-08-06-turn-order-draw-round.md)) — it
>   rewrites `doStartGame`, `doEndTurn` and the server's handling of both, so it and Phase 4 should
>   not run at the same time.
> - **The by-hand gap below is still open**, and is the one thing twenty-six findings did not close:
>   no merger's liquidation queue has reached a second player's screen, and no game has been played
>   to final scoring in two browsers.

**Date:** 2026-08-05
**Status:** Phase 3b complete and merged to `main` (2026-08-05); superseded in part by Phase 5
**Branch:** `revamp/phase-3b-networked-client` (16 commits) — merged and deleted
**Worktree:** `.worktrees/phase-3b` — removed
**Branch point:** `revamp/phase-3a-server-authority` @ `5d5be92`
**Plan:** [2026-08-05-phase-3b-networked-client.md](../plans/2026-08-05-phase-3b-networked-client.md)
**Design:** [2026-08-05-phase-3b-networked-client-design.md](./2026-08-05-phase-3b-networked-client-design.md)
**Predecessor:** [2026-08-05-phase-3a-carry-forward.md](./2026-08-05-phase-3a-carry-forward.md)
**Execution ledger:** [progress.md](../../../.superpowers/sdd/2026-08-05-phase-3b-networked-client/progress.md)
*(session artifact — `.superpowers/` is not tracked in git; this link resolves in the authoring
working copy only, not after a clone)*
**Browser pass:** [2026-08-05-phase-3b-browser-pass.md](./2026-08-05-phase-3b-browser-pass.md)
*(moved into `docs/` at merge time — `CLAUDE.md` cites it as the only browser verification this
phase has, so it could not stay in an untracked session directory)*

**A client now speaks the server's protocol, and it has been driven — but not yet by a human.**
`src/net/` is a real `GameSession` backed by a socket: six of nine intents apply optimistically,
three wait on the server, and a rejection rolls back cleanly. The legacy modal UI is gone —
`src/Game.tsx`, all of `src/components/`, `src/context/SocketContext.tsx` — 23 files, deleted in
one commit with all four gates green on the result. Two `NetworkSession`s replaying all seventeen
golden games over real socket.io against the real server, asserting client-held state against the
server's own projection, is the strongest evidence this project has produced for "the wire is
correct": 29 optimistic predictions and 7 deferred bag-draws, all verified, floors pinned under
both counts.

State the boundary on that plainly, because a reader skimming green numbers is exactly how this
project's own carry-forwards keep getting misread. **The design's own Test 9 — "by hand, in two
browser windows, against a local server: a full game through to final scoring, including a merger
with a liquidation queue that reaches both players" — has not happened.** What did happen is a
scripted pass, written and driven by the same author as the code, covering the opening, one full
turn and the handoff (`by-hand-pass.md`). It found no console errors and confirmed the open segment
stays private across two genuinely separate browser profiles — real coverage, not nothing. But it
explicitly did not touch a merger's liquidation queue reaching a second player's screen, did not
play a game to final scoring, could not observe the `pending` inert window (a few milliseconds on
a local server), and carries none of a human's judgement about how any of it *feels* to play. So:
can two people now play a game of Acquire against this server? The mechanics say yes, proven two
different ways (the socket corpus, the scripted browser pass). Whether it plays *well*, and whether
the one path never driven — a merger reaching a second player's screen — actually works when a
person is the one watching it, is still open. Phase 4 or a dedicated pass should close it before
this is called done in the sense the design meant.

## What shipped

| | Before (3a tip, `5d5be92`) | After (3b, measured now) |
|---|---|---|
| Tests | 483 in 49 files (cited, [3a carry-forward](./2026-08-05-phase-3a-carry-forward.md)) | **541 in 54 files** (`npx vitest run`) |
| `git diff --stat 5d5be92..HEAD` | — | **54 files changed, +4730/-2982** |
| Commits on the branch | — | **16** (`git log --oneline 5d5be92..HEAD`) |
| `src/net/` | did not exist | **7 files, 835 lines** (`NetworkSession.ts`+test, `connection.ts`, `identity.ts`+test, `transport.ts`, `useRoom.ts`) |
| `src/game/online/` | did not exist | **3 files** (`RoomLobby.tsx`, `ConnectionStrip.tsx`, `JoinForm.tsx`) |
| `src/Game.tsx`, `src/components/`, `src/context/` | present, dead (spoke a protocol the 3a server no longer answers) | **deleted — 23 files** (Task 8, commit `cbe4a8d`) |
| Gates | vitest, typecheck, vite build, check:bundle, verify:layout | same **five**, all green (per-task; whole-branch re-run not separately re-verified by this document beyond the vitest count above) |

The "before" row is a citation, not a re-measurement — checking out `5d5be92` in this worktree to
re-run the suite would mean leaving `revamp/phase-3b-networked-client`, which the task rules for
this document rule out. The 3a carry-forward's own "measured now" figure was taken at that
document's own commit, which is this branch's fork point, so it stands for the same baseline.

## The coverage boundary this phase adds — and the one it cannot close

3a's carry-forward drew a sharp line between "the golden games pass over sockets" (Task 7, inbound
only) and "a client actually received the right thing" (Task 8, outbound). 3b's own centerpiece,
`server/clientOverWire.test.ts` (Task 7 of this phase), is what actually proves the second half for
a *client* rather than a raw socket harness: two real `NetworkSession`s, driven only through the
public `dispatch`/`getView` surface `GameScreen` itself uses, replaying all seventeen golden games.
It is a **consistency** oracle — both sides move through the same `project`, so it would not notice
`project` itself leaking a hand — not a **privacy** oracle; that proof stays `server/
projectionOverWire.test.ts`'s, which asserts the literal shape (`hand === []`, …) a non-actor
receives. The distinction is stated inline in the test file's own docstring, not just here.
Measured, not assumed: **29 optimistic predictions** verified equal to the server's own projection
(floor 25 — see Deviations, below, for why the floor moved), and **7 deferred bag-draws** verified
to leave the client's own state untouched until the server answers (floor 5). Both breaks named in
the design's own Risks section were run for real: applying `DRAWS` intents optimistically failed
6 of 17 games once the coverage gap below was closed; sending unprojected server state failed 15
of 17 (the other two are single-step `expectError` fixtures that never reach a state comparison at
all).

What this proves: the six predictable intents really do move the client before the server answers,
the three bag-drawing intents really don't, and a client rebuilt from the server's own `state`
message really does match what the server holds. What it does not prove, and nothing in this phase
does: that a *person*, clicking through a browser, experiences any of this as correct — that is
exactly the gap the opening section states. `by-hand-pass.md` covers the opening and one turn by
eye; the socket corpus covers all seventeen games including every merger, but only as replayed
against `NetworkSession`'s API, never rendered.

## Measured facts this phase established

- **29 predictable steps and 7 deferred bag-draws across the golden corpus**, under this file's
  definition — narrower than 3a's own "42 predictable steps," which counted `expectError` steps too
  (a rejection reduces identically against a projected or full state, so 3a's proof counted it;
  this file's `predicted` comparison only ever runs for a step that produces a state to diff, so it
  doesn't). Both counts describe real, different things under the same word "predictable"; the
  discrepancy is documented inline in `server/clientOverWire.test.ts` rather than silently
  resolved in one direction (Task 7 report).
- **`jsdom` under this project's vitest 4 / jsdom 27 pairing does not provide `localStorage`.**
  `environmentOptions.jsdom.localStorage: true` in `vite.config.ts` does nothing; confirmed by
  removing it and re-running — no test broke. `src/test/setup.ts` now carries a hand-rolled
  in-memory shim (getItem/setItem/removeItem/clear/length/key; no storage events, no origin
  isolation). Cause not established — Task 4's working theory is jsdom's own origin/sandbox
  handling, not confirmed further.
- **That shim is also the source of a still-open defect** (below) — an `ExperimentalWarning` line
  that now escapes into `npx vitest run`'s output on every jsdom test, and even leaks into the
  `node` project's own output. Reproduced again for this document: `npx vitest run` on the current
  tree prints `(node:NNNNN) ExperimentalWarning: localStorage is not available because
  --localstorage-file was not provided.` repeatedly; `npx vitest run --project node
  engine/startups.test.ts` alone reproduces it, a pure engine test with no localStorage
  involvement at all.
- **The break the design's own Risks section demanded — apply `DRAWS` optimistically and confirm
  the mismatch count rises above zero — genuinely required a second pass to mean what it claims.**
  The first run of that break only turned one game (G17) red, and on an unrelated assertion (a
  synchronous local refusal from an artificially empty projected bag), not the "predicted a
  different state" check the design named. See hollow gate #8, below — this is the same finding
  from the coverage-gate side.

## Eight hollow gates, now, and what that says

A hollow gate is a check that runs green not because the thing it guards is correct, but because
the check could not have failed — never actually exercised by the condition it claims to detect.
The [3a carry-forward](./2026-08-05-phase-3a-carry-forward.md) counted five across the project's
history, concentrated in three phases (1a: two, 2a: one, 3a: two; 0, 1b and 2b: none). This phase
adds three more, bringing the project's running total to **eight**, all still found the same way —
by literally breaking the code the check claims to cover, never by reading the check's code in the
abstract:

6. **Task 3 — `undoableSteps`'s actor-handoff test branched on its own outcome.** The brief's test
   asserted a conditional (`if (actorId !== 'p1') expect([]) else expect(length > 0)`) against a
   fixture that, traced through, never actually left `actorId === 'p1'` — so the test passed
   whichever branch it landed in, with or without the `actorId === playerId` gate the test claimed
   to guard. Dropping the gate (break 3) turned nothing red. Closed by scanning the golden corpus
   for a real run ending in an actor handoff with no bag draw (found in G7's three-way merger,
   Alex's liquidation handing the actor to Sam) and asserting the scan matched something, so a
   corpus that stopped containing such a run would fail loudly rather than silently pass. Re-run:
   now red on exactly that test.
7. **Task 5 — the room-screen test's fake `Connection` collapsed two real listeners into one, and
   discarded rejection handlers outright.** `onState` stored a single handler in a `let`, silently
   overwritten by the second registration — production genuinely has two live listeners on `state`
   at once (`useRoom`'s own, and `NetworkSession`'s, which is the one `GameScreen` actually depends
   on), and the old fake happened to keep working only because `useRoom`'s own handler is a no-op
   after the first message. `onRejected` returned `() => {}` and stored nothing at all, so a
   refusal delivered after a player was seated had no way to reach the fake — the "a refusal after
   the roster stays inside the lobby" guarantee was asserted only in a comment. Both fixed with a
   `Set`-per-event fake matching `socket.on`/`socket.off` semantics, plus `sendRejected` and two new
   tests; both now proven by a break that fails on exactly the target (see the two misconceived
   breaks in this same task, below — one of Task 5's two findings needed a *second* attempt at the
   break before it actually proved anything).
8. **Task 7 — the `predictions` floor never looked at the steps a bag-drawing break actually
   corrupts.** `predicted` is captured only for `!DRAWS.has(wire.type)` steps by construction, so
   when the first break (apply every intent optimistically, including the three that draw from the
   bag) was run, the corrupted `endTurn`/`tradeInDeadTiles`/`startGame` steps were exactly the ones
   the comparison never inspects — the divergence self-heals the moment the next server commit
   lands, before anything looks. Only G17 turned red, and by coincidence (an empty projected bag
   throws synchronously), not because the harness caught the mispredicted intermediate state.
   Closed by adding a `deferred` counter and a same-tick "the client did not move at all" assertion
   for every legal bag-drawing step, floored at 5 (measured 7). Re-run: 6 of 17 games now fail,
   precisely the six containing a legal bag-drawing step.

**What eight says, at this point in the project:** every phase that has shipped a socket- or
transport-level test has produced at least one hollow gate in it — 1a's two were about a build
guard and a stall detector, but 3a and 3b's four are all about the same underlying hazard, ordering
and reach across an async boundary (a websocket, a listener registration, a same-tick assertion).
That is not evidence the project's testing discipline is weak — every one of the eight was in fact
caught, before merge, by literally breaking the code — it is evidence that *this specific kind of
claim* ("the client received X," "the client did not move on Y," "nobody heard Z") is the one this
codebase keeps getting wrong on the first attempt, and needs the break-it-and-watch step treated as
mandatory, not advisory, every time a new one is written.

## Three misconceived breaks — a process finding about who checks the checker

Distinct from the above: three times this phase, a break *named in the controller's own brief* —
not the implementer's invention — turned out to target something that could not produce a
different observable result no matter what ran it, and the implementer reported that rather than
bending an assertion to manufacture red:

- **Task 3, break 3** (see hollow gate #6, above) was the controller's own named break. It turned
  nothing red on the first run; the implementer traced the fixture by hand, confirmed the gate it
  targeted really is load-bearing code (real behaviour in other fixtures, e.g. G7), and reported
  that the specific test given could not have exercised it, rather than declaring the break itself
  a failure of the code.
- **Task 5, break 2** (original form): named to target `useRoom`'s own `onState` listener. Traced
  by the implementer: that listener is a no-op on every call after the first (`GameScreen` never
  reads from it — it renders through `NetworkSession`'s own, separate listener via
  `session.subscribe`), so removing it changes nothing any test could observe. Reported instead of
  forced; the corrected break — against `NetworkSession`'s own `onState` handler — turned exactly
  the intended test red.
- **Task 6**: the controller's named break reordered two lines inside one synchronous event
  handler (`saveIdentity(...)` then `navigate(...)`). Both calls complete, in either order, before
  React or the test observes anything — nothing between them is asynchronous and nothing reads a
  value the other one writes. It stayed green both times it was run. Worse: the test's own comment
  claimed an ordering guarantee ("stored before the navigation, or the room screen would join again
  as a stranger") that the code does not actually provide. The comment was rewritten to state only
  what the assertion proves; two deletion breaks (drop `saveIdentity`, drop `navigate`) replaced the
  reorder and both bit cleanly.

**The finding, stated once:** hollow gates are what happens when nobody checks whether a test can
fail. This is the mirror case — what happens when nobody checks whether a *break* can succeed. Both
failure modes were caught here, but by the same mechanism each time: an implementer actually running
the thing and reading the real output, not a reviewer reasoning about the code from memory. Every
control this project has that catches these — the break-it step, the eight-run rule for absence
assertions carried from 3a — depends on someone executing it in good faith and reporting an
inconvenient result honestly. Three implementers did, this phase, on breaks the controller itself
got wrong.

## A defect found but not fixed this phase — **fixed since (2026-08-06)**

> `npx vitest run` is pristine again: zero `ExperimentalWarning` lines across all 60 files, and
> `npx vitest run --project node engine/startups.test.ts` — the minimal reproduction below — emits
> none. `src/test/setup.ts` now probes with `Object.getOwnPropertyDescriptor` and installs the shim
> with `Object.defineProperty`, which is the first of the two fixes this section proposed. The
> account below is kept because the *finding* — that reading a Node experimental global is itself
> what fires the warning — is the useful part.

**`npx vitest run` is not pristine, and has not been since Task 4.** It emits
`(node:NNNNN) ExperimentalWarning: localStorage is not available because --localstorage-file was
not provided.` — repeatedly, once per worker — and it fires even for a test with nothing to do
with storage (`npx vitest run --project node engine/startups.test.ts` alone reproduces it;
confirmed again while writing this document, still present at `cbe4a8d`). Cause: `src/test/
setup.ts:24`'s `if (!globalThis.localStorage)` guard reads a Node experimental global to decide
whether to install the jsdom shim, and the read itself is what fires Node's warning — and it fires
in the `node` project too, which shares the same `setup.ts` shape. This was written into
`progress.md` as a **controller finding, for the final review's fix wave**, with a specific proposed
fix (`Object.defineProperty` unconditionally in a jsdom-only file, or probe with
`Object.getOwnPropertyDescriptor` instead of reading the getter). **No commit after `cbe4a8d`
addresses it** — the fix wave the finding was written for did not happen inside this phase. This
project treats warnings in test output as findings in their own right; Phase 4 inherits a
non-pristine baseline and should treat this as the first thing to clear, not a cosmetic footnote.

## What Phase 4 inherits

- **`src/net/`, as the seam Phase 4 builds presence and recovery on.** `NetworkSession` satisfies
  `GameSession` exactly, so `GameScreen` cannot tell it apart from pass-and-play's local session —
  any reconnection or presence work almost certainly means enriching `connection.ts`/`useRoom.ts`,
  not touching `GameScreen` again. `identity.ts`'s per-room `{ playerId, token, name }` in
  `localStorage` is what a refresh already rejoins through; a dropped-and-restored socket beyond a
  refresh is explicitly out of this phase's scope and now Phase 4's first job.
- ~~**The unresolved `ExperimentalWarning`**~~ — **fixed 2026-08-06** (see above). Phase 4 starts
  from a pristine suite after all.
- **`DRAWS` now has three consumers, not two**, all importing the one definition in
  `session/protocol.ts`: `server/room.ts`, `server/projection.test.ts`, and (new this phase)
  `src/net/NetworkSession.ts`. The 3a carry-forward's warning about two independent copies that had
  to agree is closed for these three; nothing else in the codebase re-derives the set.
- **The known limits the design accepted, still true and unexamined further:** a server restart
  loses every room (`saveGame` writes, nothing reads it back — `loadAllGames` lost its only caller
  when `gameManagerXState.ts` was deleted in 3a); `project()` shallow-copies `board`, `startups`
  and `mergerContext`, safe only because `applyIntent` always clones first. Neither was touched or
  re-verified this phase; both are exactly as the 3a carry-forward left them.
- **The per-player turn-order draw** — still not built, but **no longer unplanned**: it has its own
  document ([2026-08-06-turn-order-draw-round.md](../plans/2026-08-06-turn-order-draw-round.md)),
  and the design there needs *no new intent* after all. `startGame` deals one tile to each player,
  `placeTile` puts it down, `endTurn` commits, and the last one resolves the order and deals the
  hands — so the wire vocabulary is unchanged. It does rewrite `doStartGame`, `doEndTurn` and the
  server's handling of them, which is why it should land after Phase 4 rather than beside it.
- **What the by-hand pass never touched** — restated because Phase 4 must treat it as untested, and
  because **twenty-six Phase 5 findings did not close it**: those came from opening-and-middlegame
  passes, and the list below is still exactly as open as it was. a merger's liquidation queue reaching a second
  player's screen and handing them control mid-turn; a game played through to final scoring; the
  `pending` inert window, observed by eye rather than by unit test; anything about a real network —
  latency, packet loss, a dropped socket, a Render cold start; and a human's judgement about how any
  of this feels to actually play.

## Deviations from the plan, and why each was right

| # | Plan/brief said | Shipped | Reason |
|---|---|---|---|
| 1 | Pre-flight: Task 6's Files list names `src/App.tsx` as modified | No step in Task 6 changes it; left alone, no question raised | No step in the brief's own dispatch touches routes or elements, and Task 6's own suite had to stay green with no failing `App.test.tsx` left standing (that file is Task 8's to delete). Confirmed in Task 6's report: `App.tsx` and `App.test.tsx` belong to Task 8. |
| 2 | Task 2's brief test: `expect(screen.queryByTitle('E6')).toBeNull()` for a tile not in the viewer's hand | Replaced with a `tagName === 'BUTTON'` check | `Board`/`Tile` render **every** board coordinate unconditionally — an unowned cell is `<span title={coord}>`, not absent. `queryByTitle` cannot distinguish "not shown" from "shown as furniture"; verified directly against the failing diff, which showed the empty-state `<span>`. The reviewer traced `Board.tsx`'s derivation and confirmed the replacement fails in both directions if `viewer` stops honouring `viewerId`. Any later task asserting "not on my board" must use this form, never `queryByTitle(...).toBeNull()` — recorded in `progress.md` as a standing rule for the rest of the project. |
| 3 | Task 6's Files list names `src/App.tsx` | Not touched | Same root cause as #1, confirmed again at implementation time: routes and elements are unchanged, so there was nothing to edit. |
| 4 | Task 7's floor: `predictions >= 30`, citing "3a measured 42 predictable steps" | Measured **29**; floor set to **25** | 3a's 42 counted every step where `!DRAWS.has(type)`, including `expectError` steps (a rejection reduces identically whether the state is projected or not, so 3a's proof counted it as predictable). This file's `predictable` only counts steps that produce a post-dispatch state to diff, which by construction excludes `expectError` — a real, documented difference in what "predictable" means between the two files, not a bug in either. 25 mirrors the brief's own margin (30 under 42 ≈ 71%; 25 under 29 ≈ 86%, tighter but not fragile). |
| 5 | Task 4's `vite.config.ts` addition: `environmentOptions.jsdom.localStorage: true` | Removed; a hand-rolled shim in `src/test/setup.ts` does the actual work | Confirmed the option does nothing under this project's vitest 4 / jsdom 27 pairing — removing it left every test green. Dead config in a shared build file was judged worse than no config, since a future reader would trust it as load-bearing. (This is also the origin of the unresolved warning above — the shim's own guard is what fires it.) |

## Still carried from earlier phases

Unchanged by this phase:

- **The per-player turn-order draw** (see "What Phase 4 inherits," above) — specified in this
  phase's design as the follow-on, not built. Preserve the rule: highest tile wins (I12 beats A1),
  the reverse of tabletop Acquire.
- **`LiqQueue` still has no design review** (Phase 1b finding, restated in 2a, 2b, and 3a).
- **Seat names truncate hard at 768px** ("Player 1" renders as "P").
- ~~**`Board.tsx` renders a hand tile as a `<button>` even with no `onCellClick`**~~ — **fixed in
  this phase's own addendum** (`5b0b01b`): `Tile.interactive` is now `onClick != null`, so a
  read-only cell is a `<span>` and stays out of the tab order. `data-tile-state` was added at the
  same time, and is the convention later tests use to discriminate cell states.
- **The catalog's `sections.tsx` still builds every fixture at module load.**

## This phase's own deferred minors

- **Task 1**: the per-member rationale from `server/room.ts`'s old `DRAWS` comment (why
  `endTurn`/`startGame` are in the set even though they commit anyway; why `tradeInDeadTiles` is the
  sole reason a mid-segment correction exists) was replaced by the terser "one definition, three
  consumers" comment the brief mandated. A future reader loses the per-member "why."
- **Task 2**: `useTurnPanel.tsx:95-109` computes `endCondition`/`declareEnd` above the
  `if (!canAct)` early return, where the waiting branch never uses them. Harmless and pure; could
  move below the guard.
- **Task 3**: no test covers `pending` being cleared by a *rejection* specifically (dispatch
  `endTurn` → `serverRefuses` → assert `pending === false`) — the rejection's message half is
  covered, the pending half is correct only by inspection.
- **Task 3**: the three `DRAWS` intents skip local validation entirely — a non-actor's `endTurn`
  reaches the server rather than being refused locally the way `placeTile` is. Brief-mandated and
  commented; the UI gates on `actorId` regardless.
- **Task 5**: `useRoom`'s `identityRef` is read once at mount, so a `roomId` change without an
  unmount would keep the old room's identity. Unreachable today — both navigations into
  `/room/:roomId` come from other routes, which remount — but a future room-switch flow (still
  within a mounted `RoomPage`) would need to revisit it. Now commented in the file.
- **Task 7**: the `deferred >= 5` floor (measured 7) has a tighter margin than `predictions >= 25`
  (measured 29). Not fragile against the fixed corpus as it stands, but more likely to trip
  benignly if a future golden game loses its one bag-exhaustion step.
- **Task 8**: `src/App.tsx:16-42` keeps its old indentation after the `OnlineOnlyBanner` wrapper
  came out — reads as a half-finished edit, confirmed still present at `cbe4a8d`. Cosmetic only.
- **Task 8**: dead CSS in `src/styles/index.css` for the deleted legacy components, and an unused
  `uuid` dependency in `package.json` (only ever consumed by the deleted `playerId.ts`). Both
  pre-existing, both outside Task 8's file list, neither removed.
- **The controller-finding warning** (see "A defect found but not fixed this phase," above) is the
  single largest item on this list and is called out separately, not buried here, because it is a
  currently-failing standard (a non-pristine test run), not a cosmetic nit.

## Process lessons

**A gate proves what it was actually run against, not what its name implies — still true, and now
the largest single failure mode in this project's history.** Four of the project's eight hollow
gates (half) are about an async or cross-listener boundary specifically: a socket-settle primitive,
a draft-privacy ordering barrier, an actor-handoff fixture that never reached the state it claimed
to guard, and a same-tick assertion that looked at the wrong steps. Every future test of the form
"the client received/moved/refused X" should be treated as guilty until a break proves it can fail
— not just once, but per the 3a-established eight-run rule when the assertion is one of absence.

**The controller is not exempt from the same discipline it demands of implementers.** Three named
breaks this phase were themselves wrong — not sabotage, just breaks that, on inspection, targeted
code with no path to an observably different result. Nothing about being the one who wrote the
brief made those breaks more likely to be correctly aimed. What caught all three was the same
mechanism that catches a hollow gate: someone actually running the thing and reporting the real
output rather than assuming the brief's reasoning was sound.

**"Two browsers, scripted, by the code's own author" is real coverage and is not the by-hand pass
the design promised.** It is worth stating this distinction every time a phase's closing document
is tempted to round it up — the design named a specific, harder bar (a full game, a merger
liquidation reaching a second screen, by a human) and this phase did not clear it. Recording that
plainly is more useful to Phase 4 than a table of green rows would be.
