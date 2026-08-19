# Phase 4 → next phase carry-forward

**Date:** 2026-08-07
**Status:** Phase 4 complete; this is the punch list it hands forward
**Branch:** `revamp/phase-4-presence-and-recovery` (19 commits, branched from `efbd2f8`)
**Design:** [2026-08-06-phase-4-presence-and-recovery-design.md](./2026-08-06-phase-4-presence-and-recovery-design.md)
**Plan:** [2026-08-06-phase-4-presence-and-recovery.md](../plans/2026-08-06-phase-4-presence-and-recovery.md)
**By-hand notes:** [2026-08-07-phase-4-by-hand-notes.md](./2026-08-07-phase-4-by-hand-notes.md)
**Predecessor:** [2026-08-05-phase-3b-carry-forward.md](./2026-08-05-phase-3b-carry-forward.md)

**A game now survives a refresh, a dropped socket, and a server restart — and all three were driven
by hand, in real browsers, not only asserted in a suite.** The bug the phase existed to fix is
closed: a socket rejoining mid-turn used to be sent the state at the *start* of the turn while the
server still held the actor's open draft, so a refresh put a placed tile back in your hand while the
server believed it was played. It now gets its own draft back.

State the boundary plainly, because this project's carry-forwards keep getting skimmed for green
numbers. **The by-hand pass was local, not prod.** The design specified "then the same three by
hand, on prod" and that has not happened. On Render free the restart pass is *expected* to end at
the gone-room screen — ephemeral filesystem, an accepted limit — which is a pass rather than a
failure, but it remains a prediction rather than an observation.

## What shipped

| | Before (`efbd2f8`) | After (measured now) |
|---|---|---|
| Tests | 622 in 60 files | **664 in 63 files** |
| Test output | clean | clean (a regression was introduced and fixed — see below) |
| `git diff --stat` | — | **27 files, +1911 / −95** |
| Commits | — | **19** |
| Server restart | lost every room | roster, tokens and last committed state restored before `listen` |
| Rejoin mid-turn | turn-start state, draft stranded on the server | the actor's own open draft |
| A room that is gone | `cannot join ABC123` on a join form | a named ending with a route back |
| A dropped player | invisible in game | dot on the seat, named in the toast |
| A cold start | same pill as a 2-second blip | explains itself after 3s |

## The two things most worth knowing

**1. A game lost to a restart used to show a dead board — found by the final review, not by any test
or by hand.** `playing` outranked `gone` in `useRoom`'s phase expression, and a mid-game player
already holds a session, so `gone` could never win. The player kept a live-looking board — pill
hidden, controls enabled — whose every click the server dropped at `if (!bound || !room) return`.
On the deployment target this is not an edge case: Render free's disk is ephemeral, so a restart
losing the room is the *normal* case, and the phase's headline feature did not fire in it.

Both gone-room tests drove a rejection with no session ever built. The by-hand pass missed it too,
because the room that vanished happened to be a *lobby* room, where `session` is null. Fixed by
making `noSuchRoom` terminal in the rejection handler — tearing the session down — rather than
reordering the ternary, so the intent is explicit where the decision is made.

**2. One bad save record could stop the server booting at all.** `restore()` had no per-record guard
and the boot chain had no `.catch`, so a record that parsed and passed `isSavedRoom` but carried a
`state` the engine could not drive threw, rejected `restore()`, and `httpServer.listen` was never
reached — process dead, no log line. `isSavedRoom` deliberately trusts `state` past "is an object",
so `SAVE_VERSION` does not protect against the next `GameState` change landing without a bump. Now
one bad record costs one room, and `listen` is unconditional.

Both were found by the final whole-branch review. Neither was reachable by a per-task review, which
is the argument for keeping that step.

## Hollow gates: two found during the phase, one found in it

The project's running total is **eleven**. Phase 4 added three:

9. **Task 1 — a shared temp filename made the write-ordering test pass by accident.** Two concurrent
   same-room writes collided on one `.tmp` path; the second clobbered the first's temp file, the
   first's `rename` threw into a swallowing catch, and the correct content landed by luck. The break
   that was supposed to prove the promise chain load-bearing stayed green. Closed with a unique temp
   path per write, after which the break bites — and ordering and isolation became two independent
   guarantees rather than one masquerading as both.
10. **Task 5 — an absence loop iterated over an empty array.** "The other player received nothing"
    looped over zero messages, because the steps before it all delivered `{kind:'none'}`. It passed
    unconditionally. Closed by making the actor's segment genuinely close, plus an explicit
    `length > 0` assertion so a future regression to zero iterations fails loudly.
11. **The final review found one in a by-hand fix made during the pass.** `ConnectionStrip`'s
    "notices it is offline even when it mounts that way" passed via the `useState` initializer, not
    the effect's re-read that its comment claimed to guard. Relabelled to what it proves; the
    untested render-to-effect window is now named in a comment rather than falsely covered.

**Every one was found by running a break and reading real output** — never by reading the check.
That is now eleven for eleven.

## A near-miss of the same shape, in the by-hand pass

A confident *"detection takes 4–7 seconds"* finding was produced, with a table, derived entirely
from an **unmeasured** gap between installing an in-page recorder and killing the server. Re-measured
against a shared clock, the real figure was **98ms** — wrong by two orders of magnitude. It survived
only until someone measured it properly instead of writing it up.

A number that was never actually measured, presented as a measurement, is the same defect as a check
that could never fail. Worth treating it as one.

## What the next phase inherits

- **The store, as the seam for real durability.** `server/store.ts` is a `RoomStore` interface with
  one file implementation. Swapping in a backend that survives Render is a config change, not a
  redesign. Records are written to a unique temp path and renamed, serialised per room.
- **`resume`, and the rule it rides.** `sendState`'s `ownsDraft = reason !== 'commit' && playerId ===
  room.actorId()` is what keeps a draft private. `resume` added no branch to it. The final review
  traced all four `sendState` callers and confirmed no reachable path sends a draft to a non-actor,
  including after a restore.
- **Durability is best-effort and silent.** A commit whose write fails, or a crash between commit
  and completed write, loses that commit, and `persist` cannot learn it happened — `save()` never
  rejects. Correct under the phase's own framing; worth revisiting if stronger durability is wanted.
- **`previousSegmentStart` does not survive a restart.** It is not on `SavedRoom`, so a client
  resuming a restored room gets `undefined` and the step stack's previous turn stays blank until the
  next commit — the exact gap the field was added to close, unclosed for the restart case. One field
  would fix it.
- **Unreadable saves accumulate and warn forever.** Eviction deletes records that are too *old*, not
  ones that cannot be parsed. Deleting a file you could not read is destructive and deserves a
  decision, not a reflex; a reasonable shape is `loadAll` returning the skipped names so `restore`
  can quarantine them deliberately.
- **`restore()` is boot-only, and only a docstring says so.** Called at runtime it would replace live
  room objects while socket bindings still point at the old ones. Unreachable today.

## Still open, and each is somebody's decision

- **The cold-start copy asserts a cause it cannot know.** With a network but no route to the server —
  a phone on cellular reaching for a LAN address, a captive portal, a wrong `VITE_SERVER_URL` — it
  still says the server is waking. `navigator.onLine` cannot tell these apart, and the honest repair
  is copy that blames nothing: `Can't reach the server — retrying`. Not done; it is a product call.
- **The prod by-hand pass.** Three scenarios, on Render. **The third is no longer a prediction**
  (owner, 2026-08-07): restarting the Render service does delete every room, and a player who was
  mid-game lands on the gone-room screen. That is the accepted-limit pass this document forecast,
  and it is also the first confirmation *in production* of the fix the final review caught — the
  mid-game gone room, where `playing` used to outrank `gone` and leave a live-looking board whose
  every click the server dropped.

  **With a measurement trap worth recording.** Render takes a while to confirm the restart, and the
  old process keeps serving during that window — so **the first reloads after a restart look like
  the room survived**. The gone-room screen only appeared about 15 seconds in. Anyone checking
  persistence on Render immediately after a restart would record "rooms survive a restart on prod",
  which is false. Same shape as this phase's 98ms near-miss: the observation was real, the moment it
  was taken at was not the moment being reasoned about.

  Still owed on prod: refresh mid-turn and the dropped socket.
- ~~**The away dot has never been rendered on a measured page.**~~ **Looked at on 2026-08-07, and
  the ruling was wrong** — see [2026-08-07-full-game-by-hand-notes.md](./2026-08-07-full-game-by-hand-notes.md),
  Finding 3. The final review traced the geometry (`overflow-hidden`, the active seat `flex-none` at
  index 0, every other seat shrinking to zero) and ruled the dot did not block merge. The reasoning
  was correct; the conclusion was not, because it answered "is the dot rendered?" when the question
  was "can the player see it?" A disconnected non-actor is clipped off the end of the row entirely,
  dot and all. The urgent case survives — a disconnected *actor* is rotated to the front — but
  presence for everyone else is carried in a row designed to clip.

  The redirect still stands and is now better supported: the hole is `/catalog`, which has no away
  state, not `verify-layout.mjs`, which drives pass-and-play where presence is absent by design.
- ~~**`npm run verify:layout` is intermittently flaky**, project-wide and pre-existing. Every "five
  gates green" claim in this phase is weaker than it reads until that is understood. It should stop
  counting as evidence until someone explains it.~~

  **Explained and fixed, 2026-08-08 — and this phase's "five gates green" claims stand.** It was
  never the app. The gate rounded each zone's height to the nearest pixel and then compared sums
  exactly, so fractional heights sitting near `.5` flipped a sum by 1px with no layout change.
  Heights are raw now, compared against a 1px tolerance. See `CLAUDE.md`'s note under Commands.

  Worth noting against this bullet specifically: it is the **first** written appearance of the
  caveat (`37b8139`), and it already described the problem as "pre-existing" without a failure
  shape, a seed, or a run behind it. It was then quoted forward through five phases. The lesson is
  the one this repo already applies to tests — a claim nobody has reproduced is not evidence, and
  that cuts both ways.

## Still carried from earlier phases

Unchanged by this phase:

- **A full two-browser game to final scoring**, including a merger whose liquidation queue reaches a
  second player. Owed since Phase 3b. Every by-hand pass this project has run has found bugs the
  suite could not; this is the largest one nobody has run.
- **The per-player turn-order draw** — one `startGame` still draws for the whole table. Preserve the
  rule: highest tile wins (I12 beats A1), the reverse of tabletop Acquire.
- **`LiqQueue` has no design review** (a Phase 1b finding, restated in 2a, 2b, 3a and 3b).
- **Seat names truncate hard at 768px.**
- **`Board.tsx` renders a hand tile as a `<button>` even with no `onCellClick`**, putting read-only
  cells in keyboard tab order.
- **The catalog's `sections.tsx` builds every fixture at module load.**

## Process lessons

**Verify which tree is serving before any by-hand pass.** The first round of this phase's by-hand
testing measured `main`, because two dev servers from another checkout already held the ports and
Vite silently moved to the next free one. A "refresh works fine" result was recorded before anyone
noticed. Mapping every listening port to its process's working directory takes one command and would
have saved the round.

**A per-task review cannot see a cross-task defect, and both of this phase's worst bugs were
cross-task.** The mid-game gone room needed `gone` (Task 9) and the session lifecycle (Task 3) in
view at once; the boot fragility needed `restore` (Task 2) and `isSavedRoom` (Task 1). Ten clean
task reviews preceded them.

**Three commits reached the branch without review**, made directly during the live by-hand session
while the owner was waiting. The final review cleared all three — and found a hollow gate in one of
them. Speed under an observer is exactly when the process gets skipped, and exactly when it is
paying for itself.
