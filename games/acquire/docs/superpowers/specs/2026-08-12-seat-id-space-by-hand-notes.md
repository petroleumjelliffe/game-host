# Seat-id space — by-hand pass

**Date:** 2026-08-12
**Branch:** `fix/seat-id-space`
**Built bundle** served by `npm run preview`, against a private server on `PORT=3002` with its own
`GAMES_DIR`, so nothing touched the server another shell had on 3001.

**Driven with real socket.io clients rather than browser tabs.** Seat ids are not rendered
anywhere, and one browser profile holds one identity per room — so three seats in one room cannot
come from three tabs. A short script opened real sockets and read the roster broadcasts directly,
which is both more seats and better evidence: the actual ids, not an inference from the screen.

## The sequence, as observed

```
1. three seated      p1:Player 1*  p2:Player 2  p3:Player 3
2. p2 left           p1:Player 1*  p3:Player 3
3. newcomer joined   p1:Player 1*  p3:Player 3  p2:Player 2
   ids unique?       true (3 seats)
4. filled            p1* p3 p2 p4 p5 p6
5. seventh join      REFUSED (seatRefused)
   seats still       6
```

`*` marks the host.

**Line 3 is the bug fixed.** Before this change the newcomer would have been minted a second `p3`,
because ids came from `players.length` and the array had shrunk. Two seats would have shared a
roster key, and rename, rejoin and socket→seat binding lookups would all have resolved to
whichever `find` reached first.

**Line 5 is new behaviour.** The server previously enforced no player limit at all: a seventh
client would have been seated, and the engine would have had no emoji for it, since it assigns
them by seat index. `seatRefused` is the existing refusal path — capacity needed no new code,
because `join` returning null was already how a refusal is signalled.

**Exactly one host throughout.** This is the trap the plan called out: `leaveSeat` promotes
`players[0]` when the host goes, so a newcomer taking a freed first id would arrive believing it
is host as well. `isHost` is now "this room has no players yet" rather than "index zero". The
guard fails with `expected length 2 to be 1` when that is put back — proven, not assumed.

## Not covered

- **A host leaving and the freed `p1` being retaken, over sockets.** Covered by unit test, and by
  the reasoning above, but the drive above only vacated a middle seat. Reaching it needs the host
  to leave a room that still has players, which the script did not do.
- **Rejoin-by-token onto a reused id.** If a seat is vacated, retaken by someone new, and then the
  original holder presents their old token, they must be refused — the token no longer matches
  that id's holder. The registry checks `existing.token !== token`, so it should refuse, but this
  was not driven.

Both are worth a follow-up rather than a claim.

## Verification

838 tests in 80 files (830 before, plus 8 new), `typecheck` clean. `server/recovery.test.ts` run
explicitly: saved rooms still restore, which was the one thing that could have broken silently in
production had the id strings changed. They did not — only how a seat is chosen.
