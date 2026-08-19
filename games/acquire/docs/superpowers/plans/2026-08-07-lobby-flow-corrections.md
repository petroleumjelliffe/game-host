# Lobby Flow corrections — finishing what protocol v2 started

**Date:** 2026-08-07
**Branch:** `revamp/online-lobby-mockup` (unmerged, pushed) — continues on it rather than branching
**Design of record:** [2026-08-06-pass-and-play-persistence-decisions.md](../specs/2026-08-06-pass-and-play-persistence-decisions.md),
the "Join Room" and "New Room" sections. The exported Figma frame is the copy of record.

## Why this exists

`CLAUDE.md` says this branch is "the Lobby Flow design implemented in full". It is not. **Create
Room** got the treatment — seats you immediately, no name form, own-row editing. **Join Room** did
not: it still renders [JoinForm.tsx](../../../src/game/online/JoinForm.tsx), two labelled inputs
("Room code", "Your name"), no player row, no emoji chip, no letter-spaced code block.

Found by the owner in the by-hand pass, 2026-08-07, stated as three things:

1. the host does not need a `×` to boot themselves;
2. if names are editable in the room, nobody should type one before;
3. Join Room should take the code **in the same box** New Room shows the code in, after which the
   player list fills in with the others.

(2) and (3) are the spec, unimplemented. (1) **contradicts** the spec, which draws a `×` on your own
row in both cards — so it is a ruling, recorded below.

A fourth finding — the turn-order draw resolves instantly instead of passing the turn — is an engine
and protocol-v3 change and is **not** in this plan. It gets its own design pass.

## Rulings

| Question | Ruling | Note |
|---|---|---|
| The `×` on your own row | **Dropped entirely.** No row gets one. | `Leave`, below the roster, already does exactly this. The mockup's `×` was a duplicate control. `leaveSeat` on the wire stays — `Leave` sends it. |
| Typing a name before joining | **Gone.** Both cards seat you under a default. | Matches what Create Room already does. |
| Where the default name comes from | **The server, by seat.** `name` becomes optional on the wire. | Only the server knows your seat number, so only the server can name you `Player 3`. |
| Join Room vs New Room | **One card, two states.** | Code box read-only with a roster (New Room) or editable with just your row (Join Room). What [[lobby-screens-share-components]] asked for. |

**The wire is still free.** `PROTOCOL_VERSION` is 2, and v2 has never been deployed — prod speaks
v1. So making `name` optional costs nothing now and would cost a cutover later. That window closes
the moment this branch merges, which is the reason to do it in this branch rather than the next one.

## Tasks

### Task 1 — Drop the `×` from your own row

`RoomLobby.tsx` only. Remove the button; keep the name field and `Leave`. Update the tests that
assert it. `leaveSeat` in `useRoom`, `connection.ts` and the server is untouched — `Leave` still
sends it, and that path already has coverage.

**Verify:** the lobby renders no `Leave your seat` control; `Leave` still vacates the seat and the
roster shrinks in the other browser.

### Task 2 — The server names you when you don't

- `session/protocol.ts`: `JoinRoomMessage.name` becomes `name?: string`; the `createRoom` payload
  likewise. `PROTOCOL_VERSION` stays **2** — v2 is undeployed, so this is a correction to an
  unshipped shape, not a new version. Say so in the file, or the next reader will assume a missed bump.
- `server/rooms.ts`: when the name is absent or blank, assign one from the seat index. The emoji
  chip is already `PLAYER_EMOJI[seat]` in the client, so the name is a plain `Player N`.
- Client: stop sending `getRandomEmojiName()` as a name in `OnlineLobbyPage` and the join path.
  `getRandomEmojiName` itself stays for now — `src/utils/emojiNames.ts` has other callers to check
  before deleting.

**Verify:** a created room shows `🦊 Player 1`, not `🦊 🐸`. A second joiner is `Player 2`.
Renaming still works and still broadcasts.

### Task 3 — Join Room becomes the same card as New Room

Extract the card `RoomLobby` renders into one component covering both states:

| | New Room | Join Room |
|---|---|---|
| Title / subtitle | `New Room` / *Share this code with other players* | `Join Room` / *Enter or paste code below* |
| Code block | read-only, letter-spaced | **editable, same letter-spaced style** |
| Rows | every player | your own row only, not yet seated |
| Primary | `Start game` / disabled `Waiting for another player` | disabled `Join` → `Join game` once a code is typed |
| Secondary | `Leave` | `Leave` |

`/online/join` renders the Join state; a successful join navigates to `/room/:roomId`, which renders
the New Room state. Delete `JoinForm.tsx` once nothing imports it — check `RoomPage` first, which
uses it for the shared-link case that Task 4 removes.

**Verify by hand:** typing a code into the box fills the list with the other players.

### Task 4 — Delete the `needName` phase

With no name to collect, the phase cannot be reached. Remove `needName` from `RoomPhase`, and with
it the `autoJoins` state in [useRoom.ts:55-72](../../../src/net/useRoom.ts#L55-L72) — twenty lines
whose whole job is suppressing a one-frame flash of the form that no longer exists. `RoomPage` stops
rendering a join form; arriving on a shared link with no stored identity now seats you directly.

**Prove it can fail:** break the auto-join (drop the `rememberedName()` fallback) and confirm a
fresh visit to a room link stops seating anyone. A test that passes with the join path dead is
hollow.

### Task 5 — Correct the record

- `CLAUDE.md`: the "implemented in full" claim, and the `×` in the branch summary.
- The decisions spec: record the `×` ruling as a deviation, with its reason, next to the copy it
  contradicts. The frame stays the copy of record; this is an amendment, not a rewrite.

## Gates

Full suite, `npm run typecheck`, `npx vite build`, `npm run check:bundle`, `npm run verify:layout`.
Then the by-hand pass the owner drives, in two browsers, before any merge.

**Review the whole branch at the end**, not each task — that rule is in `CLAUDE.md` because both of
Phase 4's worst bugs spanned two tasks and survived ten clean per-task reviews. This branch will be
seven commits by then.
