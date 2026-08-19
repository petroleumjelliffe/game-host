# The round after Phase 4 — sequencing and rulings

**Date:** 2026-08-07
**Status:** sequencing decided; two of the four stages still need their own design pass
**Predecessor:** [2026-08-07-phase-4-carry-forward.md](./2026-08-07-phase-4-carry-forward.md)

Every phase on the roadmap is built. This records what the next round is, in what order, and the
three rulings made on 2026-08-07 that were blocking it.

## The rulings

| Question | Ruling |
|---|---|
| What comes first | **The by-hand full game**, before any of the planned fixes. It is owed since Phase 3b, it is cheap, and every by-hand pass this project has run has changed the fix list that followed it. |
| Pass-and-play save format | **The whole `GameState`, with a version.** Not seed-plus-intent-log. Closes the last open design question in [the persistence decisions](./2026-08-06-pass-and-play-persistence-decisions.md). |
| `verify:layout` flakiness | **In scope.** It is cited as evidence across two phases and nobody can explain it. |

**Why whole state rather than the intent log.** The log is smaller and self-verifying, and the replay
machinery already exists. But under a changed rule an old log replays into a *plausible but
different* game — it loads, it looks fine, and it is wrong. A versioned state blob refuses loudly
instead. It also matches what `server/store.ts` already does, so the project has one persistence
model rather than two, and it keeps the final state, which the "library of finished games" TODO
needs. The failure mode being avoided is this project's signature one: a thing that looks like it
worked and was never checked.

## Stage 0 — The by-hand full game

A full two-browser game to final scoring, through a merger whose liquidation queue reaches **both**
players. Plan: [../plans/2026-08-07-by-hand-full-game.md](../plans/2026-08-07-by-hand-full-game.md).

**Why it is first, stated as evidence rather than principle:** Phase 5 produced twenty-six findings
from a by-hand pass and none from the suite. Phase 4 produced five, none of which 661 tests could
have produced. Planning versioning and persistence in detail against a fix list that has not been
validated by the one pass nobody has run is how this project has been surprised before.

**The finding that reframes the stage.** There is no way to put a browser into a mid-game room. The
server has `rooms.fromState(roomId, names, state)`, and every socket-level test uses it, but
[socketHarness.ts:85](../../../server/socketHarness.ts#L85) records the reason it stops there:
*"there is deliberately no socket event that installs a prepared state."* The only HTTP route is
`/health`. So reaching a two-player liquidation queue in a browser today means playing a real game
until one happens by chance — non-deterministic, several minutes per attempt, and not guaranteed to
produce a queue that reaches both players at all.

**That is very likely why this pass has never been run,** through three consecutive carry-forwards.
So the stage opens by building the setup: a dev-only seeding route, after which the pass is two
clicks and is repeatable — which matters, because it will need re-running after each of the stages
below.

## Stage 1 — Versioning

> **Built, 2026-08-07** — `d78d141..27f9f51` on `revamp/stage-0-by-hand-setup`, all eight tasks,
> 710 tests. Plan: [../plans/2026-08-07-stage-1-versioning.md](../plans/2026-08-07-stage-1-versioning.md).
> Both open decisions were ruled as recommended: `versionMismatch` mid-game tears the session down
> (keeping the stored seat, unlike `noSuchRoom`), and the pill now says
> `Can’t reach the server — retrying`. The section below is the plan as it stood; deviations are
> recorded in the commits — chiefly that the client screen is **not** in `/catalog`, which carries
> no online components at all, and that Task 4 merged into Task 1 when the required field made the
> compiler enumerate all five send sites. **Not deployed:** Render still speaks the pre-version
> wire, observable as `/health` answering `{ok:true}` with no version fields. On deploy, every
> already-open client is refused as stale until reloaded — expected, and the reason the refusal has
> its own screen.

**Scope:** a protocol version, and the save-side skew that now exists because rooms outlive a
deploy. The roadmap's PWA section already specifies the shape; this stage builds it ahead of the
PWA rather than inside it.

`session/protocol.ts` has **no version field of any kind** — verified, zero matches. Three parts:

- **A constant in `protocol.ts`**, bumped when the wire shape changes. That file owns `WireIntent`,
  `StateMessage`, `CLIENT_EVENTS` and `SERVER_EVENTS`, so it is the only place that knows what
  "changed" means.
- **Checked at the handshake that already exists** — the client sends it on `joinRoom`, the server
  answers on `joined` or refuses. **A mismatch needs its own `RejectionCode`.** The list today is
  `illegal… | undoOutOfSegment | notConnected | noSuchRoom | seatRefused`; refusing skew as
  `noSuchRoom` sends a player hunting a room that is fine.
- **Server side too.** A room restored from disk was written by whichever server wrote it, so a
  resumed room carries a version as well — the same skew arriving from storage instead of a socket.
  Note that `SAVE_VERSION` does not already cover this: `isSavedRoom` deliberately trusts `state`
  past "is an object", which is the hole Phase 4's boot-fragility bug came through.

**Urgency, stated honestly:** this is not urgent *today*. A stale client fixes itself on the next
reload. It becomes urgent the moment a service worker makes an old client durable, and it is much
cheaper to add before there are two versions in the wild than after.

**Still to decide:** what the client does with the refusal. For an installed app the answer is
prompt-to-update and reload past the service worker; before the PWA exists there is no service
worker to reload past, so the first version of this may be a plain message. Worth deciding once
rather than twice.

## Stage 2 — Pass-and-play persistence

> **Built and verified by hand, 2026-08-07** — `205f5b1..98c8fb1` on
> `revamp/stage-2-pass-and-play-persistence`, Tasks 1–4, 734 tests; the owner drove the by-hand
> pass locally and reported it clean. Two things the build itself surfaced: the exported mockup
> settles that the nothing-saved card has **no New Game button at all** (the decisions doc's
> transcription said otherwise — the frame is the copy of record), which makes "confirm only when
> a game exists" structural; and the layout gate broke against its own persistent Chrome profile —
> the game the gate plays is now *saved*, so its previous run seeded a Continue card its next run
> tripped over. Fixed by clearing storage in the script, and **recorded as a Stage 3 lead: a
> persistent profile makes every run depend on run history**, which is a live candidate mechanism
> for the gate's long-unexplained flakiness.
>
> **The PWA's two stated gates now both exist:** pass-and-play persistence (this stage) and a
> protocol version (Stage 1). Its remaining prerequisite is nobody's ruling but the owner's go.
>
> **Designed and planned, 2026-08-07:**
> [2026-08-07-stage-2-pass-and-play-persistence-design.md](./2026-08-07-stage-2-pass-and-play-persistence-design.md)
> and [../plans/2026-08-07-stage-2-pass-and-play-persistence.md](../plans/2026-08-07-stage-2-pass-and-play-persistence.md).
> The design answers the decisions doc's open questions: `LOCAL_SAVE_VERSION` is its own constant
> (importing `server/store.ts` into `src/` is the wrong direction on the one policed boundary); a
> stale save is *reported* in the lobby, kept until `New Game` overwrites it — never silently
> absent; and the discard confirmation is inline on the card, confirming only when a game exists.

The real project of this round, and the one with a mockup already attached. Most of it is ruled in
[2026-08-06-pass-and-play-persistence-decisions.md](./2026-08-06-pass-and-play-persistence-decisions.md);
the format ruling above closes the last open design question, so this stage can now have a design
doc written.

Today [PassAndPlayPage.tsx](../../../src/pages/PassAndPlayPage.tsx) is 53 lines holding the game
config in `useState`. There is nothing to build on — a refresh or a back-button press destroys the
game. The work is the route split, save-on-commit, the reveal curtain on load, the lobby's Continue
card, `End game`, and `New Game` discarding with a confirmation the mockup does not have.

**What its design pass still owes:** the storage key and what happens to a save that predates a
rules change; and whether the new storage module reuses `src/net/identity.ts`'s conventions or says
why not.

## Stage 3 — The layout gate — **CLOSED 2026-08-08**

> **It was the gate's own arithmetic.** Each zone's height was rounded to the nearest pixel and
> *then* summed and compared exactly. Layout heights are fractional (`staging: 173.5`,
> `net: 16.5`, `hand: 117.5` in a real run), so a height near `.5` rounds up on one run and down on
> the next, and the `stepstack+active` sum shifts by 1px — 2px worst case — with no layout change
> at all. Caught as `1440px: stepstack+active grew 550px -> 551px`, once in 15 runs.
>
> Fixed by capturing heights raw and comparing against a 1px tolerance, rounding only for the
> message. Verified in both directions: the flake stopped, and a deliberately re-broken holdings
> floor (68px → 64px, the real 4px defect this gate once caught) still fails at both widths with
> the original wording.
>
> **The stated fear was right, and pointed the wrong way.** "A gate nobody can explain is the same
> defect one level up" — true, and the defect was in the gate. What the diagnosis actually cost was
> mostly spent elsewhere: two run-history hazards were found and removed (Chrome's singleton lock, a
> stale `vite --strictPort`) and *neither* was the cause. Worth keeping anyway; they let two gates
> run concurrently, which is how the reproduction became affordable.
>
> **The uncomfortable part.** The caveat's first written appearance already called the problem
> "project-wide and pre-existing" with no failure shape, no seed and no run behind it, and it was
> quoted forward through five phases — weakening every "five gates green" claim in all of them on
> the strength of a belief nobody had reproduced. This repo insists a test prove it can fail; the
> same standard was never applied to the claim that a gate was broken.

The section as it stood:

`npm run verify:layout` is intermittently flaky, project-wide and pre-existing. This is not a
feature bug and that is the point: in a repo that has caught eleven hollow gates by insisting on
real evidence, a gate nobody can explain is the same defect one level up. Every "five gates green"
claim in the last two phases is weaker than it reads until this is understood.

Diagnose before fixing. A flake with an understood cause may be acceptable; a flake with an
unknown cause cannot be cited as evidence either way.

## The sweep

Small carried items, each riding whichever stage touches its file rather than becoming a stage:

| Item | Rides with | Size |
|---|---|---|
| `previousSegmentStart` is not on `SavedRoom`, so a resumed restored room shows a blank previous turn — the exact gap the field was added to close | Stage 1 | one field |
| Cold-start copy asserts a cause it cannot know; the honest repair blames nothing: `Can't reach the server — retrying` | Stage 1 | a product ruling, then one string |
| Unreadable saves warn on every boot forever — eviction deletes *old* records, not unparseable ones | Stage 1 | needs a quarantine decision, not a reflex delete |
| `restore()` is boot-only and only a docstring says so | Stage 1 | enforce it |
| **Presence is carried only in a row designed to clip**, so a disconnected non-actor can be entirely off-screen — observed 2026-08-07, and it contradicts the Phase 4 ruling. A disconnected *actor* is still visible, being rotated to the front | its own design pass, with the tap-to-expand roster the strip's own comment already anticipates | not a patch |
| `/catalog` has no away state, which is why the above went unseen | Stage 3 | catalog gap |
| The final scoring screen has no presence at all — `presence` never reaches `FinalScoring` | a product call | small once decided |
| `Board.tsx` renders a read-only cell as a `<button>`, putting it in keyboard tab order | Stage 0's fallout | small |
| Seat names truncate hard at 768px | Stage 3 | small |
| `sections.tsx` builds every fixture at module load | Stage 3 | small |
| `LiqQueue` has no design review — a Phase 1b finding restated in 2a, 2b, 3a, 3b and 4 | Stage 0 will put it on a screen for the first time | a design pass |

## Deliberately not in this round

- **The PWA itself.** Staged after pass-and-play persistence, because offline pass-and-play is the
  only offline story that works while the server is the authority. Stage 1 is its prerequisite, not
  its start.
- **The spectator seat and the panel-only phone view.** Wanted together, since the phone view
  depends on the spectator seat. Their own design pass.
- **A library of finished games.** Out of scope, but Stage 2's format ruling keeps it possible.
- **The prod by-hand pass.** Still owed from Phase 4. It is a separate errand from Stage 0 and
  should not be folded into it — Stage 0 needs a dev-only seeding route that must never reach prod.
- ~~**A durable `RoomStore` backend**~~ — **done 2026-08-08, and it was one line.** The paragraph
  below assumes a *free* instance, which cannot have a disk. The service is on Render's paid
  `starter` plan, which can: a 1 GB disk at `/var/data` plus `GAMES_DIR=/var/data/games` made the
  **existing file store** durable. No Key Value, no Postgres, no second `RoomStore` implementation.
  A room was created on prod, a deploy triggered, and it came back — `✓ Restored 1 room(s)`.
  See `CLAUDE.md`'s Environment section. **The plan was not wrong; it outlived its assumption**,
  which is worth checking against every other item here that was scoped against "Render free".
  (2026-08-07, post-Stage-1) re-confirmed the accepted limit: a Render restart still loses every
  room, because persistence writes to a disk that resets. The Render MCP connector is now set up,
  so provisioning a Render Key Value store or Postgres and writing the second `RoomStore`
  implementation is a session's work against the seam built for it. A decision for the owner, not
  a default: it converts the gone-room ending from the normal prod case into a rarity, which
  changes what the ending's copy and the eviction policy are for.
- **Dependency upgrades, and the outstanding `npm audit` advisories** (owner, 2026-08-07). Several
  packages have major versions available and an `npm audit fix` was run and reverted during Stage 0:
  it rewrote 885/1156 lockfile lines and added `baseline-browser-mapping` to `devDependencies`,
  which `browserslist` already declares itself. **Frozen until after Stage 2.** A dependency upgrade
  and a protocol change landing in one debugging window is a bad trade, and the revert showed how
  much `audit fix` moves unasked. Its own pass, with a full gate run after.
