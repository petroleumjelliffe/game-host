# Lobby view model — by-hand pass

**Date:** 2026-08-12
**Branch:** `feat/lobby-view` (stacked on `fix/seat-id-space`)
**Built bundle** via `npm run preview`, against a private server on `PORT=3002`.

## What the screen can now say that it could not

Creating a room shows **six seats, five of them empty** — dashed, dimmed, each carrying its own
emoji, above a Start button that states why it is disabled:

```
🦊 ● [Player 1]  HOST
🐢   Empty seat
🦁   Empty seat
🐙   Empty seat
🦉   Empty seat
🐝   Empty seat
     [ Waiting for another player ]   (disabled)
```

Before this, the roster carried occupied seats alone, so the screen showed **one row** and had no
way to express that the room had space at all. The emoji on an empty seat come from
`seatEmoji(seat.index)` — decoration derived from position, exactly the model settled in step 4.

Also confirmed on the running app: exactly **one** name field, on your own row; the Start button
disabled with `Waiting for another player`; the room code and Share button unchanged.

## Two findings, both from the typecheck rather than the browser

### 1. The view's first input type shut out its own consumer

`lobbyView` originally took `LobbyRoomState` — `useLobbyRoom`'s return type. Acquire's page does
not have one: `useRoom` wraps the hook, adds a `playing` phase and folds `gone`/`stale` into it,
returning a `Room`. So the first version of the shared thing did not fit the only consumer there
is.

Now it takes a minimal structural `LobbySnapshot` — `phase`, `status`, `roster`, `playerId` — so a
game's own wrapper satisfies it. That matters beyond Acquire: Rail Baron will wrap it differently
again, and a view that demanded the hook's exact return type would have excluded it too.

### 2. The view was making a third copy of a ranking

It re-derived "stale outranks gone" from two booleans. That ordering is already decided in
`useLobbyRoom` (line ~223) *and* in `useRoom` (line ~102). A third copy is a third place to drift,
so `terminal` now reads off the phase and re-ranks nothing.

Neither would have been caught by the browser — the screens look identical either way.

## Not covered

- **A second real player.** Both tabs share one profile and therefore one identity per room, the
  same limit as every pass in this sequence. So the occupied-seat rendering was exercised with one
  seat, not two; the two-seat case is covered by `RoomLobby.test.tsx`, which builds its view
  through `lobbyView` rather than by hand.
- **`beginBlocked: 'alreadyBegun'`** on screen. It is unit-tested, but reaching it live needs a
  started game.

## Verification

857 tests in 81 files (838 → 854 with the view, → 857 with the seat-rendering tests). `typecheck`,
`check:bundle` and `verify:layout` all clean. Both headline guards proven to fail first: dropping
the capacity pad gives `expected length 2 to be 4`, and dropping the lifecycle check on renaming
gives `expected length 1 to be 0`.

Verified by grep that neither consumer re-derives anything any more — no `players.find`, no
`players.length >= 2`, no `myPlayerId`.
