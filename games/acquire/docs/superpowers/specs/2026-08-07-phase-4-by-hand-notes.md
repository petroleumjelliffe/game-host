# Phase 4 — by-hand notes

**Date:** 2026-08-07
**Driven by:** the owner, on a laptop and a phone, against a local server — **not prod**
**Branch:** `revamp/phase-4-presence-and-recovery`

Five findings, four of them bugs, none of which the 661-test suite could have produced. Plus a
setup failure that invalidated the first round of results, which is the most transferable lesson
here.

## The setup failure, first, because it wasted the first round

Two dev servers from the **main checkout** — started the previous day — already held ports 5173 and
3001. Vite silently bumped the worktree's server to 5174; the worktree's game server never bound at
all. Everything in the first round therefore measured `main`, which has none of Phase 4, including a
"refresh works fine" pass that was recorded as a success.

It was found by mapping every listening port to its process's working directory, not by reading
code:

```bash
lsof -nP -iTCP -sTCP:LISTEN | awk '$1=="node"{print $2, $9}' | sort -u | while read P ADDR; do
  echo "$ADDR  $(lsof -a -p $P -d cwd -Fn | grep '^n' | cut -c2-)"
done
```

**The quotes around `'^n'` are load-bearing in zsh**, which is this project's shell. Unquoted, `^n`
is zsh's extended-glob negation — "every file except one named `n`" — so it expands to the whole
directory and `grep` reports `dist: Is a directory` instead of a working directory. Recorded on
2026-08-07 after the unquoted version, as originally written here, failed for the next person who
ran it. A command whose whole job is to stop you measuring the wrong tree is worth having work in
the shell you actually use.

**Before any by-hand pass, verify which _tree_ is serving — not merely that something is.** A dev
server that silently moves to the next free port is indistinguishable, from the browser, from the
one you meant to start.

## Finding 1 — the dev client dialled `localhost:3001`

A phone loading the app from `192.168.1.239:5173` sat on "Connecting…" forever. `connection.ts`'s
development fallback hardcoded `localhost`, which on any device other than the dev machine means
*that device*. `npm run dev` is `vite --host`, so the app is served across the network on purpose;
the socket URL never got the same treatment.

Fixed by deriving the host from the page. Pre-existing, not introduced by Phase 4.

**Why no test could catch it:** `connection.ts` is deliberately untested in isolation — its own
docstring argues a test stubbing `io()` would restate the file rather than check it. That reasoning
holds for the socket wiring and fails for a value derived from the environment. One machine cannot
reveal this bug; two devices reveal it in one attempt.

## Finding 2 — the pill blamed a server it never reached

With the phone's wifi off, the strip read `Waking the server — this can take up to 30 seconds`. It
had not reached the server, or tried.

Fixed with `navigator.onLine`, used as a one-way signal: false is definitive, true only means an
interface exists.

**But the fix does not close the case that was observed, and the owner confirmed why:** the phone
had cellular. It was genuinely online; it simply could not reach a `192.168.x.x` address.
`navigator.onLine` was correct throughout. The fix is right for a truly offline device (airplane
mode shows it) and useless for online-but-unreachable, which is the case that actually happened.

**Still open.** The honest repair is copy that asserts no cause at all — `Can't reach the server —
retrying` is true whether the server is asleep, unreachable, or behind a captive portal. Left for
the owner to rule on rather than churned mid-test.

## Finding 3 — the join form flashed on every reload with a stored seat

Reloading mid-game showed a blank screen, then a join form, then the board.

The join is sent from an effect, so in the render where the socket first reads as open, `joining` is
still false and the phase expression fell through to `needName` — painting a join form at someone
already holding a seat and about to be put straight back into their game.

Fixed with an `autoJoins` term that says the same thing `joining` does, one frame earlier.
Pre-existing since Phase 3b; every `RoomPage` test passed over it.

**Why no test caught it:** a settled-DOM assertion cannot see a one-frame flash. `render` flushes
its effects inside `act`, so the offending frame is gone before any `expect` runs. The test that
does catch it records **every phase across every render** rather than the final DOM.

## Finding 4 — unreadable saves warn on every boot, forever

23 stale version-3 files (written by a baseline test run, back when tests still wrote to the real
`server/games/`) produce 23 warnings at every server start. Eviction only deletes records that are
too *old*; a permanently unreadable one is refused and kept.

The glyph was changed from `✗` — vitest's own failure marker — to something neutral. **The eviction
half is deliberately not fixed:** deleting a file you could not parse is destructive, and deserves a
decision rather than a reflex. Phase 4 did stop tests polluting the real directory; the registry now
defaults to a null store.

## Finding 5 — "the two laptop tabs never noticed the loss" — could not reproduce

Reproduced under control instead: two isolated browser contexts, a real started game, board in the
foreground, server killed with an epoch timestamp shared between the shell and the page's own clock.

| ms after kill | pill |
|---|---|
| **98** | `Disconnected — reconnecting…` |
| 398 | `Connecting…` |
| **3398** | `Waking the server — this can take up to 30 seconds` |
| 41698 | *(gone — server back, board intact)* |

Detection is effectively instant and the pill stays up for the whole outage. The 3398ms transition
is the cold-start threshold landing exactly where designed. No mechanism was invented for the
original observation; most likely the phone was being watched and the laptop had recovered by the
time it was looked at.

**A near-miss worth recording.** A first pass at this produced a confident *"detection takes 4–7
seconds"* finding, with a table — derived entirely from an **unmeasured** gap between installing the
in-page recorder and firing the kill. It was wrong by two orders of magnitude. It survived only
until someone re-measured against a shared clock instead of writing it up. That is the same failure
shape as this project's hollow gates: a number that was never actually measured, presented as a
measurement.

## The three recovery scenarios, as driven

**Refresh mid-turn — passes.** Player 2 placed E10 into an open segment (hand 6→5, undo and End turn
both offered, nothing committed), then a real page reload. After it: E10 still `filled`, hand still
five, undo and End turn still present — the open segment, not the turn start. Ending the turn then
committed, drew a replacement, and passed the toast, proving the restored draft was actionable
rather than merely rendered.

**Dropped socket mid-turn — passes.** Driven twice: by the owner turning a phone's wifi off and on,
and under control as Finding 5 above.

**Server restart — passes.** Killed on a real three-player game (`JH3JDL`, stage `play`, 14 tiles
placed). The boot log order is the ordering guarantee, visible in production output:

```
! Ignoring unreadable save client-G1.json      (×23, Finding 4)
✓ Restored 1 room(s)
✓ Server listening on 3001
```

`Restored` precedes `listening`, so no client can reach a half-restored registry. All clients
reconnected on their own, no form, nothing re-entered.

**Also demonstrated by accident:** a room created but never started did **not** survive the restart,
and rejoining it produced the `RoomGone` screen. That is the lobby-is-never-persisted rule and the
gone-room screen, both confirmed on a real screen without anyone planning to.

## What this pass did not cover

- **Prod.** All of the above is local. The design specified "then the same three by hand, on prod",
  and that has not happened. On Render free the restart pass is *expected* to end at the gone-room
  screen, and that is a pass, not a failure — but it remains a prediction.
- **A full game to final scoring**, including a merger whose liquidation queue reaches a second
  player. Still owed since Phase 3b.
- **The away dot on a measured page.** Never rendered by the layout gate or the catalog.
