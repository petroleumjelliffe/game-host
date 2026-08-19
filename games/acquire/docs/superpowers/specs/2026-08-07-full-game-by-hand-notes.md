# Stage 0 — the two-browser full game, by hand

**Date:** 2026-08-07
**Driven by:** the owner, two browser profiles, against a local server
**Branch:** `revamp/stage-0-by-hand-setup`
**Plan:** [../plans/2026-08-07-by-hand-full-game.md](../plans/2026-08-07-by-hand-full-game.md)

**The pass owed since Phase 3b is done.** A merger whose liquidation queue reaches both players (G2)
and a game driven to final scoring in two browsers (G9) were both driven end to end. Both pass.
Four findings, one of them fixed in this branch.

**What made it possible, and why it had waited three carry-forwards.** There was no way to put a
browser into a mid-game room: `rooms.fromState` seats prepared states for tests, but
`socketHarness.ts` records that "there is deliberately no socket event that installs a prepared
state", and the only HTTP route was `/health`. Reaching a two-player liquidation queue therefore
meant playing a real game until a merger happened *and* both players happened to hold the dying
chain's stock — minutes per attempt, non-deterministic, unrepeatable. `POST /dev/rooms` makes it two
commands. **The pass was not hard; the setup was, and nobody had built it.** Worth remembering the
next time an owed item survives three phases.

## Finding 1 — a sold-out survivor said nothing, it just went inert

**Fixed in this branch** (`e670cb5`).

G2 leaves Messla with exactly one available share, so one trade empties the pool and the trade
button greys out. Nothing said why. A disabled button and an exhausted pool looked identical, and
the player had no way to learn which had happened — or that they had not done something wrong.

`canTrade` is false for three unrelated reasons: not your turn, fewer than `TRADE_RATIO` shares in
hand, or an empty survivor pool. The first two are legible from the rest of the panel. The third was
invisible everywhere.

The repair uses the buy step's own vocabulary — a muted `sold` badge and the name `Messla — sold
out` — rather than inventing a second way to say the same thing (owner's suggestion, and the right
one: that row already says exactly this about exactly this fact).

**Why no test could have caught it.** Every existing test asserted the button was *disabled*, which
it correctly was. Nothing asserted the player could tell *why*, because "the UI is inert and mute"
is indistinguishable from "the UI is inert and clear" to a query that only reads the `disabled`
attribute. It needed someone to click it and wonder.

## Finding 2 — the engine's three liquidation refusals are unreachable from the UI

**Not a bug. Recorded because it changes what those rejections mean.**

G2 encodes three illegal liquidations, and all three are proven at the protocol level by
`goldenSocket.test.ts` and `clientOverWire.test.ts`. Driving the panel by hand, **none of them can
be constructed**:

| Refusal | Why the panel prevents it |
|---|---|
| `oddTradeCount` | the trade control moves in increments of `TRADE_RATIO` |
| `notEnoughShares` | the trade disables the moment the survivor pool is claimed |
| `shareCountMismatch` | the split allocates the remainder rather than letting three numbers disagree |

This is the right design — prevention beats explaining an error after the fact — with one
consequence worth writing down. `liquidate` is one of the six intents `NetworkSession` applies
**optimistically**, so a refused liquidation would roll back through a `reset`. That rollback is now
known to be unreachable by a player, which means it is untested by hand *and* untestable by hand.
Safe only while it stays unreachable: a future change that relaxes any of the three constraints
above silently re-arms a path nobody has ever seen work.

## Finding 3 — the away dot is invisible for a seat the roster clips

**Open. It is a design decision, not a patch.**

Jordan's seat in G9 was left unopened, so he was disconnected for the whole game — and he **could
not be seen at all**, because the players strip had clipped him off the end of the row.

The strip clips on purpose. Its own comment says so: one row, `overflow-hidden`, the active seat
`flex-none` at the front and everyone else shrinking away past the end, because six seats want
~1000px and the panel has ~320px. `rotateToActive` guarantees the seat that matters is the visible
one. "A tap-to-expand view is the eventual answer; this is the honest interim."

**But presence rides in that row and only that row.** So the away dot can be geometrically
guaranteed to exist and still never be seen.

**This contradicts a Phase 4 ruling, and the way it was reached is the lesson.** The final review
traced this geometry and ruled the away dot did not block merge — reasoning from `overflow-hidden`,
`flex-none` and index 0 that the dot would be where it needed to be. The reasoning was correct and
the conclusion was wrong, because it answered "is the dot rendered?" and the question was "can the
player see it?" The same carry-forward flagged that nobody had looked at a measured page; that is
now done, and looking took one game.

**One nuance that saves the urgent case.** A *disconnected actor* is rotated to the front, so when
the game is actually stalled waiting on someone who has dropped, their dot is visible. What is lost
is presence for anyone who is not the actor — less urgent, still information the player asked for.

**Why no test could have caught it.** jsdom reports zero for every layout property, so a structural
test asserting the dot exists passes while the seat carrying it sits past the edge of a clipped row.
`verify:layout` drives pass-and-play, where presence is absent by design, so it never sees this
either — which is the gap the Phase 4 carry-forward already named and attributed to `/catalog`
having no away state.

## Finding 4 — the final scoring screen has no presence at all

**Open. Smaller, and a product call.**

There is no away dot on the final screen, and this is structural rather than a rendering accident:
`presence` reaches exactly two places in `GameScreen` — the players strip's `connected` flag and the
actor-disconnected flag — and `FinalScoring` receives neither. Nobody on that screen can tell who is
still there to see the result.

Whether that matters is a decision. An argument for: the end of a game is exactly when you want to
know whether the other players are watching. An argument against: the game is over, nothing waits on
anyone, and a dot with no consequence is noise.

## Finding 5 — the pre-flight command failed in this project's own shell

**Fixed** (`dd701d7`).

The Phase 4 notes' port-to-working-directory check — presented there as the command that saves a
by-hand round — is written `grep ^n`. In zsh, `^n` is extended-glob negation, so it expands to every
file in the directory and grep answers `dist: Is a directory`. It failed for the first person who
ran it after it was written.

It also masked a second problem: the run had **no game server at all**, because `npm run dev`
starts Vite alone. The broken check produced output that looked like a result, and the missing 3001
would not have surfaced until the first room failed to connect — at which point the natural suspect
is the new seeding route rather than the setup.

**A check whose entire purpose is to stop you measuring the wrong thing measured nothing, and looked
like it worked.** That is this project's signature defect, in the tooling rather than the tests.

## What passed

- **G2, the merger.** Alex places C1, Messla survives at 10 tiles, payout $4,000 / $2,000, both
  liquidations driven, queue reaches both players, merger closes to `buy`.
- **G9, final scoring.** The 41st tile, the end declared, and final scoring rendered in both
  browsers.
- **The seeded seat.** Both browsers landed straight on a mid-game board — no join form, no lobby —
  and the credentials were stripped from the address bar on arrival.

## Still not covered

- **Prod.** Everything here is local. Two of Phase 4's three recovery scenarios remain owed on
  Render; the restart scenario was separately confirmed there on 2026-08-07.
- **A merger with three or more absorbed chains** (G7), and a tied merger where the placing player
  chooses (G13). Both are seedable now, so both are cheap.
- **`LiqQueue` still has no design review.** It has now at least been *seen*, which is more than was
  true this morning.
