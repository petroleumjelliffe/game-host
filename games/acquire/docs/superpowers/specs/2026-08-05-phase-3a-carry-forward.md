# Phase 3a → Phase 3b carry-forward

**Date:** 2026-08-05
**Status:** Phase 3a complete; this is the punch list it hands forward
**Branch:** `revamp/phase-3a-server-authority` (22 commits, not pushed, not on `main`)
**Worktree:** `.worktrees/phase-3a`
**Branch point:** `main` @ `2ecbf39`
**Plan:** [2026-08-05-phase-3a-server-authority.md](../plans/2026-08-05-phase-3a-server-authority.md)
**Design:** [2026-08-05-phase-3a-server-authority-design.md](./2026-08-05-phase-3a-server-authority-design.md)
**Predecessor:** [2026-08-04-phase-2b-carry-forward.md](./2026-08-04-phase-2b-carry-forward.md)
**Execution ledger:** [progress.md](../../../.superpowers/sdd/2026-08-05-phase-3a-server-authority/progress.md)

**The server now runs the rules and nobody has watched it do so.** Intents cross a real
socket, the engine — not a hand-maintained XState duplicate of it — decides what is
legal, and each player is projected a state with no other player's hand, no bag and no
seed in it. All of that is proven by 483 automated tests, seventeen of them driving the
golden corpus over real websockets. **None of it has been driven by a human, and no
client exists that can drive it.** Say this plainly, because it is the phase's largest
gap: 3a ships headless, with no by-hand verification pass of any kind, and the one route
in `src/` that used to talk to a game server — `/room/:roomId`, backed by
`CreateRoomPage` and `JoinRoomPage` — now speaks a protocol that no longer exists.
`CreateRoomPage` emits the old `createRoom` shape and waits for an ack the new server
never sends; the request just hangs. Online is dead until Phase 3b rebuilds the client
against `session/protocol.ts`. This was known and accepted going in — the design's own
title is "server authority," not "playable online" — but a reader skimming only the
`## What shipped` table below could mistake "483 green tests" for "you can play this
over the internet." You cannot. Nobody has even opened a browser to it.

## What shipped

| | Before (2b, measured at Task 1) | After (3a, measured now) |
|---|---|---|
| Tests | 388 in 44 files | **483 in 49 files** |
| `git diff --stat main...HEAD` | — | **42 files changed, +5271/-2228** |
| `engine/**` touched | — | **0 files** (read-only, honoured throughout) |
| `src/components/`, `src/Game.tsx`, `prototype/` touched | — | **0 files** (untouched, per constraint) |
| Gates | vitest, typecheck, vite build, check:bundle, verify:layout | same **five**, all green |

The "before" figure is Task 1's own first measurement (`npx vitest run` immediately
after `vite.config.ts`'s test-project split, before any new test file existed) — a
config-only change with no effect on the count, so it stands for the branch point.
The "after" figure is this task's own run, moments before this document was written.

The `git diff --stat` figure is necessarily self-referential: it is measured against
`main...HEAD`, and `HEAD` is the commit that carries this document, so the figure
includes this file's own diff. A count taken before that commit — as an earlier draft of
this row briefly was — undercounts by exactly this file, which is a strange place for a
"how much changed" figure to be wrong.

**What actually changed under `server/`:** the XState layer is gone —
`gameRoomMachine.ts`, `playerMachine.ts`, `machines/types.ts`, `gameManagerXState.ts`,
`playerAuth.ts`, `roomManager.ts` all deleted, along with the dev-only `test-client.js`
and `test.html`, and `xstate` dropped from `package.json`. In its place: `server/room.ts`
(the draft, the commit boundary, undo authorisation), `server/rooms.ts` (the registry,
with rejoin tokens), `server/projection.ts` (`project(state, forPlayerId)`), and
`server/index.ts` rewritten as transport wiring only — socket events in, `Delivery`
objects out, nothing else. `session/` is new as a top-level, shared-by-both-sides
directory: `GameSession.ts` (moved, unmodified in behaviour, from
`src/game/session/`) and the new `protocol.ts` (`WireIntent`, `StateMessage`,
`RejectedMessage`, `JoinedMessage`).

## The coverage boundary between Task 7 and Task 8 — the single most important fact to carry

Two socket-driven test files exist, and they do not prove the same thing. Confusing
them is the easiest way for 3b to think something is covered that isn't.

**`server/goldenSocket.test.ts` (Task 7) proves the inbound leg only:** socket → the
binding that maps a socket to a `playerId` → `room.dispatch`/`room.undo` → the engine →
the correct rules outcome, plus that illegal and out-of-turn intents are rejected. All
seventeen golden games pass this way. But every assertion in that file reads
`room.draft()` — the server's own in-process session state — never anything the client
actually received. This was proven, not assumed: with the outbound `Delivery` suppressed
entirely (`server/room.ts`'s `dispatch` forced to return `{ kind: 'none' }` right after
calling `s.dispatch`), **eight of the seventeen games kept passing.** Those eight are
exactly the games with no `expectError` step — their assertions never touch
`client.rejections`, and `s.dispatch` had already mutated the session correctly before
the outbound message was thrown away. `TestClient.states` is collected in that harness
and never once asserted.

**`server/projectionOverWire.test.ts` (Task 8) is what proves the outbound leg** — that
`project()` is actually called at the send site, that a rejection never leaks the
actor's draft to a bystander, and that identity comes from the socket binding and not
the payload. Nothing in Task 7 would have caught the exact bug this phase exists to
prevent (an unprojected broadcast, or a leaked draft) — only Task 8 reads what a client
socket actually received.

**3b should not treat "the golden games pass over sockets" as proof the wire is safe.**
It proves the rules are enforced. Task 8, separately, proves the channel is private.

## Measured facts this phase established

- **Projection equivalence holds across 42 predictable steps in 17 golden games.**
  "Predictable" excludes the three bag-drawing intents (`endTurn`, `tradeInDeadTiles`,
  `startGame` — a projected client holds no bag and cannot compute their outcome); every
  other step satisfies `applyIntent(project(state, pid), intent) ===
  project(applyIntent(state, intent), pid)`. Pinned as a floor (`>= 40`), not an
  equality, so a harness that silently stops finding steps is caught without breaking on
  a new golden game.
- **A payout precedes its commit by at most 2 intents.** Measured, not assumed, across
  the whole corpus (`server/room.test.ts`'s "a payout precedes its commit by a bounded
  number of intents" suite) and pinned so an engine change that widens the window is
  noticed rather than silently absorbed.
- **Bonus recipients are *not* a subset of the shareholder queue — contrary to the
  design's own first draft.** An earlier draft of the Phase 3a design claimed a merger
  moving another player's money always changes the actor and therefore always commits.
  Checked against all seventeen golden games before the design was finalised, and every
  merger game violated it, for two independent reasons: the shareholder queue is built
  "starting from current player," so an acting player who also holds absorbed shares
  stays at its head and the segment stays open; and in a multi-chain merger (G7) a
  player can be paid for the *second* absorbed chain while the queue still holds only
  the first chain's shareholders, so the recipient isn't even in the queue yet. What
  actually holds instead: every recipient is seated in *some* chain's queue before the
  merger completes, so the commit that reveals their money is the same commit that asks
  them to act on it — nobody is ever asked to decide on stale figures, even though their
  board can sit unbroadcast for up to two intents while someone else liquidates.
- **15 segment closes across the corpus**, and a segment closes on two independent
  events, not one — an actor change, *or* leaving the turn-order draw with the actor
  unchanged (`stageBefore === 'draw' && draft().stage !== 'draw'`). The first version of
  this invariant checked only actor change and passed the whole corpus anyway, because
  no golden game happens to draw and keep the same seat's turn — it would have broken
  silently the moment Task 6 wired `begin` + `startGame` end to end. Caught by review,
  not by the corpus.
- **483 tests in 49 files**, measured just now; **42 files changed** against `main`
  (`+5271/-2228`); `engine/**` and `src/components/`, `src/Game.tsx`, `prototype/` show
  **zero** diff — every global constraint held for the whole phase.

## Five hollow gates, and the process rule that came out of it

A "hollow gate" here means a check that runs green not because the thing it guards is
correct, but because the check cannot fail — it was never actually exercised by the
condition it claims to detect. This project is now at five, in order:

1. **Phase 1a — `check:bundle` guarded nothing at write time.** No file under `src/` or
   `server/` imported `engine/golden/*` yet, so the grep it ran against `dist/assets`
   could never have matched even if the guard it enforces were deleted.
2. **Phase 1a — the stall/progress-invariant harness reported zero stalls while 8% of
   its own corpus was provably wedged.** The progress guard shared the stall detector's
   exact trigger and threshold, so it never independently fired; caught only by a
   whole-branch review, not from inside the task that wrote it.
3. **Phase 2a — `verify:layout`'s walk never reached a staging state**, so the pile
   reservation it exists to protect was never measured on any green run, until the
   plan's own "break it and watch it fail" step was followed literally.
4. **Phase 3a, Task 7 — the socket harness's own ordering primitive was hollow.**
   `settle()` called `socket.timeout(3000).emit('ping-settle', () => resolve())`,
   ignoring its own callback's `(err, …)` — so socket.io's per-emit timeout could never
   propagate and the intended "server did not settle" failure was dead code. Proven by
   deleting the server's `ping-settle` handler entirely: the harness degraded to a
   3-second sleep per step and **six of seventeen games still passed** with no ordering
   guarantee behind them. This is the harness that was built specifically to give every
   other socket test in this phase an ordering guarantee — the one case in this list
   where the tool meant to prevent hollow gates was itself hollow.
5. **Phase 3a, Task 8 — both draft-privacy tests asserted an absence with no barrier on
   the bystander's own channel.** `p2.states.length === p2Before` was ordered only by an
   `await` on **p1's** socket, which orders p1's handling, not the arrival of anything
   leaked to p2's separate connection. Measured with the leak deliberately present: the
   blunt break (broadcasting the actor's whole draft on every `{kind:'none'}` delivery)
   was undetected in **0 of 8 runs**; the brief's own subtler break fired in only **2 of
   10**. Fifteen consecutive *unbroken* runs also passed clean, so this would never have
   surfaced as a flake in ordinary use — it would simply never have fired, ever, while
   looking exactly like coverage. Fixed by awaiting a settle round trip on **p2's own**
   socket after the triggering action; re-verified over 8 runs per scenario: both breaks
   now fail 8/8, the unbroken control passes 8/8.

**Process rule adopted:** for any assertion of the form "nobody received X," a single
red run when the break is applied is not evidence that the check works. Breaks of
absence assertions must be run **at least eight times**, with the failure count
reported, before the check is trusted. A break that fails 8/8 is evidence a check has
teeth; a break that fails 2/10 is a coin toss that happened to tell the implementer what
they wanted to hear on the one run they watched — which is exactly what happened here
the first time it was checked.

## Two more of the controller's own mistakes, recorded honestly

Per this project's own standard, a carry-forward records the author's mistakes, not
only other people's.

- **A stray `git commit --amend` rewrote `main`'s tip commit message**, not Task 5's.
  The Bash working directory had silently reset to the main checkout between calls, and
  an `--amend` run without `-C <path>` landed on whatever HEAD that shell happened to be
  sitting on. Nothing was staged, so only the commit *message* changed
  (`2ecbf39` → `a3d1d20`), caught when a reviewer noticed the review artifact pointed at
  a commit that was supposed to be on a feature branch but resolved on `main`. Verified
  `git diff 2ecbf39 a3d1d20` was empty before restoring with `git reset --hard 2ecbf39`.
  Every git command in this phase now carries an explicit `-C <path>` as a result.
- **A confident controller claim was twice transcribed into an artifact as if it were
  measured fact.** First, an earlier draft of the design document asserted the merger
  invariant later disproven above ("bonus recipients are a subset of the shareholder
  queue") — caught only by actually executing it against the corpus before the design
  was finalised, not by review of the prose. Second, a controller's offhand "I expect 8"
  in a dispatch message about the wire-protocol intent count was written into Task 3's
  report as if it were a measurement; the re-reviewer independently counted and found 9,
  not 8, and the report was corrected. Both times the *shipped code* was already correct
  — only the explaining text was wrong. Dispatches in this phase were subsequently
  changed to tell implementers to treat controller assertions as hypotheses to check,
  not answers to transcribe.

## What 3b inherits

- **The wire types in `session/protocol.ts`**: `WireIntent` (`Intent` with `playerId`
  stripped, via a `DistributiveOmit` — proven load-bearing by breaking it down to a
  plain `Omit`, which collapsed the union and made `placeTile`'s `coord` field
  disappear), `StateMessage { state, reason: 'commit' | 'correction' | 'reset',
  segmentStart }`, `RejectedMessage`, `JoinedMessage`.
- **`GameSession` as the client's local draft.** It moved, unmodified in behaviour, from
  `src/game/session/` to the shared top-level `session/` so both sides import the same
  module. Its `segmentStart` field (added this phase) is what lets a server, or a future
  optimistic client, see a commit boundary the same way the pass-and-play UI already
  does.
- **Six of the nine intent types may be applied optimistically on the client; three may
  not.** `buyShares`, `chooseFoundingBrand`, `chooseSurvivor`, `declareEnd`, `liquidate`,
  `placeTile` don't touch the bag and can be predicted locally before the server
  confirms. `endTurn`, `tradeInDeadTiles`, and `startGame` draw from the bag — a
  projected client holds no bag, so it structurally cannot predict what they produce and
  must wait for the server's `StateMessage`.
- **`awaitingReveal` is pass-and-play-only and has no meaning online.** It exists to
  gate a shared physical device between segments (the "pass the phone" curtain); a
  networked client has no such handoff to gate.
- **A rejection's `reset` state is the committed state for a non-actor, and the actor's
  own draft for the actor.** This is `sendState`'s `ownsDraft = reason !== 'commit' &&
  playerId === room.actorId()` check — the fix for the phase's own most serious defect
  (below). A client that applied an intent optimistically and had it rejected needs
  something to roll back to; for the actor that's their own draft state (so their UI
  doesn't have to discard in-progress context that's still theirs), and for anyone else
  who triggered a rejection (an out-of-turn intent, a wrong-player undo) it's the
  committed state they already had — never a stranger's uncommitted turn.
- **Two open soft spots in `server/`, not fixed this phase, worth 3b's attention:**
  `project()` shallow-copies `state` at the top level only
  (`server/projection.ts:25-32`), so `board`, `startups` and `mergerContext` share
  object references with the source state across the projection boundary. Safe today
  because `applyIntent` always `structuredClone`s before mutating, but nothing
  structurally stops a future caller — a client-side optimistic-update path, say —
  mutating a projected object in place and corrupting the room's real state. And
  `DRAWS` — the three-element set of bag-drawing intent types — exists as **two
  independent copies that must agree, not one**: `server/room.ts:54` (deciding which
  intents produce a `correction` delivery instead of `none`) and
  `server/projection.test.ts:64` (deciding which steps the projection-equivalence proof
  skips, since a projected client holds no bag and cannot predict a draw's outcome).
  Neither is derived from the other or from `engine/intents.ts`. A new bag-drawing intent
  added to only one of them would both stop producing the correction it needs *and*
  silently narrow the equivalence proof to cover less than it claims to — with no test
  failure to say so either way.

## Deviations from the plan, and why each was right

| # | Plan/brief said | Shipped | Reason |
|---|---|---|---|
| 1 | Task 5's persistence rewrite is safe because `initPersistence` is the only symbol `server/index.ts` imports from it | Persistence rewrite moved to Task 6 entirely | `server/index.ts` also instantiates `GameManagerXState`, which transitively imports `saveGame`/`loadAllGames` and destructures the old `Map` return as `[gameId, state]` tuples — the brief's own new array-shaped `loadAllGames` broke that. Confirmed pre-existing typecheck was clean via `git stash` before assigning blame. Task 5 stopped short of committing rather than land a non-typechecking tree; the fix landed in the same commit that deleted `gameManagerXState.ts`, the only place it could land clean. |
| 2 | Task 3's exhaustiveness test treats every intent type seen in the golden corpus as evidence it belongs on the wire | Filtered to exclude `expectError` steps | `engine/golden/turns.ts:96` deliberately sends `{ type: 'bogus' }` to prove the engine's default branch rejects unrecognised intents — counting it as a real type would have failed the test on a step designed to be invalid. |
| 3 | Task 4's brief: `board['E6']?.placed` should be `.toBeUndefined()` on an unplaced tile | `.toBe(false)` | `engine/gameInit.ts` eagerly fills every board coordinate with `{ placed: false }` at game start — an unplaced tile is never absent. Same defect independently recurred in Task 8's brief and was fixed the same way; flagged both times as a repeat that should have propagated forward. |
| 4 | Task 4's "no player acts on stale money" suite (design's Test 6) | Replaced with "a commit and a segment close are the same event," driven through a real `GameRoom` | The brief's version tracked `lastSeen` only on actor-change and missed the mover's own mid-segment cash changes being visible to themselves immediately — it failed 7 of 17 real golden games on exactly that gap. Once corrected for that, it became tautological (a commit-on-actor-change test can't help but hold, by construction), so it was replaced with the thing actually worth asserting. |
| 5 | (Round 1 fix) That same replacement suite treats "commit" and "actor change" as synonyms | Broadened to "commit and *segment close*," adding the leaving-the-draw case | Review found `seed-4` with two players producing a real commit with **no** actor change — the winner of the turn-order draw closes a segment as a player distinct from "whoever pressed the draw button," even when that happens to be the same seat. The seventeen golden games never exercise that combination with a stable actor, so the narrower version passed the whole corpus and would have broken silently the moment Task 6 wired `startGame` end to end. |
| 6 | Task 6's brief: wrap `dispatch`/`undo`/`beginGame` in a blanket `try/catch` to stop a stray pre-`beginGame` message from crashing the process | Three explicit lifecycle guards at the known throw sites instead | A blanket catch would also swallow genuine bugs into an unread log line, and this phase has no by-hand pass to ever notice one doing so. Explicit guards close the known holes; anything unforeseen still crashes loudly, which is preferable with nobody watching the server run. |
| 7 | Task 7's brief test code, transcribed verbatim | Added `logMark` bookkeeping mirroring `runner.ts`'s own pattern | The brief's `assertState` calls omitted the per-step log-offset tracking `runGoldenGame` itself uses for `logPhases` assertions. Without it, 7 of 17 games failed genuinely (not vacuously) because each step's assertion saw the entire cumulative log instead of just what that step added. |
| 8 | Task 8's `twoSeats` fixture: a 2-tile bag, asserting `committed().bag.length > 0` | Bag enlarged to 10 tiles, exact remaining count pinned (`4`) alongside `projected bag === []` | The 2-tile bag is fully drained by `endTurn`'s `drawUpTo` (`HAND_SIZE = 6` from an empty hand), so the original assertion was really asserting `0 > 0` — it could not tell "the server hid the bag" from "the bag happened to be empty," which was the entire point of the check. |
| 9 | Task 8's draft-privacy tests, transcribed from the brief | Added `await settleSocket(p2.socket)` on the bystander's own channel after every triggering action | See hollow gate #5 above — the brief's own ordering barrier was on the wrong socket. |
| 10 | Task 9 brief Step 2: `! grep -rlE "socket\.io\|express" dist/assets`, expected `0` | Ran as written; got `1` (one match) | The bundle already ships `socket.io-client` (a real, pre-existing dependency, used by `SocketProvider`/`main.tsx` for the — now dead — `/room/:roomId` transport), and that package's own source contains the literal string `"socket.io"` in its default path and a migration-docs URL. That is a false positive on the naive grep, not a leak: `session/GameSession.ts` and `session/protocol.ts` — the only modules shared between client and server — import exclusively from `engine/`, confirmed by inspection, and `express` matched zero times. The check as scripted cannot distinguish "the browser client library" from "the server package" by substring alone; 3b, which will build a real networked client on top of `socket.io-client`, should expect this grep to keep matching and should not read a nonzero result as evidence of a leak without checking `session/`'s own imports first. |

## Still carried from earlier phases

Unchanged by this phase, since it touched none of `src/`:

- **The draw screen**, specified in the 2a carry-forward and still unbuilt. The rule to
  preserve: highest tile wins (I12 beats A1), the reverse of tabletop Acquire.
- **`LiqQueue` still has no design review** (Phase 1b finding, restated in 2a and 2b).
- **Seat names truncate hard at 768px** ("Player 1" renders as "P").
- **`Board.tsx` renders a hand tile as a `<button>` even with no `onCellClick`**, putting
  read-only cells in keyboard tab order.
- **The catalog's `sections.tsx` still builds every fixture at module load.**

## This phase's own deferred minors

- **`server/types.ts` has no importers** — trimmed to two re-export lines this phase but
  never actually consumed anywhere.
- **`beginGame` accepts a 1-player or 8+-player table.** Neither the room nor the engine
  validates seat count.
- **No room eviction or rate limit.** A room lives in the registry's `Map` forever once
  created; nothing expires an abandoned one or throttles connection attempts.
- **`existing.token !== token` in `server/rooms.ts` is a non-constant-time comparison.**
  Accepted deliberately — a random UUID over a websocket does not imply a threat model
  where timing-safe comparison buys anything real.
- **Several assertions are weaker than they look.** `expect(room.committed()).toEqual(
  room.draft())` after a commit is identity-true (same object reference), so it only
  catches a future implementation that publishes a genuinely different object. The
  segment-close floor test relies on `describe`-scope mutation plus vitest's default
  in-file sequential ordering; `--sequence.shuffle` would silently break it.
  `server/projectionOverWire.test.ts`'s `toEqual(project(room.committed(), 'p2'))`
  assertion is compared against the same `project` function under test, which is
  accepted circularity rather than a true oracle. The unseated-player-id check drives
  `room.dispatch`/`room.undo` directly, in-process — never actually over a socket,
  because the normal join path cannot produce a socket binding for an id that was never
  seated.

## Process lessons

**A gate proves what it was actually run against, not what its name implies.** Two of
this phase's own tests (hollow gates #4 and #5) looked, by name and by a single passing
run, like they proved an ordering or privacy guarantee. Neither did, until someone
deleted the thing being guarded and watched the gate fail to notice. This project has
shipped five such hollow gates so far, and they concentrate in three phases, not five:
1a shipped two (`check:bundle`, the stall/progress-invariant harness), 2a shipped one
(`verify:layout`), and 3a shipped two (the socket-settle primitive, the draft-privacy
ordering barrier). Phases 0, 1b and 2b have none. Every one of the five was found by
literally breaking the code the check claims to cover — never by reading the check's
code and reasoning about it in the abstract.

**A comment arguing a check is unnecessary is itself a place to look for the missing
check.** The final pre-merge review of this phase found two surviving defects, and both
sat in the exact spot the source argued, in prose, that no further check was needed. The
`intent` handler in `server/index.ts` carried a comment reasoning that a malformed
payload was safe because `{...undefined}` spreads to `{}`, which the engine's default
branch rejects — true only for an *absent* payload, not one with a valid `type` and a
malformed field (`{ type: 'buyShares' }` with no `picks`), which dereferenced before
validation and crashed the whole process, every room on it, not just the sender's.
Separately, `project()`'s own docstring named the hand "the one secret this game
actually has" and redacted it everywhere — except in `log`, where `tradeInDeadTiles`
names the coordinate it draws to replace a traded-in tile, leaking it to the whole table
on the next commit while the drawing player still held it. Prose reassurance sitting
next to a boundary is a smell worth treating as a checklist item, not as a proof that the
boundary was checked.

**Coverage boundaries are worth stating even when both halves are proven.** Task 7 and
Task 8 together fully cover the wire; either one alone proves much less than "seventeen
golden games pass over sockets" suggests. The mistake this project keeps making — and
mostly keeps catching — is letting a large green number stand in for a specific claim
about what was actually exercised.

**An eight-run standard for absence assertions is now a durable rule, not a one-off
fix.** A single red run when a break is applied tells you a check *can* fail; it does
not tell you the check fires reliably, and a check that fires 20% of the time is
indistinguishable, on any one observation, from a check that fires 100% of the time. Any
future "nobody received X" assertion in this codebase should be broken and re-run at
least eight times before it is trusted, with the count reported alongside the claim.
