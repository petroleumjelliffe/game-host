# By-hand pass — Task 9 Step 3

Two browser contexts via chrome-devtools MCP: page 5 (host, default context) and page 6
(guest, `isolatedContext: "player2"` on `new_page`) — genuinely separate `localStorage`,
confirmed empirically before relying on it. No raw socket.io fallback was needed.

`npm run dev:all`: vite settled on the default port 5173 (banner: `Local: http://localhost:5173/`);
server logged `✓ Server listening on 3001`.

Room created: code `3EHJA2`.

## Leg 1 — Create + join, roster live

Host: clicked "Create Room" on `/online` → landed on `/room/3EHJA2`, card showed code `3EHJA2`,
seat row "Player 1 · HOST", "Waiting for another player" disabled.

Guest: navigated a second, isolated-context page straight to `/room/3EHJA2` (this is the same
route `/online/join`'s submit and `OnlineLobbyPage`'s create both land on — confirmed by reading
`src/pages/JoinRoomPage.tsx` / `OnlineLobbyPage.tsx`, both `navigate('/room/${roomId}')`). Guest
seated as "Player 2" immediately (nameless join, server-named — matches the "nothing asks for a
name" ruling).

Host's roster updated live to show both seats; "Start game" became enabled.

**PASS.**

## Leg 2 — Rename, live broadcast

Host renamed its own row "Player 1" → "Hosty" (fill + Enter, per `RoomLobby.tsx`'s
commit-on-blur/Enter). Guest's screen showed "Hosty" live, no action needed.

Guest renamed its own row "Player 2" → "Guesty" (fill + Enter). Host's screen showed "Guesty"
live.

**PASS.**

## Leg 3 — Guest leaves, seat vacates, rejoins

Guest clicked "Leave" → navigated to `/`. Host's card immediately dropped the second row and
"Start game" reverted to disabled "Waiting for another player".

Guest navigated back to `/room/3EHJA2`. `leaveSeat()` had cleared the room-scoped identity key
(`acquire.room.3EHJA2`) but not the app-wide remembered name (`acquire.name`); the fresh join
therefore carried the remembered name "Guesty" automatically and the server (re-)seated the guest
under that name with a new `playerId`/token. Host's roster showed "Guesty" back, "Start game"
re-enabled. This is documented, intended behavior (the "names you played with last time" feature),
not a nameless rejoin.

**PASS.**

## Leg 4 — Begin, turn-order draw, hand-off, winner announced

Host clicked "Start game" → turn-order-draw screen ("2 still to draw"). Host clicked "Draw your
tile" → drew `G6`; toast "Guesty is up". Guest's screen (same shared room state) showed "1 still
to draw" and its own "Draw your tile" button; clicked it → drew `G1`; its own screen then showed
"TURN ORDER — Hosty drew highest G6 and plays first" as a distinct step, and the game opened
straight into Hosty's "PLACE A TILE" step with dealt hands (toast "Hosty is up" on host's side).

**PASS** — winner announced as its own step, curtain rose only on the real actor change (host →
guest → back to host), matching the design doc.

## Leg 5 — Refresh the actor mid-draft, resume to open draft

As host (actor), placed tile `A8` (step became "PLACED A TILE — A8" with an undo button; "BUY
SHARES (0/3)" step and "End turn" button appeared). Reloaded the host page (`navigate_page
type=reload`).

After reload: identical state restored exactly — "PLACED A TILE — A8" with undo, "BUY SHARES
(0/3)", "End turn" present, live toast "Your turn". The uncommitted draft (tile placed, turn not
ended) survived the page refresh via the `resume` path.

**PASS.**

## Leg 6 — Kill and restart the server process

Found and killed the `tsx watch server/index.ts` PID (`kill 56921`). Within a couple seconds:

- Host: alert `"Disconnected. Reconnecting…"`.
- Guest: status `"Can't reach the server — retrying"`, then alert `"Disconnected. Reconnecting…"`.

Restarted with `npm run dev:server` (background); log showed `✓ Restored 1 room(s)` /
`✓ Server listening on 3001`. Both clients reconnected automatically within ~5s (socket.io's
built-in backoff — no manual action taken):

- Guest: game state resumed cleanly, no lingering disconnected banner, "Hosty is up" showing.
- Host: reconnected but back at the **committed** state ("PLACE A TILE", fresh hand) — the
  uncommitted draft from Leg 5 (tile `A8` placed, turn not ended) was **not** present after the
  real process restart, unlike the same-process page-refresh case in Leg 5.

This is expected, not a deviation: per `server/store.ts`'s documented contract, only the room's
*last committed state* is persisted to disk and restored at boot — an open draft is server
in-memory-only and does not survive the process dying. Leg 5's resume worked because the server
process (and its in-memory draft) never went away; Leg 6 kills that process, so there is nothing
left to resume into but the last committed segment. Both clients rejoined their seats and the game
continued correctly from there (placed `A8` again, ended turn, "Guesty is up").

**PASS**, with the above noted as expected architecture, not a bug.

## Leg 7 — Made-up room code

Navigated a page to `/room/ZZZZZZ`. `RoomGone` screen: heading "This room is no longer available",
body "ZZZZZZ has ended, or the server restarted and did not keep it." (names the code). "Back to
the lobby" navigated to `/`.

**PASS.**

## Leg 8 — Token-lost reclaim (mid-game)

On the guest, deleted both `acquire.room.3EHJA2` and `acquire.name` via `evaluate_script`, then
reloaded `/room/3EHJA2`.

**Nameless join was refused**, as expected: screen `RoomRefused` — "Could not join 3EHJA2" /
"That seat in 3EHJA2 is no longer yours — join again to take a new one". **PASS for this part.**

**Deviation from the leg as written.** The plan's leg 8 describes retyping a wrong name, then the
exact name, *on this refusal screen* to reclaim the seat. That path does not exist:
`src/lobby/ui/RoomRefused.tsx` has no name field by design — its own doc comment states "Deliberately
not a name form... nothing asks who you are on the way into a room any more" (an owner ruling
predating this branch, per `docs/superpowers/plans/2026-08-07-lobby-flow-corrections.md`). Its
"Try again" button (`RoomPage.tsx`: `onRetry={() => room.join()}`) always retries a **nameless**
join, which is refused identically every time — confirmed by clicking it, which reproduced the
exact same refusal message with no progress. Read literally, the leg's flow ("retype a wrong name…
retype the seat's exact name" on this screen) is not reachable through the current UI at all.

**The underlying honor-reclaim mechanism does work**, verified by driving it through the actual UI
path that carries a name: `/online/join` (route `JoinRoomPage` → `JoinRoomCard`, which does have a
"Your name" field). Typed room code `3EHJA2` + wrong name `WrongName` → submit → refused with the
identical `seatRefused` message, inline on that form. Then corrected the name to `Guesty` (the
seat's exact name) → submit → navigated to `/room/3EHJA2`, seated as Guesty, "Your turn", tiles in
hand, playable — full reclaim. Confirmed via `localStorage`: `acquire.room.3EHJA2` held a
**new/rotated token** (`cd64db23-…`, previously `836d2101-…`) under the same `playerId` `p2`,
matching `server/lobby/rooms.ts`'s documented "honor-system reclaim" (case-insensitive name match
on a disconnected seat, token rotated).

**Net for Leg 8: mechanism PASS, UI-path DEVIATION.** The server + headless hook fully support
retyping a name to reclaim a lost seat, and it works correctly end-to-end — but the screen the
plan names (`RoomRefused`) offers no way to do it; a player has to know to leave that screen and go
through `/online/join` instead. Whether that's an acceptable gap or a UI wiring omission is a call
for the owner; recorded here as observed, not fixed (no source was changed).

## Second-player strategy

`new_page` with `isolatedContext: "player2"` — true separate browser storage in one MCP session,
no raw socket.io fallback needed.

## Teardown

Killed the `concurrently` parent, the `vite --host` process, and the `tsx watch server/index.ts`
process for this worktree. Verified no processes remain under
`.claude/worktrees/lobby-extraction-plan`.
